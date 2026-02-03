#!/bin/bash

# Video Subtitle Agent 啟動腳本

cd "$(dirname "$0")"

# 載入環境變數
if [ -f "../../.env" ]; then
  export $(grep -v '^#' ../../.env | xargs)
fi

# 檢查 token
if [ -z "$VIDEO_SUBTITLE_BOT_TOKEN" ]; then
  echo "錯誤：VIDEO_SUBTITLE_BOT_TOKEN 未設定"
  echo ""
  echo "請設定環境變數："
  echo "  export VIDEO_SUBTITLE_BOT_TOKEN=\"your-bot-token\""
  echo ""
  echo "或在 ~/.openclaw/.env 中添加："
  echo "  VIDEO_SUBTITLE_BOT_TOKEN=your-bot-token"
  exit 1
fi

# 檢查 node_modules
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# 啟動 Bot
echo "Starting Video Subtitle Agent..."
exec node bot.js 2>&1 | tee -a video-subtitle.log
