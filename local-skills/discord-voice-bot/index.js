import 'dotenv/config';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} from '@discordjs/voice';
import opus from '@discordjs/opus';
const { OpusEncoder } = opus;
import { createWriteStream, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { getAIReply } from './ai-reply.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
  DISCORD_TOKEN: process.env.VOICE_AGENT_BOT_TOKEN || '',
  VOICE_CHANNEL_ID: '1078212271421014120',
  TEXT_CHANNEL_ID: '1078212271421014119',
  RECORDINGS_DIR: join(__dirname, 'recordings'),
  VENV_PYTHON: join(__dirname, 'venv', 'bin', 'python3'),
  TRANSCRIBE_SCRIPT: join(__dirname, 'transcribe.py'),
  TTS_SCRIPT: join(__dirname, 'tts.py'),
  TTS_OUTPUT_DIR: join(__dirname, 'tts_output'),
  ENABLE_VOICE_REPLY: true,
  SILENCE_THRESHOLD: 3000,
  MIN_AUDIO_DURATION: 1000,
};

// Ensure directories exist
if (!existsSync(CONFIG.RECORDINGS_DIR)) {
  mkdirSync(CONFIG.RECORDINGS_DIR, { recursive: true });
}
if (!existsSync(CONFIG.TTS_OUTPUT_DIR)) {
  mkdirSync(CONFIG.TTS_OUTPUT_DIR, { recursive: true });
}

// Global audio player
let audioPlayer = null;
let currentConnection = null;

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Track active recordings
const activeRecordings = new Map();

class UserRecording {
  constructor(userId, username) {
    this.userId = userId;
    this.username = username;
    this.chunks = [];
    this.lastChunkTime = Date.now();
    this.silenceTimer = null;
    this.isProcessing = false;
  }

  addChunk(chunk) {
    this.chunks.push(chunk);
    this.lastChunkTime = Date.now();
    this.resetSilenceTimer();
  }

  resetSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }
    this.silenceTimer = setTimeout(() => {
      this.processAudio();
    }, CONFIG.SILENCE_THRESHOLD);
  }

  async processAudio() {
    if (this.isProcessing || this.chunks.length === 0) return;

    this.isProcessing = true;
    const chunksToProcess = [...this.chunks];
    this.chunks = [];

    try {
      const audioBuffer = Buffer.concat(chunksToProcess);
      const estimatedDuration = (audioBuffer.length / 192000) * 1000;

      if (estimatedDuration < CONFIG.MIN_AUDIO_DURATION) {
        console.log(`[${this.username}] Audio too short (${estimatedDuration.toFixed(0)}ms), skipping`);
        this.isProcessing = false;
        return;
      }

      const filename = `${this.userId}_${Date.now()}.wav`;
      const filepath = join(CONFIG.RECORDINGS_DIR, filename);
      const wavBuffer = createWavBuffer(audioBuffer);
      const writeStream = createWriteStream(filepath);
      writeStream.write(wavBuffer);
      writeStream.end();

      await new Promise(resolve => writeStream.on('finish', resolve));
      console.log(`[${this.username}] Saved audio: ${filename} (${(audioBuffer.length / 1024).toFixed(1)}KB)`);

      const transcription = await transcribeAudio(filepath);

      if (transcription && transcription.trim().length > 1) {
        await sendSubtitle(this.username, transcription);
      }

      // Keep for debug
      console.log(`[DEBUG] Audio file: ${filepath}`);

    } catch (error) {
      console.error(`[${this.username}] Error processing audio:`, error.message);
    }

    this.isProcessing = false;
  }

  cleanup() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }
    if (this.chunks.length > 0) {
      this.processAudio();
    }
  }
}

function createWavBuffer(pcmBuffer) {
  const sampleRate = 48000;
  const numChannels = 2;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// Transcribe audio with local Whisper
async function transcribeAudio(filepath) {
  return new Promise((resolve) => {
    console.log(`[Whisper] Starting transcription: ${filepath}`);
    const proc = spawn(CONFIG.VENV_PYTHON, [CONFIG.TRANSCRIBE_SCRIPT, filepath], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString('utf-8');
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString('utf-8');
      stderr += msg;
      if (msg.includes('Loading') || msg.includes('Model loaded') || msg.includes('segments')) {
        console.log(msg.trim());
      }
    });

    proc.on('close', (code) => {
      const text = stdout.trim();
      console.log(`[Whisper] Result: "${text}"`);
      if (code === 0 && text) {
        resolve(text);
      } else {
        resolve(null);
      }
    });

    proc.on('error', (error) => {
      console.error('Whisper error:', error.message);
      resolve(null);
    });
  });
}

// Send subtitle to text channel
async function sendSubtitle(username, text) {
  try {
    const channel = await client.channels.fetch(CONFIG.TEXT_CHANNEL_ID);
    if (channel && channel.type === ChannelType.GuildText) {
      await channel.send(`**🎙️ ${username}**: ${text}`);
      console.log(`[Subtitle] ${username}: ${text}`);

      if (CONFIG.ENABLE_VOICE_REPLY && currentConnection && text.length > 2) {
        console.log('[AI] Getting reply...');
        const reply = await getAIReply(text);
        if (reply) {
          await channel.send(`**🤖 AI**: ${reply}`);
          console.log(`[AI Reply] ${reply}`);
          await speakText(reply);
        }
      }
    }
  } catch (error) {
    console.error('Error sending subtitle:', error.message);
  }
}

