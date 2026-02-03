#!/usr/bin/env python3
"""
Text-to-Speech using Edge TTS (Microsoft)
"""
import sys
import asyncio
import edge_tts

# 繁體中文女聲 (台灣)
VOICE = "zh-TW-HsiaoChenNeural"
# 其他選項:
# "zh-TW-YunJheNeural" - 台灣男聲
# "zh-CN-XiaoxiaoNeural" - 大陸女聲
# "zh-CN-YunxiNeural" - 大陸男聲

async def text_to_speech(text: str, output_path: str):
    """Convert text to speech and save as MP3"""
    communicate = edge_tts.Communicate(text, VOICE)
    await communicate.save(output_path)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: tts.py <text> <output_path>", file=sys.stderr)
        sys.exit(1)

    text = sys.argv[1]
    output_path = sys.argv[2]

    asyncio.run(text_to_speech(text, output_path))
    print(f"Saved: {output_path}")
