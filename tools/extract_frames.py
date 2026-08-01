"""
Turn Higgsfield video output into the site's hero image sequence.

Point it at one or more clips in scroll order and it writes
assets/sequence/hero/frame_0001.webp ... frame_0420.webp plus the manifest,
which is exactly what js/config.js already expects. Nothing in the site
changes -- only assets/sequence/hero/ is replaced.

    python tools/extract_frames.py shot_a.mp4 shot_b.mp4 shot_c.mp4
    python tools/extract_frames.py --frames 420 --width 1920 clips/*.mp4

Requires ffmpeg on PATH (https://ffmpeg.org/download.html). On Windows:
    winget install Gyan.FFmpeg
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile


def ffprobe_duration(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("clips", nargs="+", help="source videos, in scroll order")
    ap.add_argument("--frames", type=int, default=420)
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        print("ffmpeg/ffprobe not found on PATH.", file=sys.stderr)
        return 2

    clips: list[str] = []
    for pattern in args.clips:
        hits = sorted(glob.glob(pattern))
        clips.extend(hits or [pattern])
    missing = [c for c in clips if not os.path.isfile(c)]
    if missing:
        print("missing: " + ", ".join(missing), file=sys.stderr)
        return 2

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = args.out or os.path.join(root, "assets", "sequence", "hero")
    os.makedirs(out_dir, exist_ok=True)
    for old in glob.glob(os.path.join(out_dir, "frame_*.webp")):
        os.remove(old)

    # Split the frame budget across clips by duration, so a longer beat gets
    # proportionally more frames and the scrub speed stays even.
    durations = [ffprobe_duration(c) for c in clips]
    total = sum(durations)
    budgets = [max(1, round(args.frames * d / total)) for d in durations]
    budgets[-1] += args.frames - sum(budgets)

    height = int(round(args.width * 9 / 16))
    written = 0

    with tempfile.TemporaryDirectory() as tmp:
        for clip, dur, budget in zip(clips, durations, budgets):
            stage = os.path.join(tmp, "stage")
            os.makedirs(stage, exist_ok=True)
            fps = budget / dur
            print(f"{os.path.basename(clip)}: {dur:.2f}s -> {budget} frames ({fps:.2f} fps)", flush=True)

            subprocess.run([
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", clip,
                "-vf", (f"fps={fps:.6f},scale={args.width}:{height}"
                        f":force_original_aspect_ratio=increase,"
                        f"crop={args.width}:{height}"),
                "-c:v", "libwebp", "-lossless", "0",
                "-q:v", str(args.quality), "-compression_level", "5",
                os.path.join(stage, "%05d.webp"),
            ], check=True)

            grabbed = sorted(glob.glob(os.path.join(stage, "*.webp")))
            # ffmpeg's fps filter can land one over or under; trim or hold the
            # tail so the running index never drifts.
            if len(grabbed) > budget:
                grabbed = grabbed[:budget]
            while len(grabbed) < budget and grabbed:
                grabbed.append(grabbed[-1])

            for src in grabbed:
                written += 1
                shutil.move(src, os.path.join(out_dir, f"frame_{written:04d}.webp"))
            for leftover in glob.glob(os.path.join(stage, "*.webp")):
                os.remove(leftover)

    size = sum(os.path.getsize(os.path.join(out_dir, f))
               for f in os.listdir(out_dir) if f.endswith(".webp"))
    manifest = {
        "source": "higgsfield",
        "clips": [os.path.basename(c) for c in clips],
        "pattern": "assets/sequence/hero/frame_{index}.webp",
        "pad": 4, "start": 1, "count": written,
        "width": args.width, "height": height, "bytes": size,
    }
    with open(os.path.join(os.path.dirname(out_dir), "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)

    print(f"\nwrote {written} frames, {size / 1e6:.1f} MB")
    if written != args.frames:
        print(f"NOTE: set APEX.sequence.count = {written} in js/config.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())
