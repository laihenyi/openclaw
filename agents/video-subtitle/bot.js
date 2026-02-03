#!/usr/bin/env node
import 'dotenv/config';
/**
 * Video Subtitle Agent - 獨立 Discord Bot
 *
 * 專門處理影片下載和字幕生成的 Bot
 * 支援：DM、@mention、語音頻道
 */

import { Client, GatewayIntentBits, ChannelType, Events, Partials } from 'discord.js';
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  EndBehaviorType,
} from '@discordjs/voice';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, mkdirSync, createWriteStream, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import opus from '@discordjs/opus';

const { OpusEncoder } = opus;
const __dirname = dirname(fileURLToPath(import.meta.url));

// 載入配置
function loadConfig() {
  const configPath = join(__dirname, 'config.json');
  const content = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(content);

  // 展開環境變數
  if (config.bot.token.startsWith('${')) {
    const envVar = config.bot.token.slice(2, -1);
    config.bot.token = process.env[envVar] || '';
  }

  return config;
}

const config = loadConfig();

// 載入系統提示
function loadSystemPrompt() {
  const promptPath = join(__dirname, 'system-prompt.md');
  if (existsSync(promptPath)) {
    return readFileSync(promptPath, 'utf-8');
  }
  return '你是一個影片下載和字幕生成助手。請用繁體中文回覆。';
}

const systemPrompt = loadSystemPrompt();

// 路徑配置
const PATHS = {
  recordings: join(__dirname, 'recordings'),
  ttsOutput: join(__dirname, 'tts_output'),
  venvPython: join(__dirname, 'venv', 'bin', 'python3'),
  transcribeScript: join(__dirname, 'transcribe.py'),
  ttsScript: join(__dirname, 'tts.py'),
};

// 確保目錄存在
[PATHS.recordings, PATHS.ttsOutput].forEach(dir => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

// 載入 Agent 功能
import videoAgent from './agent.mjs';
import { taskTracker } from './lib/task-tracker.js';

// 初始化 Discord 客戶端
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User], // 需要接收 DM
});

// 語音連線狀態
let voiceConnection = null;
let audioPlayer = createAudioPlayer();

// 活躍錄音
const activeRecordings = new Map();

/**
 * AI 回覆
 */
async function getAIReply(message) {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
  const MODEL = 'stepfun/step-3.5-flash:free';

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return null;
  }
}

/**
 * 處理訊息（DM 或 @mention）
 */