// Text-to-Speech
async function textToSpeech(text) {
  const outputFile = join(CONFIG.TTS_OUTPUT_DIR, `tts_${Date.now()}.mp3`);
  return new Promise((resolve) => {
    const proc = spawn(CONFIG.VENV_PYTHON, [CONFIG.TTS_SCRIPT, text, outputFile]);
    proc.on('close', (code) => {
      if (code === 0 && existsSync(outputFile)) {
        resolve(outputFile);
      } else {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
}

// Speak text in voice channel
async function speakText(text) {
  if (!currentConnection || !audioPlayer) {
    console.error('No voice connection');
    return;
  }

  try {
    const audioFile = await textToSpeech(text);
    if (!audioFile) {
      console.error('TTS failed');
      return;
    }

    const resource = createAudioResource(audioFile);
    audioPlayer.play(resource);
    console.log('[TTS] Playing audio...');

    audioPlayer.once(AudioPlayerStatus.Idle, () => {
      try { unlinkSync(audioFile); } catch (e) {}
    });
  } catch (error) {
    console.error('TTS error:', error.message);
  }
}

// Join voice channel
async function joinAndRecord() {
  try {
    const channel = await client.channels.fetch(CONFIG.VOICE_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      console.error('Invalid voice channel');
      return;
    }

    console.log(`Joining voice channel: ${channel.name}`);

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    console.log('Connected to voice channel!');

    currentConnection = connection;
    audioPlayer = createAudioPlayer();
    connection.subscribe(audioPlayer);

    const receiver = connection.receiver;

    receiver.speaking.on('start', (userId) => {
      console.log(`User ${userId} started speaking`);

      if (!activeRecordings.has(userId)) {
        client.users.fetch(userId).then(user => {
          const recording = new UserRecording(userId, user.username);
          activeRecordings.set(userId, recording);

          const audioStream = receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: CONFIG.SILENCE_THRESHOLD },
          });

          const opusDecoder = new OpusEncoder(48000, 2);

          audioStream.on('data', (chunk) => {
            try {
              const decoded = opusDecoder.decode(chunk);
              recording.addChunk(decoded);
            } catch (e) {}
          });

          audioStream.on('end', () => {
            console.log(`User ${userId} stopped speaking`);
            const rec = activeRecordings.get(userId);
            if (rec) {
              rec.cleanup();
              activeRecordings.delete(userId);
            }
          });
        });
      }
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch (error) {
        connection.destroy();
        setTimeout(joinAndRecord, 5000);
      }
    });

    const textChannel = await client.channels.fetch(CONFIG.TEXT_CHANNEL_ID);
    if (textChannel) {
      await textChannel.send('🎙️ **語音助手已啟動！** 說話後會自動轉錄並回覆。');
    }

  } catch (error) {
    console.error('Error joining voice channel:', error);
    setTimeout(joinAndRecord, 10000);
  }
}

// Handle commands and text mentions
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();

  // Handle commands
  if (content === '!join') {
    await joinAndRecord();
    return;
  }

  if (content === '!leave') {
    const connection = getVoiceConnection(message.guild.id);
    if (connection) {
      connection.destroy();
      await message.reply('已離開語音頻道');
    }
    return;
  }

  if (content === '!status') {
    const connection = getVoiceConnection(message.guild.id);
    await message.reply(`語音狀態: ${connection ? '🟢 已連接' : '🔴 未連接'}`);
    return;
  }

  // Handle text mentions - respond when bot is @mentioned
  if (message.mentions.has(client.user)) {
    // Remove the bot mention from the message
    const userMessage = message.content
      .replace(/<@!?\d+>/g, '')
      .trim();

    if (userMessage.length < 2) {
      await message.reply('請問有什麼我可以幫助的？');
      return;
    }

    console.log(`[Text] ${message.author.username}: ${userMessage}`);

    try {
      // Show typing indicator
      await message.channel.sendTyping();

      const reply = await getAIReply(userMessage);
      if (reply) {
        await message.reply(reply);
        console.log(`[Text Reply] ${reply}`);

        // Also speak in voice channel if connected
        if (currentConnection && CONFIG.ENABLE_VOICE_REPLY) {
          await speakText(reply);
        }
      } else {
        await message.reply('抱歉，我無法處理這個請求。');
      }
    } catch (error) {
      console.error('Text reply error:', error.message);
      await message.reply('發生錯誤，請稍後再試。');
    }
  }
});

client.once('ready', async () => {
  console.log(`Voice bot logged in as ${client.user.tag}`);
  await joinAndRecord();
});

client.on('error', console.error);
process.on('unhandledRejection', console.error);

console.log('Using local Whisper for transcription');
client.login(CONFIG.DISCORD_TOKEN);
