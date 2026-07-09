"""
Use ffmpeg silencedetect to find when vocals start in each song.
This gives us the intro offset to correct subtitle timing.
"""
import subprocess
import re
import sys
from pathlib import Path

SONGS_DIR = Path(__file__).resolve().parent.parent.parent / "songs"
PROBLEM_SONGS = ["Bohemian_Rhapsody", "Hello_Goodbye", "Hotel_California", "Losing_My_Religion"]

def detect_first_sound(mp3_path, noise_level="-30dB", duration=0.5):
    """Use silencedetect to find when the first non-silent section starts."""
    cmd = [
        "ffmpeg", "-i", str(mp3_path),
        "-af", f"silencedetect=noise={noise_level}:d={duration}",
        "-f", "null", "-"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    stderr = result.stderr
    
    # Find silence_end timestamps (= when sound starts)
    ends = re.findall(r'silence_end: ([\d.]+)', stderr)
    if ends:
        return float(ends[0])
    return 0.0

def main():
    songs = sys.argv[1:] if len(sys.argv) > 1 else PROBLEM_SONGS
    
    print("Detecting vocal onset with ffmpeg silencedetect")
    print("=" * 50)
    
    for name in songs:
        song_dir = SONGS_DIR / name
        mp3s = list(song_dir.glob("*.mp3"))
        if not mp3s:
            continue
        
        mp3 = mp3s[0]
        
        # Try different noise levels
        onset_30 = detect_first_sound(mp3, "-30dB", 0.3)
        onset_25 = detect_first_sound(mp3, "-25dB", 0.5)
        onset_20 = detect_first_sound(mp3, "-20dB", 1.0)
        
        print(f"\n{name} ({mp3.name}):")
        print(f"  First sound at -30dB: {onset_30:.2f}s")
        print(f"  First sound at -25dB: {onset_25:.2f}s")
        print(f"  Vocal onset at -20dB: {onset_20:.2f}s")

if __name__ == "__main__":
    main()
