"""Animate the promo scenes with Wan 2.2 image-to-video (A14B) on a Modal GPU.

Each scene still (device screen in chroma green) becomes a ~5 s clip of natural human motion. The green screen stays
green so the real app's screen recording can be keyed in afterwards (scripts/marketing/promo/key_screen.py).

Patterned on V:\\talking-avatar\\modal_jobs\\gen_clips.py (Wan 2.1 FLF2V on Modal), with the newer Wan 2.2 I2V model.

Usage (from scripts/marketing):
    modal run promo/wan_i2v.py::download                     # once, CPU only: caches the weights on the volume
    modal run promo/wan_i2v.py --shots s01,s02               # some shots
    modal run promo/wan_i2v.py --shots all
Outputs: out/promo/wan/<shot>_<seed>.mp4 (16 fps, near-lossless H.264) and a .json with the settings.
"""
import io
import json
import pathlib

import modal

MODEL_ID = "Wan-AI/Wan2.2-I2V-A14B-Diffusers"
MODEL_DIR = "/cache/wan22-i2v-a14b"

app = modal.App("everthere-promo")
hf_cache = modal.Volume.from_name("avatar-hf-cache", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "torch==2.8.0",
        "torchvision==0.23.0",
        "diffusers>=0.35.1",
        "transformers>=4.51.3",
        "accelerate>=1.6.0",
        "huggingface_hub[hf_transfer]>=0.30",
        "sentencepiece",
        "ftfy",
        "imageio[ffmpeg]",
        "numpy",
        "pillow",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

NEGATIVE = (
    "text, subtitles, watermark, logo, words on the screen, icons on the screen, the device screen changing color, "
    "distorted hands, extra fingers, deformed face, warped body, flicker, jitter, blurry, low quality, oversaturated, "
    "cartoon, static image, frozen, camera shake, fast cuts"
)


@app.function(image=image, volumes={"/cache": hf_cache}, timeout=3 * 3600, cpu=4, memory=16384)
def download():
    from huggingface_hub import snapshot_download

    marker = pathlib.Path(MODEL_DIR) / ".complete"
    if marker.exists():
        print("model already cached")
        return
    snapshot_download(MODEL_ID, local_dir=MODEL_DIR)
    marker.write_text("ok")
    hf_cache.commit()
    print("downloaded", MODEL_ID)


@app.cls(image=image, gpu=["H100", "A100-80GB"], volumes={"/cache": hf_cache}, timeout=2 * 3600, memory=131072, max_containers=6)
class Animator:
    @modal.enter()
    def load(self):
        import torch
        from diffusers import WanImageToVideoPipeline

        self.pipe = WanImageToVideoPipeline.from_pretrained(MODEL_DIR, torch_dtype=torch.bfloat16)
        total = torch.cuda.get_device_properties(0).total_memory
        # Keep only the active 14B expert on the GPU. Loading everything on an 80 GB H100 was no faster (~24 min a
        # clip either way) and ran out of memory in the 720p VAE decode on 2 of 8 shots.
        self.pipe.enable_model_cpu_offload()
        print("GPU", torch.cuda.get_device_name(0), round(total / 1e9), "GB")

    @modal.method()
    def animate(self, shot: str, prompt: str, png: bytes, seed: int, steps: int = 40, guidance: float = 3.5,
                num_frames: int = 81, max_area: int = 1280 * 720) -> dict:
        import time

        import imageio.v3 as iio
        import numpy as np
        import torch
        from PIL import Image

        t0 = time.time()
        img = Image.open(io.BytesIO(png)).convert("RGB")
        mod = self.pipe.vae_scale_factor_spatial * self.pipe.transformer.config.patch_size[1]
        aspect = img.height / img.width
        height = round(np.sqrt(max_area * aspect)) // mod * mod
        width = round(np.sqrt(max_area / aspect)) // mod * mod
        img = img.resize((width, height), Image.LANCZOS)
        frames = self.pipe(
            image=img,
            prompt=prompt,
            negative_prompt=NEGATIVE,
            height=height,
            width=width,
            num_frames=num_frames,
            num_inference_steps=steps,
            guidance_scale=guidance,
            generator=torch.Generator("cuda").manual_seed(seed),
            output_type="np",
        ).frames[0]
        frames = (np.clip(frames, 0, 1) * 255).round().astype(np.uint8)
        buf = io.BytesIO()
        iio.imwrite(buf, frames, extension=".mp4", fps=16, codec="libx264", output_params=["-crf", "12", "-pix_fmt", "yuv420p"])
        secs = round(time.time() - t0)
        print(shot, seed, f"{width}x{height}", len(frames), "frames", secs, "s")
        return {"mp4": buf.getvalue(), "width": width, "height": height, "frames": len(frames), "seconds": secs}


@app.local_entrypoint()
def main(shots: str = "all", seeds: str = "7"):
    here = pathlib.Path(__file__).resolve().parent
    spec = json.loads((here / "shots.json").read_text(encoding="utf-8"))
    names = list(spec) if shots == "all" else shots.split(",")
    out = here.parent / "out" / "promo" / "wan"
    out.mkdir(parents=True, exist_ok=True)
    jobs = []
    for name in names:
        s = spec[name]
        png = (here.parent / "out" / "scenes" / s["scene"] / f"{s['pick']}.png").read_bytes()
        for seed in [int(x) for x in seeds.split(",")]:
            jobs.append((name, s["prompt"], png, seed))
    animator = Animator()
    for (name, prompt, _, seed), res in zip(jobs, animator.animate.starmap(jobs)):
        (out / f"{name}_{seed}.mp4").write_bytes(res.pop("mp4"))
        (out / f"{name}_{seed}.json").write_text(json.dumps({"prompt": prompt, "seed": seed, **res}, indent=2))
        print("saved", name, seed, res)
