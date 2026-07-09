"""
Apply timestamp offset corrections to data.js files based on Whisper analysis.
Shifts all subtitle start times by the detected offset.
"""
import re
import sys
from pathlib import Path

SONGS_DIR = Path(__file__).resolve().parent.parent.parent / "songs"

# Offsets determined by comparing Whisper's detected first-line start 
# vs existing data.js first-line start
CORRECTIONS = {
    "Hotel_California": 40.0,
    "Losing_My_Religion": 14.0,
    "Bohemian_Rhapsody": -2.0,
    "Hello_Goodbye": -2.0,
}

def shift_subtitles(data_path, offset):
    content = data_path.read_text()
    
    def replace_start(match):
        old_val = float(match.group(1))
        new_val = max(0, round(old_val + offset, 1))
        # Keep integer if it's a whole number
        if new_val == int(new_val):
            return f"start: {int(new_val)}"
        return f"start: {new_val}"
    
    new_content = re.sub(r'start:\s*([\d.]+)', replace_start, content)
    return new_content

def main():
    if len(sys.argv) > 1:
        # Process specific song
        names = sys.argv[1:]
    else:
        names = list(CORRECTIONS.keys())
    
    for name in names:
        if name not in CORRECTIONS:
            print(f"No correction defined for {name}, skipping")
            continue
        
        data_path = SONGS_DIR / name / "data.js"
        if not data_path.exists():
            print(f"No data.js for {name}")
            continue
        
        offset = CORRECTIONS[name]
        print(f"{name}: applying offset {offset:+.2f}s")
        
        new_content = shift_subtitles(data_path, offset)
        data_path.write_text(new_content)
        print(f"  Updated {data_path}")

if __name__ == "__main__":
    main()
