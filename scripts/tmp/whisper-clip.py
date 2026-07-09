"""Transcribe only the first N seconds of a song to find vocal onset."""
import sys
import subprocess
import json
import tempfile
from pathlib import Path
from faster_whisper import WhisperModel

def main():
    if len(sys.argv) < 2:
        print("Usage: whisper-clip.py <song_folder> [start_sec] [end_sec]")
        sys.exit(1)
    
    song_name = sys.argv[1]
    start = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    end = int(sys.argv[3]) if len(sys.argv) > 3 else 90
    
    songs_dir = Path(__file__).resolve().parent.parent.parent / "songs"
    mp3s = list((songs_dir / song_name).glob("*.mp3"))
    if not mp3s:
        print("No mp3 found")
        sys.exit(1)
    
    # Extract clip with ffmpeg
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    subprocess.run([
        "ffmpeg", "-y", "-i", str(mp3s[0]),
        "-ss", str(start), "-to", str(end),
        "-ar", "16000", "-ac", "1",
        tmp.name
    ], capture_output=True)
    
    print(f"Transcribing {song_name} [{start}s - {end}s]...", flush=True)
    model = WhisperModel("base", device="cpu", compute_type="int8")
    
    segments, info = model.transcribe(
        tmp.name,
        language="en",
        word_timestamps=True,
        vad_filter=False,
        no_speech_threshold=0.6,
        condition_on_previous_text=True,
    )
    
    results = []
    for seg in segments:
        actual_start = seg.start + start
        actual_end = seg.end + start
        results.append({
            "start": round(actual_start, 2),
            "end": round(actual_end, 2),
            "text": seg.text.strip(),
        })
        print(f"  [{actual_start:6.2f} - {actual_end:6.2f}] {seg.text.strip()}", flush=True)
    
    import os
    os.unlink(tmp.name)
    print(f"\n{len(results)} segments found")

if __name__ == "__main__":
    main()
