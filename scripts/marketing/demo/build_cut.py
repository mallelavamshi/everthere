"""Cut the demo take into one continuous clip (picture + audio) for the Remotion edit.

Picture: segments of the real screen recording (video time = step-log time - 1.2 s), only trims, no retiming except
the parent-side scrolling (sped up, silent). Inside the call, pauses longer than 2.5 s are shortened to 0.6 s.
Audio: the laptop-mic room recording (cleaned: take3.room2.wav; mic time = video time + 3.05 s) carries the parent
avatar's real voice. The child's lines are the clean edge-tts files that were played into the room, placed at the
exact moments they were played; the room track is muted under them.
Writes out/demo/demo_cut.mp4 and demo_cut.json (segment map with output times for captions).
"""
import json
import os
import subprocess
import sys
import wave

import imageio_ffmpeg
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "out", "demo")
FF = imageio_ffmpeg.get_ffmpeg_exe()
TAKE = os.path.join(OUT, "take3.cfr.mp4")  # take3 converted to constant 30 fps (scrcpy records VFR)
ROOM = os.path.join(OUT, "take3.room2.wav")
MIC = 3.05      # mic seconds = video seconds + MIC
LOG = -1.2      # video seconds = log seconds + LOG
SR = 48000
FPS = 30

# Child lines: (audio file, log time it started playing)
CHILD = [("01-miss", 67.32), ("02-song", 84.85), ("03-knee", 107.52), ("04-okay", 133.90), ("05-bye", 156.24)]


CHILD_SECONDS = {"01-miss": 4.9, "02-song": 3.3, "03-knee": 5.5, "04-okay": 4.9, "05-bye": 5.3}


def call_segments():
    """Speech regions inside the call plus every child line's full window; only pauses > 4.5 s are shortened."""
    regions = json.load(open(os.path.join(OUT, "take3.speech.json")))
    regions += [[t + LOG - 0.3, t + LOG + CHILD_SECONDS[n] + 0.4] for n, t in CHILD]
    regions.sort()
    merged = []
    for a, b in regions:
        if merged and a - merged[-1][1] < 4.5:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return merged


# (video from, video to, speed, label)
SEGMENTS = [
    (0.0, 8.0, 1.0, "open"),
    (29.2, 36.6, 1.0, "teacher"),
    (36.6, 43.7, 1.0, "pick"),
    (43.7, 47.6, 1.0, "dialing"),
    (53.6, 54.0, 1.0, "live"),
] + [(a, b, 1.0, "call") for a, b in call_segments()] + [
    (176.3, 180.0, 1.0, "end"),
    (182.6, 190.4, 1.0, "checkin"),
    # After the long still wait for the summary the recording runs ~5 s behind the step log, so the parent-side
    # times below are read off the frames (sheets late1/late2), not computed from the log.
    (193.6, 202.0, 1.4, "switch"),
    (202.0, 207.5, 1.0, "home"),
    (266.8, 276.2, 1.0, "alerts"),
    (278.6, 300.6, 1.5, "transcript"),
]


def load_wav(path):
    w = wave.open(path)
    assert w.getframerate() == SR, w.getframerate()
    return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768


def decode(path):
    raw = subprocess.run([FF, "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768


def main():
    room = load_wav(ROOM)
    child = {name: decode(os.path.join(HERE, "audio", f"{name}-loud.mp3")) * 0.8 for name, _ in CHILD}
    child_at = {name: t + LOG for name, t in CHILD}  # video time each line started

    parts, audio, seg_map, t_out = [], [], [], 0.0
    tmp = os.path.join(OUT, "segs")
    os.makedirs(tmp, exist_ok=True)
    for i, (a, b, speed, label) in enumerate(SEGMENTS):
        dur = (b - a) / speed
        clip = os.path.join(tmp, f"{i:02d}.mp4")
        # scrcpy records variable frame rate (few frames while the screen is still), so convert to constant 30 fps
        # first, then trim, then retime, and cut to an exact frame count. (Trimming the VFR stream directly gave
        # segments seconds too long or short, which put captions and audio out of sync.)
        pre = min(2.0, a)
        frames = int(round(dur * FPS))
        subprocess.run([FF, "-v", "error", "-y", "-ss", f"{a - pre:.3f}", "-i", TAKE,
                        "-vf", f"fps={FPS},trim=start={pre:.3f}:end={pre + (b - a):.3f},setpts=(PTS-STARTPTS)/{speed},fps={FPS}",
                        "-frames:v", str(frames), "-an", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", clip], check=True)
        parts.append(clip)
        n = int(round(dur * SR))
        seg = np.zeros(n, np.float32)
        if speed == 1.0:
            s0 = int(round((a + MIC) * SR))
            src = room[s0:s0 + n]
            seg[:len(src)] = src
            for name, at in child_at.items():  # mute the room under the child's line, lay the clean line instead
                if a - 6 < at < b:
                    line = child[name]
                    o = int(round((at - a) * SR))
                    lo, hi = max(0, o), min(n, o + len(line))
                    if hi > lo:
                        seg[lo:hi] = line[lo - o:hi - o]
        audio.append(seg)
        seg_map.append({"label": label, "from": a, "to": b, "speed": speed, "outStart": round(t_out, 3), "outEnd": round(t_out + dur, 3)})
        t_out += dur

    lst = os.path.join(tmp, "list.txt")
    open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    video = os.path.join(tmp, "video.mp4")
    subprocess.run([FF, "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", video], check=True)
    mix = np.concatenate(audio)
    peak = float(np.abs(mix).max()) or 1.0
    mix = mix / peak * 0.89
    wav = os.path.join(tmp, "audio.wav")
    with wave.open(wav, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((mix * 32767).astype(np.int16).tobytes())
    out = os.path.join(OUT, "demo_cut.mp4")
    subprocess.run([FF, "-v", "error", "-y", "-i", video, "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", out], check=True)
    json.dump({"duration": round(t_out, 3), "segments": seg_map}, open(os.path.join(OUT, "demo_cut.json"), "w"), indent=1)
    print("demo_cut.mp4", round(t_out, 1), "s,", len(SEGMENTS), "segments")


if __name__ == "__main__":
    main()
