"""Get word-level timestamps for a song to enable line-by-line sync."""
import sys
import json
from pathlib import Path
from faster_whisper import WhisperModel

def main():
    if len(sys.argv) < 2:
        print("Usage: whisper-words.py <song_folder_name> [language]")
        sys.exit(1)
    
    song_name = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else "en"
    
    songs_dir = Path(__file__).resolve().parent.parent.parent / "songs"
    song_dir = songs_dir / song_name
    
    mp3s = list(song_dir.glob("*.mp3"))
    if not mp3s:
        print(f"No mp3 found in {song_dir}")
        sys.exit(1)
    
    audio_path = mp3s[0]
    print(f"Transcribing with word timestamps: {audio_path.name}", flush=True)
    
    model = WhisperModel("base", device="cpu", compute_type="int8")
    
    import signal
    def handler(s, f): raise TimeoutError()
    signal.signal(signal.SIGALRM, handler)
    signal.alarm(480)
    
    try:
        segments, info = model.transcribe(
            str(audio_path),
            language=lang,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=200, speech_pad_ms=400, threshold=0.25),
            hallucination_silence_threshold=2.0,
            no_speech_threshold=0.45,
        )
        
        all_words = []
        for seg in segments:
            if seg.words:
                for w in seg.words:
                    all_words.append({
                        "word": w.word.strip(),
                        "start": round(w.start, 2),
                        "end": round(w.end, 2),
                        "probability": round(w.probability, 3),
                    })
    except TimeoutError:
        print("TIMEOUT")
        all_words = []
    finally:
        signal.alarm(0)
    
    output_dir = Path(__file__).resolve().parent / "whisper-output"
    output_dir.mkdir(exist_ok=True)
    out_file = output_dir / f"{song_name}_words.json"
    
    with open(out_file, "w") as f:
        json.dump(all_words, f, indent=2, ensure_ascii=False)
    
    print(f"{len(all_words)} words saved to {out_file}")
    
    # Print first 30 words with timestamps
    for w in all_words[:40]:
        print(f"  [{w['start']:6.2f}] {w['word']} ({w['probability']:.2f})")

if __name__ == "__main__":
    main()
