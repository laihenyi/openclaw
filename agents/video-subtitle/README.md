# Video Subtitle Agent

影片下載和字幕生成 Discord Bot。

## 功能

- 下載 YouTube/Bilibili 影片
- 使用 Whisper (GPU) 生成字幕
- 自動翻譯成繁體中文
- 嵌入字幕到影片中
- 支援 DM、@mention、語音頻道

## 技術棧

- **Whisper**: `large-v3-turbo` 模型 (GPU/CUDA 12.4)
- **翻譯**: deep-translator + OpenCC (簡轉繁)
- **下載**: yt-dlp
- **字幕嵌入**: ffmpeg

## 指令

| 指令 | 說明 |
|------|------|
| `!download <URL>` | 下載影片並生成字幕 |
| `!subtitle <路徑>` | 為影片生成字幕 |
| `!join` | 加入語音頻道 |
| `!leave` | 離開語音頻道 |
| `!status` | 查看狀態 |
| `進度` | 查詢任務進度 |

## 安裝

```bash
cd agents/video-subtitle
npm install
```

## 執行

```bash
VIDEO_SUBTITLE_BOT_TOKEN="your-token" node bot.js
```

## 環境變數

- `VIDEO_SUBTITLE_BOT_TOKEN` - Discord Bot Token (必填)
- `OPENROUTER_API_KEY` - OpenRouter API Key (用於 AI 回覆)
