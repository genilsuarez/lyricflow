"""Transcribe a single song with faster-whisper small model."""
import sys
import json
import signal
from pathlib import Path
from faster_whisper import WhisperModel

def timeout_handler(signum, frame):
    raise TimeoutError("Transcription took too long")

def main():
    if len(sys.argv) < 2:
        print("Usage: whisper-one.py <song_folder_name> [language]")
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
    print(f"Transcribing: {audio_path.name} [lang={lang}]", flush=True)
    
    model = WhisperModel("small", device="cpu", compute_type="int8")
    print("Model loaded", flush=True)
    
    # Set 8-minute timeout per song
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(480)
    
    try:
        segments, info = model.transcribe(
            str(audio_path),
            language=lang,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=200,
                speech_pad_ms=400,
                threshold=0.25,
            ),
            hallucination_silence_threshold=2.0,
            no_speech_threshold=0.45,
            condition_on_previous_text=True,
        )
        
        results = []
        for seg in segments:
            results.append({
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": seg.text.strip(),
            })
            print(f"  [{seg.start:6.2f} - {seg.end:6.2f}] {seg.text.strip()}", flush=True)
    except TimeoutError:
        print("TIMEOUT - transcription took too long", flush=True)
        results = []
    finally:
        signal.alarm(0)
    
    output_dir = Path(__file__).resolve().parent / "whisper-output"
    output_dir.mkdir(exist_ok=True)
    out_file = output_dir / f"{song_name}.json"
    
    with open(out_file, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    print(f"\n{len(results)} segments saved to {out_file}", flush=True)

if __name__ == "__main__":
    main()
