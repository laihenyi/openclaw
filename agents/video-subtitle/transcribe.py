#!/usr/bin/env python3
"""
Local Whisper transcription using faster-whisper
"""
import sys
from faster_whisper import WhisperModel

# Use medium model for better accuracy
# Options: tiny, base, small, medium, large-v2, large-v3
MODEL_SIZE = "medium"

# Initialize model (will download on first run)
model = None

def get_model():
    global model
    if model is None:
        print(f"Loading Whisper model: {MODEL_SIZE}...", file=sys.stderr)
        model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
        print("Model loaded!", file=sys.stderr)
    return model

def transcribe(audio_path: str) -> str:
    """Transcribe audio file to Traditional Chinese text"""
    m = get_model()

    segments, info = m.transcribe(
        audio_path,
        language="zh",
        task="transcribe",
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(
            min_silence_duration_ms=500,
        ),
        initial_prompt="以下是繁體中文對話。",
        condition_on_previous_text=False,
        no_speech_threshold=0.6,
        log_prob_threshold=-1.0,
    )

    # Combine all segments, filter out hallucinations
    segment_list = list(segments)  # Force evaluation of generator
    print(f"Found {len(segment_list)} segments", file=sys.stderr)

    # Filter segments with low confidence (likely hallucinations)
    valid_segments = []
    for segment in segment_list:
        # Skip segments with very low average log probability
        if segment.avg_logprob < -1.0:
            print(f"Skipping low confidence segment: {segment.text}", file=sys.stderr)
            continue
        # Skip known hallucination patterns
        if any(pattern in segment.text for pattern in ["字幕", "索兰", "謝謝觀看", "订阅", "訂閱"]):
            print(f"Skipping hallucination: {segment.text}", file=sys.stderr)
            continue
        valid_segments.append(segment)

    text = " ".join(segment.text.strip() for segment in valid_segments)
    return text

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: transcribe.py <audio_file>", file=sys.stderr)
        sys.exit(1)

    audio_file = sys.argv[1]
    result = transcribe(audio_file)
    print(result, flush=True)
    sys.stdout.flush()
