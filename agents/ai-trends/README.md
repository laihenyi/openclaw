# AI Trends Agent

24 小時全球 AI 趨勢追蹤 Discord Bot，以「增速」為核心排序指標。

## 數據來源與排序邏輯

| 來源 | 排序指標 | 說明 |
|------|----------|------|
| **GitHub** | Stars/day | 24hr Stars 增量 |
| **Hacker News** | Points/hour | 熱度增速 |
| **Reddit** | Score/hour | 熱度增速 |
| **arXiv** | Time | 最新提交時間 |
| **Hugging Face** | Likes/7d | 7 天 Likes 增量 |
| **Product Hunt** | Time | 發布時間 |

## 功能

- 每日 AM 8:00 / PM 8:00 (台北時間) 自動推送
- 支援 DM 和 @mention
- 訂閱/取消訂閱功能

## 指令

| 指令 | 說明 |
|------|------|
| `!news` | 完整趨勢報告 |
| `!github` | GitHub 24hr Stars 增速 |
| `!hn` | Hacker News 熱度增速 |
| `!reddit` | Reddit 熱度增速 |
| `!arxiv` | arXiv 最新論文 |
| `!hf` | Hugging Face 7 天增速 |
| `!subscribe` | 訂閱每日推送 |
| `!unsubscribe` | 取消訂閱 |
| `!help` | 顯示幫助 |

## 安裝

```bash
cd agents/ai-trends
npm install
```

## 執行

```bash
AI_TRENDS_BOT_TOKEN="your-discord-bot-token" node bot.js
```

## 環境變數

- `AI_TRENDS_BOT_TOKEN` - Discord Bot Token (必填)

## Discord Bot 設置

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 創建新 Application
3. 在 Bot 頁面啟用 `MESSAGE CONTENT INTENT`
4. 複製 Token 設為環境變數
5. 使用 OAuth2 URL Generator 生成邀請連結 (需要 `bot` scope)

## 配置

編輯 `config.json` 設定：

```json
{
  "timezone": "Asia/Taipei",
  "defaultChannelId": null
}
```

- `defaultChannelId`: 設定後會自動推送到該頻道