async function handleMessage(message, content) {
  const isDM = message.channel.type === ChannelType.DM;
  console.log(`[${isDM ? 'DM' : 'Mention'}] ${message.author.username}: ${content}`);

  // 查詢進度
  if (content.includes('進度') || content.includes('狀態') || content === '!tasks') {
    const userTasks = taskTracker.getUserTasks(message.author.id, true);
    if (userTasks.length === 0) {
      await message.reply('目前沒有任何任務。');
    } else {
      const statusList = userTasks.slice(0, 5).map(t => taskTracker.formatTaskStatus(t)).join('\n\n');
      await message.reply(`📋 **你的任務：**\n\n${statusList}`);
    }
    return;
  }

  // 自動識別 URL 並觸發下載
  const urlMatch = content.match(/https?:\/\/[^\s]+/);

  // 支援的影片網站
  const SUPPORTED_SITES = [
    'youtube.com', 'youtu.be',
    'bilibili.com', 'b23.tv',
    'twitter.com', 'x.com',
    'vimeo.com',
    'tiktok.com',
    'instagram.com',
    'facebook.com', 'fb.watch',
    'twitch.tv',
    'dailymotion.com',
    'nicovideo.jp',
  ];

  // 不支援的網站
  const UNSUPPORTED_SITES = ['threads.com', 'threads.net'];

  if (urlMatch) {
    const url = urlMatch[0];

    // 檢查是否為不支援的網站
    if (UNSUPPORTED_SITES.some(site => url.includes(site))) {
      await message.reply(`❌ **不支援的網站**\n\nThreads 目前不支援影片下載。\n\n**支援的網站：**\nYouTube, Bilibili, Twitter/X, Vimeo, TikTok, Instagram, Facebook, Twitch, Dailymotion, Niconico`);
      return;
    }

    // 檢查是否為支援的網站
    if (!SUPPORTED_SITES.some(site => url.includes(site))) {
      await message.reply(`⚠️ **未知的網站**\n\n將嘗試下載，但不保證成功。\n\n**確定支援的網站：**\nYouTube, Bilibili, Twitter/X, Vimeo, TikTok, Instagram, Facebook, Twitch`);
    }

    console.log(`[Auto-Download] Detected URL: ${url}`);

    // 創建任務
    const task = taskTracker.createTask(message.author.id, '影片下載', { url });
    await message.reply(`🎬 **任務 #${task.id}** 已建立\n\n偵測到影片網址，開始下載並生成字幕...\n請稍候，可用「進度」查詢狀態。`);

    // 異步執行下載
    (async () => {
      try {
        taskTracker.updateProgress(task.id, 10, '下載影片中...');
        const result = await videoAgent.handleDownloadCommand(url, '720p');

        if (result.success) {
          taskTracker.completeTask(task.id, result);
          await message.reply(`✅ **任務 #${task.id} 完成！**\n\n📥 下載連結：${result.downloadLink}`);
        } else {
          taskTracker.failTask(task.id, result.error);
          await message.reply(`❌ **任務 #${task.id} 失敗**\n\n錯誤：${result.error}`);
        }
      } catch (err) {
        taskTracker.failTask(task.id, err.message);
        await message.reply(`❌ **任務 #${task.id} 發生錯誤**\n\n${err.message}`);
      }
    })();

    return;
  }

  if (content.startsWith('!') || content.startsWith('！')) {
    const cmd = content.replace('！', '!');

    // 語音頻道相關指令
    if (cmd === '!join' && !isDM) {
      const voiceChannel = message.member?.voice?.channel;
      if (voiceChannel) {
        await joinVoiceChannelAndListen(voiceChannel, message.channel);
        await message.reply(`已加入語音頻道：${voiceChannel.name}`);
      } else {
        await message.reply('請先加入一個語音頻道');
      }
      return;
    }

    if (cmd === '!leave') {
      if (voiceConnection) {
        voiceConnection.destroy();
        voiceConnection = null;
        await message.reply('已離開語音頻道');
      }
      return;
    }

    if (cmd === '!status') {
      const status = voiceConnection ? '🟢 已連接語音頻道' : '🔴 未連接';
      await message.reply(`**Video Subtitle Agent 狀態**\n${status}`);
      return;
    }

    // Agent 指令
    await message.channel.sendTyping();
    const result = await videoAgent.handleMessage(content, { username: message.author.username });

    if (result) {
      const reply = result.message || (result.success ? '處理完成' : `錯誤：${result.error}`);
      // Discord 訊息限制 2000 字
      if (reply.length > 1900) {
        await message.reply(reply.substring(0, 1900) + '...');
      } else {
        await message.reply(reply);
      }
      return;
    }
  }

  // 一般對話 - AI 回覆
  await message.channel.sendTyping();
  const reply = await getAIReply(content);
  if (reply) {
    await message.reply(reply);
  } else {
    await message.reply('抱歉，我無法處理這個請求。請嘗試使用指令：\n• `!download <URL>` - 下載影片\n• `!subtitle <路徑>` - 生成字幕\n• `!help` - 查看幫助');
  }
}

/**
 * 語音轉錄
 */
async function transcribeAudio(filepath) {
  return new Promise((resolve) => {
    const proc = spawn(PATHS.venvPython, [PATHS.transcribeScript, filepath], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    proc.stdout.on('data', (data) => { stdout += data.toString('utf-8'); });
    proc.on('close', (code) => {
      resolve(code === 0 ? stdout.trim() : null);
    });
    proc.on('error', () => resolve(null));
  });
}

/**
 * 文字轉語音
 */
async function textToSpeech(text) {
  const outputFile = join(PATHS.ttsOutput, `tts_${Date.now()}.mp3`);
  return new Promise((resolve) => {
    const proc = spawn(PATHS.venvPython, [PATHS.ttsScript, text, outputFile]);
    proc.on('close', (code) => {
      resolve(code === 0 && existsSync(outputFile) ? outputFile : null);
    });
    proc.on('error', () => resolve(null));
  });
}

/**
 * 在語音頻道播放語音
 */
async function speakText(text) {
  if (!voiceConnection) return;

  const audioFile = await textToSpeech(text);
  if (!audioFile) return;

  const resource = createAudioResource(audioFile);
  audioPlayer.play(resource);

  audioPlayer.once(AudioPlayerStatus.Idle, () => {
    try { unlinkSync(audioFile); } catch (e) {}
  });
}

/**
 * 建立 WAV 緩衝區
 */
function createWavBuffer(pcmBuffer) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(192000, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

/**
 * 加入語音頻道並監聽
 */
async function joinVoiceChannelAndListen(voiceChannel, textChannel) {
  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    console.log(`[Voice] Connected to: ${voiceChannel.name}`);

    voiceConnection = connection;
    connection.subscribe(audioPlayer);

    const receiver = connection.receiver;

    receiver.speaking.on('start', (userId) => {
      if (activeRecordings.has(userId)) return;

      client.users.fetch(userId).then(user => {
        console.log(`[Voice] ${user.username} started speaking`);

        const recording = {
          chunks: [],
          timer: null,
          username: user.username,
        };
        activeRecordings.set(userId, recording);

        const audioStream = receiver.subscribe(userId, {
          end: { behavior: EndBehaviorType.AfterSilence, duration: 3000 },
        });

        const decoder = new OpusEncoder(48000, 2);

        audioStream.on('data', (chunk) => {
          try {
            const decoded = decoder.decode(chunk);
            recording.chunks.push(decoded);

            if (recording.timer) clearTimeout(recording.timer);
            recording.timer = setTimeout(async () => {
              await processRecording(userId, textChannel);
            }, 3000);
          } catch (e) {}
        });

        audioStream.on('end', async () => {
          console.log(`[Voice] ${user.username} stopped speaking`);
          await processRecording(userId, textChannel);
        });
      });
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        connection.destroy();
        voiceConnection = null;
      }
    });

  } catch (error) {
    console.error('[Voice] Error:', error.message);
  }
}

