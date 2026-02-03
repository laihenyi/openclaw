#!/usr/bin/env node

/**
 * Video Subtitle Agent
 * 下載影片並生成繁體中文字幕
 */

import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const CONFIG = {
  downloadPath: path.join(process.env.HOME || process.env.USERPROFILE, 'clawd', 'downloads'),
  whisperScript: path.join(process.env.HOME || process.env.USERPROFILE, 'clawd', 'whisper_subtitle_cpu.py'),
  whisperLanguage: 'zh-TW',  // 預設翻譯成繁體中文
  fileServerUrl: 'http://192.168.100.100:18800/',
  defaultQuality: '720p',
  cleanupDays: 60,
};

// 確保下載目錄存在
if (!fs.existsSync(CONFIG.downloadPath)) {
  fs.mkdirSync(CONFIG.downloadPath, { recursive: true });
}

// 日誌函數
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

function logError(message) {
  log(message, 'ERROR');
}

// 執行命令並返回結果
function execCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;
    log(`執行: ${fullCommand}`);

    exec(fullCommand, {
      cwd: CONFIG.downloadPath,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    }, (error, stdout, stderr) => {
      if (error) {
        logError(`命令執行失敗: ${error.message}`);
        resolve({ success: false, stdout, stderr, code: error.code || -1 });
      } else {
        log(`命令執行成功`);
        resolve({ success: true, stdout, stderr, code: 0 });
      }
    });
  });
}

// 下載影片
export async function downloadVideo(url, quality = CONFIG.defaultQuality) {
  log(`開始下載影片: ${url}`);

  // 解析品質參數
  const heightMap = { '360p': 360, '720p': 720, '1080p': 1080, '4k': 2160 };
  const height = heightMap[quality.toLowerCase()] || 720;

  const outputTemplate = path.join(CONFIG.downloadPath, '%(title).60s [%(id)s].%(ext)s');

  const result = await execCommand('yt-dlp', [
    '-f', `"bestvideo[height<=${height}]+bestaudio/best[height<=${height}]"`,
    '--merge-output-format', 'mp4',
    '-o', `"${outputTemplate}"`,
    '--no-playlist',
    url,
  ]);

  if (!result.success) {
    throw new Error(`影片下載失敗: ${result.stderr}`);
  }

  // 找到下載的檔案
  const output = result.stdout + result.stderr;
  const destMatch = output.match(/\[download\] Destination: (.+\.mp4)/m);
  const mergeMatch = output.match(/\[Merger\] Merging formats into "(.+\.mp4)"/m);
  const alreadyMatch = output.match(/\[download\] (.+\.mp4) has already been downloaded/m);

  const filePath = mergeMatch?.[1] || destMatch?.[1] || alreadyMatch?.[1];

  if (!filePath) {
    // 嘗試找最新的 mp4 檔案
    const files = fs.readdirSync(CONFIG.downloadPath)
      .filter(f => f.endsWith('.mp4'))
      .map(f => ({ name: f, time: fs.statSync(path.join(CONFIG.downloadPath, f)).mtime }))
      .sort((a, b) => b.time - a.time);

    if (files.length > 0) {
      return path.join(CONFIG.downloadPath, files[0].name);
    }
    throw new Error('無法找到下載的檔案');
  }

  return filePath.trim();
}

// 提取音訊
export async function extractAudio(videoPath) {
  log(`提取音訊: ${videoPath}`);

  const baseName = path.basename(videoPath, path.extname(videoPath));
  const audioPath = path.join(CONFIG.downloadPath, `${baseName}.m4a`);

  const result = await execCommand('ffmpeg', [
    '-i', `"${videoPath}"`,
    '-vn',
    '-acodec', 'copy',
    '-y',
    `"${audioPath}"`,
  ]);

  if (!result.success) {
    // 嘗試重新編碼
    const result2 = await execCommand('ffmpeg', [
      '-i', `"${videoPath}"`,
      '-vn',
      '-acodec', 'aac',
      '-b:a', '128k',
      '-y',
      `"${audioPath}"`,
    ]);

    if (!result2.success) {
      throw new Error(`音訊提取失敗: ${result2.stderr}`);
    }
  }

  return audioPath;
}

// 生成字幕
export async function generateSubtitle(audioPath) {
  log(`生成繁體中文字幕: ${audioPath}`);

  const result = await execCommand('python3', [
    `"${CONFIG.whisperScript}"`,
    '-l', CONFIG.whisperLanguage,
    `"${audioPath}"`,
  ]);

  if (!result.success) {
    throw new Error(`字幕生成失敗: ${result.stderr}`);
  }

  // 找到字幕檔案
  const baseName = path.basename(audioPath, path.extname(audioPath));
  const srtPath = path.join(CONFIG.downloadPath, `${baseName}.srt`);

  if (fs.existsSync(srtPath)) {
    return srtPath;
  }

  // 嘗試從輸出解析
  const match = result.stdout.match(/Saved to (.+\.srt)/m);
  if (match) {
    return match[1].trim();
  }

  throw new Error('無法找到字幕檔案');
}

// 嵌入字幕
export async function embedSubtitle(videoPath, subtitlePath) {
  log(`嵌入字幕到影片: ${subtitlePath}`);

  const baseName = path.basename(videoPath, '.mp4');
  const outputPath = path.join(CONFIG.downloadPath, `${baseName}_with_subs.mp4`);

  const result = await execCommand('ffmpeg', [
    '-i', `"${videoPath}"`,
    '-i', `"${subtitlePath}"`,
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-c:s', 'mov_text',
    '-y',
    `"${outputPath}"`,
  ]);

  if (!result.success) {
    throw new Error(`字幕嵌入失敗: ${result.stderr}`);
  }

  return outputPath;
}

