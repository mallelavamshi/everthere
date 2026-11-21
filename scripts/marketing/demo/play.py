"""Play an audio file through the PC's default speakers (blocking). Used to "speak" the child's lines to the phone."""
import subprocess, sys
import numpy as np
import sounddevice as sd
import imageio_ffmpeg

def play(path, gain=1.0):
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    raw = subprocess.run([ff, "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "48000", "-"], capture_output=True, check=True).stdout
    a = np.frombuffer(raw, np.int16).astype(np.float32) / 32768 * gain
    sd.play(np.clip(a, -1, 1), 48000, blocking=True)

if __name__ == "__main__":
    play(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 1.0)