/**
 * 處理錄音
 */
async function processRecording(userId, textChannel) {
  const recording = activeRecordings.get(userId);
  if (!recording || recording.chunks.length === 0) return;

  activeRecordings.delete(userId);
  if (recording.timer) clearTimeout(recording.timer);

  const audioBuffer = Buffer.concat(recording.chunks);
  const duration = (audioBuffer.length / 192000) * 1000;

  if (duration < 1000) {
    console.log(`[Voice] Audio too short: ${duration.toFixed(0)}ms`);
    return;
  }

  // 儲存並轉錄
  const filename = `${userId}_${Date.now()}.wav`;
  const filepath = join(PATHS.recordings, filename);
  const wavBuffer = createWavBuffer(audioBuffer);
  const writeStream = createWriteStream(filepath);
  writeStream.write(wavBuffer);
  writeStream.end();

  await new Promise(resolve => writeStream.on('finish', resolve));

  const transcription = await transcribeAudio(filepath);
  if (!transcription || transcription.length < 2) return;

  // 發送字幕
  await textChannel.send(`**🎙️ ${recording.username}**: ${transcription}`);
  console.log(`[Voice] ${recording.username}: ${transcription}`);

  // 處理訊息
  if (transcription.startsWith('!') || transcription.includes('下載') || transcription.includes('字幕')) {
    const result = await videoAgent.handleMessage(transcription, { username: recording.username });
    if (result) {
      const reply = result.message || (result.success ? '處理完成' : `錯誤：${result.error}`);
      await textChannel.send(`**🤖 Video Agent**: ${reply}`);
      if (config.voice.enableVoiceReply) {
        await speakText(reply.substring(0, 200));
      }
      return;
    }
  }

  // 一般對話
  const reply = await getAIReply(transcription);
  if (reply) {
    await textChannel.send(`**🤖 Video Agent**: ${reply}`);
    if (config.voice.enableVoiceReply) {
      await speakText(reply);
    }
  }
}

// 訊息事件
client.on(Events.MessageCreate, async (message) => {
  // 調試日誌
  console.log(`[Debug] Message received: "${message.content}" from ${message.author.tag} (bot: ${message.author.bot})`);

  if (message.author.bot) return;

  const isDM = message.channel.type === ChannelType.DM;
  const isMention = message.mentions.has(client.user);

  console.log(`[Debug] isDM: ${isDM}, isMention: ${isMention}`);

  if (isDM || isMention) {
    const content = message.content.replace(/<@!?\d+>/g, '').trim();

    if (content.length < 1) {
      await message.reply('你好！我是 Video Subtitle Agent。\n\n**指令：**\n• `!download <URL>` - 下載影片並生成字幕\n• `!subtitle <路徑>` - 為影片生成字幕\n• `!join` - 加入你的語音頻道\n• `!leave` - 離開語音頻道\n• `!status` - 查看狀態');
      return;
    }

    await handleMessage(message, content);
  }
});

// Bot 就緒
client.once(Events.ClientReady, () => {
  console.log(`[Bot] Video Subtitle Agent logged in as ${client.user.tag}`);
  console.log('[Bot] Ready to receive DMs and mentions');
});

// 錯誤處理
client.on('error', console.error);
process.on('unhandledRejection', console.error);

process.on('SIGINT', () => {
  console.log('\n[Bot] Shutting down...');
  if (voiceConnection) voiceConnection.destroy();
  client.destroy();
  process.exit(0);
});

// 啟動
const token = process.env.VIDEO_SUBTITLE_BOT_TOKEN || config.bot.token;
if (!token) {
  console.error('[Bot] VIDEO_SUBTITLE_BOT_TOKEN not set');
  console.log('\n請設定環境變數或在 config.json 中填入 token');
  console.log('export VIDEO_SUBTITLE_BOT_TOKEN="your-bot-token"');
  process.exit(1);
}

console.log('[Bot] Starting Video Subtitle Agent...');
client.login(token);
