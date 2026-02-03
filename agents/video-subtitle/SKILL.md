---
name: video-subtitle
description: |
  Download videos and generate Traditional Chinese subtitles using yt-dlp + Whisper.
  Automatically handles: (1) Video download (YouTube, Bilibili, TikTok, etc.), (2) Audio extraction, 
  (3) Whisper transcription with Traditional Chinese (zh-TW), (4) SRT subtitle embedding.
  Use when: (1) User provides a video URL and wants Traditional Chinese subtitles, (2) User mentions "下載影片" + "繁體字幕", 
  (3) User needs to add subtitles to a video file. Triggers on phrases like "影片下載", "繁體字幕", "字幕生成", "中文字幕", "添加字幕", "add subtitles", 
  "subtitle generation", "YouTube", "B站", "Whisper", "SRT", "字幕嵌入".
---

# Video Subtitle Agent

專門負責影片下載和繁體中文字幕生成的 Sub-Agent。

## 核心功能

### 📥 影片下載
- **支援網站**：YouTube、Bilibili、TikTok、抖音、Twitter、Vimeo 等 1000+ 網站
- **解析度選擇**：360p、720p、1080p、4K
- **自動清理**：舊檔案（超過 60 天）

### 🎙️ 音訊提取
- **獨立音訊檔案**：m4a / mp3
- **高品質提取**：AAC 編碼

### 🇹🇳 Whisper 轉錄
- **語言模型**：faster-whisper large-v3
- **目標語言**：zh-TW（繁體中文）
- **輸出格式**：SRT
- **處理模式**：CPU/GPU 自動選擇

### 📝 SRT 字幕生成
- **自動分節**：根據語氣、標點、長度
- **時間戳格式**：`00:00:00,000 --> 00:00:05,000`
- **字數限制**：每行不超過 20 字（自動換行）

### 🎬 影片處理
- **字幕嵌入**：FFmpeg 合併影片和字幕
- **格式保持**：H.264 + AAC
- **質量最佳化**：保持原影片解析度

## 使用流程

### 命令式操作

**1. 下載影片 + 繁體中文字幕**
```
!download <URL> [解析度=720p]
```

執行步驟：
1. 下載影片（指定解析度）
2. 提取音訊
3. Whisper 轉錄（繁體中文）
4. 生成 SRT 字幕
5. 嵌入字幕到影片
6. 回報完成並提供下載連結

**範例**：
```
!download https://www.youtube.com/watch?v=xxx
```

**回應範例**：
```
✅ 影片下載完成！
📹 標題：影片標題
🇹🇳 字幕：繁體中文 SRT 已生成
🎬 已嵌入字幕到影片
📤 下載連結：http://192.168.100.100:18800/filename.mp4
```

**2. 字幕生成（已有影片檔案）**
```
!subtitle <影片路徑> [zh-TW]
```

執行步驟：
1. 提取音訊
2. Whisper 轉錄（繁體中文）
3. 生成 SRT 字幕
4. 回報完成

**範例**：
```
!subtitle /path/to/video.mp4
```

**3. 下載單獨音訊**
```
!audio <URL>
```

## 技術細節

### Whisper 配置
```javascript
// 執行 Whispers（繁體中文）
const result = whisper({
  audio: audioPath,
  model: 'large-v3',
  language: 'zh-TW',  // 繁體中文
  output_format: 'srt',
  word_timestamps: true,
  temperature: 0.0
});

// 自動 CPU/GPU 模式選擇
const useGPU = shouldUseGPU();  // 檢測 CUDA 可用性
```

### FFmpeg 字幕嵌入
```bash
# 嵌入繁體中文字幕
ffmpeg -i video.mp4 -i subtitles.srt -c:v copy -c:a copy -c:s mov_text output_with_tw_sub.mp4

# 設定中文字幕樣式（可選）
ffmpeg -i video.mp4 -i subtitles.srt -c:v copy -c:a copy -c:s mov_text -metadata:s='language=chi' output_tw.mp4
```

