"""
Transcribe songs with faster-whisper and output word-level timestamps.
Uses medium model without VAD for better music transcription.
"""

import sys
import os
import json
from pathlib import Path

from faster_whisper import WhisperModel

SONGS_DIR = Path(__file__).resolve().parent.parent.parent / "songs"

# Songs to process (skip already-validated ones)
SKIP = {"Imagine", "Derniere_Danse"}

def get_song_folders():
    folders = []
    for d in sorted(SONGS_DIR.iterdir()):
        if d.is_dir() and d.name not in SKIP:
            mp3s = list(d.glob("*.mp3"))
            if mp3s:
                folders.append((d.name, mp3s[0]))
    return folders

def transcribe(model, audio_path, language="en"):
    segments, info = model.transcribe(
        str(audio_path),
        language=language,
        word_timestamps=True,
        vad_filter=False,
        condition_on_previous_text=True,
    )
    results = []
    for seg in segments:
        results.append({
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": seg.text.strip(),
        })
    return results

def main():
    print("Loading faster-whisper model (small)...")
    model = WhisperModel("small", device="cpu", compute_type="int8")
    
    songs = get_song_folders()
    print(f"Processing {len(songs)} songs...\n")
    
    output_dir = Path(__file__).resolve().parent / "whisper-output"
    output_dir.mkdir(exist_ok=True)
    
    for name, mp3_path in songs:
        lang = "fr" if "Danse" in name or "Derniere" in name else "en"
        print(f"--- {name} ({mp3_path.name}) [lang={lang}] ---")
        
        segments = transcribe(model, mp3_path, language=lang)
        
        out_file = output_dir / f"{name}.json"
        with open(out_file, "w") as f:
            json.dump(segments, f, indent=2, ensure_ascii=False)
        
        print(f"  {len(segments)} segments -> {out_file.name}")
        for seg in segments[:5]:
            print(f"    [{seg['start']:6.2f} - {seg['end']:6.2f}] {seg['text']}")
        if len(segments) > 5:
            print(f"    ... ({len(segments) - 5} more)")
        print()
    
    print("Done! Check whisper-output/ for full transcriptions.")

if __name__ == "__main__":
    main()
