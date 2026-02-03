# Discord Voice Bot

Discord 語音頻道轉錄 Bot，自動將語音轉為文字。

## 功能

- 自動加入語音頻道
- 即時語音轉文字 (Whisper GPU)
- 繁體中文轉錄
- 文字頻道同步顯示

## 技術棧

- **Whisper**: `large-v3-turbo` 模型 (GPU/CUDA 12.4)
- **Discord.js**: v14
- **@discordjs/voice**: 語音處理

## 執行

```bash
cd local-skills/discord-voice-bot
npm install
node index.js
```

## 配置

Token 已內建在 `index.js` 中的 CONFIG 物件。