### 下載指令優化
```bash
# 下載 720p（預設）
yt-dlp -f "bestvideo[height<=720]+bestaudio/best[height<=720]" --merge-output-format mp4 "URL"

# 下載 1080p
yt-dlp -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" --merge-output-format mp4 "URL"

# 下載 4K
yt-dlp -f "bestvideo+bestaudio" --merge-output-format mp4 "URL"
```

## 參數說明

### !download 指令參數
| 參數 | 說明 | 預設值 |
|------|------|--------|
| 解析度 | 360p, 720p, 1080p, 4K | 720p |
| 語言 | zh-TW（繁體中文） | zh-TW |
| 清理舊檔 | false | true（超過 60 天自動刪除） |

### 支援的網站
- **主要**：YouTube、Bilibili（B站）、TikTok、抖音
- **其他**：Twitter、Vimeo、Facebook Video、Instagram 等

## 注意事項

### 📥 下載限制
- 某些網站可能有地區限制或版權保護
- 使用 VPN/Proxy 繞過限制
- 檢查檔案大小（避免空間不足）

### 🇹🇳 Whisper 性能
- **CPU 模式**：約需 10-30 秒/分鐘（視影片長度）
- **GPU 模式**：約需 2-5 秒/分鐘（如果可用）
- **準確度**：large-v3 模型準確度高

### 🎬 FFmpeg 要求
- 確保系統已安裝 `ffmpeg`
- 支援大部分視訊編碼格式
- 可調整字幕樣式（字體、大小、位置）

## 錯誤處理

### 下載失敗
```
❌ 下載失敗：無法存取影片
💡 解決方案：
   - 檢查網路連線
   - 確認網站是否可存取
   - 嘗試使用 VPN
```

### Whisper 轉錄失敗
```
❌ Whisper 轉錄失敗：無法處理音訊
💡 解決方案：
   - 檢查音訊檔案格式
   - 確認 GPU 可用性
   - 嘗試 CPU 模式
```

### FFmpeg 嵌入失敗
```
❌ 字幕嵌入失敗：無法合併影片和字幕
💡 解決方案：
   - 確認 FFmpeg 已安裝
   - 檢查檔案路徑
   - 檢查字幕檔案格式（SRT）
```

## 最佳實踐

### 1. 完整工作流程
```
用戶請求：幫忙下載這個 YouTube 影片，要繁體中文字幕
         ↓
Agent 執行：
1. 下載影片（720p）
2. 提取音訊
3. Whisper 轉錄（zh-TW）
4. 生成 SRT 字幕
5. FFmpeg 嵌入字幕
6. 回報：完成！提供下載連結
         ↓
用戶確認收到並查看字幕
```

### 2. 檔案管理
```
下載路徑：~/clawd/downloads/
檔案命名：<標題>_<ID>.mp4
字幕檔案：<標題>_<ID>_zh-TW.srt
舊檔案清理：超過 60 天自動刪除
```

### 3. 效能優化
```
預設解析度：720p（平衡品質與速度）
字幕格式：SRT（標準相容格式）
音訊提取：m4a（高品質）
```

## 測試建議

### 本地測試
1. 使用短影片測試（1-2 分鐘）
2. 測試不同解析度（360p vs 720p）
3. 測試繁體中文準確度
4. 驗證 SRT 字幕格式正確性

### 網站兼容性測試
1. YouTube - 標準測試
2. Bilibili - 測試繁體中文支援
3. TikTok - 測試短影片處理
4. 域外網站 - 測試錯誤處理

## 參考資源

### 已安裝 Skills
- **yt-dlp-downloader**：`~/.openclaw/skills/yt-dlp-downloader/`
- **Whisper**：`~/clawd/whisper_subtitle_cpu.py`（使用 faster-whisper）

### 系統工具
- **FFmpeg**：影片處理
- **yt-dlp**：影片下載
- **faster-whisper**：語音轉錄
