"""
Compare whisper timestamps against existing data.js subtitles.
Generate a sync report and suggested corrections.
"""
import json
import re
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
WHISPER_DIR = SCRIPTS_DIR / "whisper-output"
SONGS_DIR = SCRIPTS_DIR.parent.parent / "songs"

def parse_data_js(path):
    """Extract subtitles array from data.js"""
    content = path.read_text()
    subs = []
    # Match subtitle objects
    pattern = r'\{\s*start:\s*([\d.]+)\s*,\s*duration:\s*([\d.]+)\s*,\s*original:\s*["\'](.+?)["\']'
    for m in re.finditer(pattern, content):
        subs.append({
            "start": float(m.group(1)),
            "duration": float(m.group(2)),
            "text": m.group(3),
        })
    return subs

def load_whisper(name):
    path = WHISPER_DIR / f"{name}.json"
    if not path.exists():
        return []
    return json.loads(path.read_text())

def analyze_song(name):
    data_path = SONGS_DIR / name / "data.js"
    if not data_path.exists():
        return None
    
    existing = parse_data_js(data_path)
    whisper = load_whisper(name)
    
    if not whisper or len(whisper) < 3:
        return {"name": name, "status": "insufficient_whisper_data", "existing_lines": len(existing), "whisper_segments": len(whisper)}
    
    # Find first matching line to determine offset
    first_whisper_start = whisper[0]["start"]
    first_existing_start = existing[0]["start"] if existing else 0
    offset_diff = first_whisper_start - first_existing_start
    
    return {
        "name": name,
        "status": "has_data",
        "existing_lines": len(existing),
        "whisper_segments": len(whisper),
        "first_existing_start": first_existing_start,
        "first_whisper_start": first_whisper_start,
        "offset_suggestion": round(offset_diff, 2),
        "whisper_preview": whisper[:5],
    }

def main():
    songs = ["Bohemian_Rhapsody", "Hello_Goodbye", "Hotel_California", 
             "Let_It_Be", "Losing_My_Religion", "Stand_By_Me", "Wonderwall"]
    
    print("=" * 70)
    print("SYNC ANALYSIS REPORT")
    print("=" * 70)
    
    for name in songs:
        result = analyze_song(name)
        if not result:
            continue
        
        print(f"\n{'─' * 50}")
        print(f"  {name}")
        print(f"{'─' * 50}")
        print(f"  Existing lines: {result['existing_lines']}")
        print(f"  Whisper segments: {result['whisper_segments']}")
        print(f"  Status: {result['status']}")
        
        if result['status'] == 'has_data':
            print(f"  First existing start: {result['first_existing_start']}s")
            print(f"  First whisper start:  {result['first_whisper_start']}s")
            print(f"  Suggested offset:     {result['offset_suggestion']}s")
            print(f"  Whisper preview:")
            for seg in result['whisper_preview']:
                print(f"    [{seg['start']:6.2f} - {seg['end']:6.2f}] {seg['text']}")
    
    print(f"\n{'=' * 70}")
    print("RECOMMENDATIONS:")
    print("=" * 70)
    print("""
Songs with good Whisper data (can auto-correct timestamps):
  - Let_It_Be: 15 segments, good quality
  - Wonderwall: 9 segments, first 6 reliable  
  - Stand_By_Me: 7 segments, usable

Songs needing manual sync (Whisper insufficient):
  - Bohemian_Rhapsody: VAD filters opera sections
  - Hotel_California: Long intro confuses VAD
  - Hello_Goodbye: Nearly all filtered
  - Losing_My_Religion: Only 2 segments detected
    """)

if __name__ == "__main__":
    main()