// 生成下載連結
export function generateDownloadLink(filePath) {
  const fileName = path.basename(filePath);
  return `${CONFIG.fileServerUrl}${encodeURIComponent(fileName)}`;
}

// 清理舊檔案
export async function cleanupOldFiles() {
  log(`清理舊檔案 (${CONFIG.cleanupDays} 天前）`);

  const result = await execCommand('find', [
    `"${CONFIG.downloadPath}"`,
    '-type', 'f',
    '-mtime', `+${CONFIG.cleanupDays}`,
    '-delete',
  ]);

  if (!result.success) {
    logError(`清理舊檔案失敗: ${result.stderr}`);
    return { success: false, message: result.stderr };
  }

  return { success: true, message: '清理完成' };
}

// 主要處理函數 - 下載影片並生成字幕
export async function handleDownloadCommand(url, quality = CONFIG.defaultQuality) {
  try {
    // 清理舊檔案
    await cleanupOldFiles();

    // 下載影片
    const videoFile = await downloadVideo(url, quality);
    log(`✅ 影片下載完成: ${videoFile}`);

    // 提取音訊
    const audioFile = await extractAudio(videoFile);
    log(`✅ 音訊提取完成: ${audioFile}`);

    // 生成字幕
    const subtitleFile = await generateSubtitle(audioFile);
    log(`✅ 字幕生成完成: ${subtitleFile}`);

    // 嵌入字幕
    const finalFile = await embedSubtitle(videoFile, subtitleFile);
    log(`✅ 字幕嵌入完成: ${finalFile}`);

    // 生成下載連結
    const downloadLink = generateDownloadLink(finalFile);

    return {
      success: true,
      videoFile,
      audioFile,
      subtitleFile,
      finalFile,
      downloadLink,
      message: `影片處理完成！\n下載連結: ${downloadLink}`,
    };
  } catch (error) {
    logError(`處理失敗: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

// 處理字幕生成（已有影片檔案）
export async function handleSubtitleCommand(videoPath) {
  try {
    // 確認檔案存在
    const fullPath = path.isAbsolute(videoPath) ? videoPath : path.join(CONFIG.downloadPath, videoPath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`檔案不存在: ${fullPath}`);
    }

    // 提取音訊
    const audioFile = await extractAudio(fullPath);
    log(`✅ 音訊提取完成: ${audioFile}`);

    // 生成字幕
    const subtitleFile = await generateSubtitle(audioFile);
    log(`✅ 字幕生成完成: ${subtitleFile}`);

    // 嵌入字幕
    const finalFile = await embedSubtitle(fullPath, subtitleFile);
    log(`✅ 字幕嵌入完成: ${finalFile}`);

    // 生成下載連結
    const downloadLink = generateDownloadLink(finalFile);

    return {
      success: true,
      audioFile,
      subtitleFile,
      finalFile,
      downloadLink,
      message: `字幕處理完成！\n下載連結: ${downloadLink}`,
    };
  } catch (error) {
    logError(`處理失敗: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

// 處理語音/文字訊息（Gateway 呼叫）
export async function handleMessage(message, context = {}) {
  const content = message.trim();

  // 解析指令
  if (content.startsWith('!download') || content.startsWith('下載')) {
    const parts = content.split(/\s+/);
    const url = parts.find(p => p.startsWith('http'));
    const quality = parts.find(p => /^\d+p$/i.test(p)) || CONFIG.defaultQuality;

    if (!url) {
      return { success: false, error: '請提供影片網址' };
    }

    return handleDownloadCommand(url, quality);
  }

  if (content.startsWith('!subtitle') || content.startsWith('字幕')) {
    const parts = content.split(/\s+/).slice(1);
    const videoPath = parts.join(' ');

    if (!videoPath) {
      return { success: false, error: '請提供影片路徑' };
    }

    return handleSubtitleCommand(videoPath);
  }

  if (content.startsWith('!cleanup') || content.startsWith('清理')) {
    return cleanupOldFiles();
  }

  // 非指令訊息
  return null;
}

// 設定 PATH 環境
export function setupEnv() {
  const denoPath = path.join(process.env.HOME, '.deno', 'bin');
  const ytDlpPath = path.join(process.env.HOME, '.local', 'bin');

  process.env.PATH = `${denoPath}:${ytDlpPath}:${process.env.PATH}`;
  log(`PATH 已設定`);
}

// 主程式入口
async function main() {
  setupEnv();

  log('影片字幕 Agent 已啟動');
  log(`下載路徑: ${CONFIG.downloadPath}`);
  log(`字幕語言: ${CONFIG.whisperLanguage} (繁體中文)`);
  console.log('\n等待指令...');
  console.log('指令列表:');
  console.log('  !download <URL> [解析度=720p]  - 下載影片並生成繁體中文字幕');
  console.log('  !subtitle <影片路徑>           - 為影片添加繁體中文字幕');
  console.log('  !cleanup                       - 清理舊檔案');
  console.log('');
  console.log('範例:');
  console.log('  !download https://www.youtube.com/watch?v=xxx');
  console.log('  !subtitle /path/to/video.mp4');
  console.log('');
  console.log('可用解析度: 360p, 720p, 1080p, 4k');
}

// ESM 模組入口點檢測
const isMainModule = process.argv[1] && (
  process.argv[1] === __filename ||
  process.argv[1] === fileURLToPath(import.meta.url)
);

if (isMainModule) {
  main();
}

// 預設匯出
export default {
  handleDownloadCommand,
  handleSubtitleCommand,
  handleMessage,
  downloadVideo,
  extractAudio,
  generateSubtitle,
  embedSubtitle,
  generateDownloadLink,
  cleanupOldFiles,
  setupEnv,
  CONFIG,
};
