"""Record the room through the laptop mic (mono WAV at the device rate) until a stop file appears. Used during demo takes:
the phone plays the parent avatar aloud (Android won't let scrcpy capture call audio), the PC speakers play the child.
Usage: python -I record_mic.py <out.wav> <stopfile> [device]"""
import os, sys, time, wave
import numpy as np
import sounddevice as sd

out, stop = sys.argv[1], sys.argv[2]
dev = int(sys.argv[3]) if len(sys.argv) > 3 else 18  # the laptop mic array via WDM-KS: ~6x the level of the WASAPI endpoint
sr = int(sd.query_devices(dev)["default_samplerate"])
w = wave.open(out, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
def cb(indata, frames, t, status):
    w.writeframes((np.clip(indata[:, 0], -1, 1) * 32767).astype(np.int16).tobytes())
with sd.InputStream(device=dev, channels=1, samplerate=sr, dtype="float32", callback=cb):
    open(out + ".started", "w").write(str(time.time()))
    while not os.path.exists(stop):
        time.sleep(0.05)
w.close()
print("saved", out)
