# Hero sequence — Higgsfield pipeline (alternative route)

> **Superseded.** The shipped sequence is now baked on the GPU from the real
> `assets/model/bmw-m4.glb` via `tools/bake/index.html` — see the README. That
> produces photoreal frames with perfect shot-to-shot consistency, which is
> exactly the thing AI video is worst at, so there is no longer a reason to
> reach for this route.
>
> It is kept because it still works, and because it is the only option if the
> model ever has to be dropped for licensing reasons.

Note that Higgsfield frames were never generated in the first place: the
connected account reports `credits: 0` on the `free` plan, and video generation
cannot be submitted without credits.

---

## 1. What the site expects

| | |
|---|---|
| Location | `assets/sequence/hero/` |
| Filenames | `frame_0001.webp` … `frame_0420.webp` (4-digit, 1-based, contiguous) |
| Aspect | 16:9 |
| Width | 1600 px (1920 also fine — see note on weight) |
| Count | whatever you generate; set `APEX.sequence.count` in `js/config.js` |

Nothing else in the codebase references frame content. Drop new files in that
folder, update `count`/`width`/`height` in `js/config.js`, done.

---

## 2. Generate the clips

Six clips, generated in this order, become one continuous scroll. Use an
image-to-video model with a start frame so the car identity holds across cuts:
generate **one hero still first**, then use it as `start_image` for every clip.

### Step 1 — the hero still

Model: `nano_banana_pro` (4K) or `marketing_studio_image`. Aspect `16:9`.

> Metallic emerald green BMW M4 Competition inside a dark luxury automotive
> detailing studio. Wet glossy ceramic-coated paint, deep candy emerald
> basecoat with fine aluminium flake, mirror clearcoat. Black polished concrete
> floor with long soft reflections. Matte charcoal walls, dark brushed metal
> detailing, floating rectangular light panels overhead. Volumetric fog, strong
> rim light along the shoulder line, long thin studio strip reflections running
> the length of the body. Ray-traced lighting, hyper realistic, extremely sharp
> detail, 8k product photography, shot on 85mm, shallow depth of field.
> No people. No signage. No text. No outdoor environment.

Negative / avoid: `daylight, road, city, sky, red accents, blue neon, orange
gradient, motion blur, license plate, watermark`.

### Step 2 — the six clips

Pass the still as `start_image`. Model: `kling3_0` (multi-shot, best motion) or
`kling3_0_turbo` for speed. Duration 5 s each, `aspect_ratio: "16:9"`.
**Disable audio and any auto-generated camera shake.**

| # | Beat | Prompt (camera direction) |
|---|---|---|
| 1 | Discovery | *Almost total darkness. Only the headlights glow. Camera creeps forward very slowly at knee height toward the front three-quarter. Tiny specular reflections trace the silhouette out of black. Extremely slow dolly. No cuts.* |
| 2 | Orbit | *Camera slowly arcs around the front quarter panel. Long studio strip reflections travel across the wet paint. Fine dust drifts through the light. Ceramic coating flashes across the surface and micro-scratches vanish. Slow smooth orbit, no cuts.* |
| 3 | Ignition | *Camera cranes upward and pulls back to reveal the whole car. Overhead light rails switch on one strip at a time, left to right. Fog lifts. Slow crane up, no cuts.* |
| 4 | Hood | *Slow push in to the hood surface until the reflection fills frame, swirl marks dissolving into a mirror finish. Macro push, no cuts.* |
| 5 | Wheel | *Slow orbit around the front wheel. Wheel rotates a quarter turn. Brake dust dissolves off the forged face, metal finish restored. No cuts.* |
| 6 | Rest | *Wide, slow, high three-quarter. The car sits still under the full lighting rig. Almost imperceptible camera drift. No cuts.* |

Consistency notes that matter more than prompt wording:
- Always the **same start image**, or the paint tone shifts between clips.
- Ask for **no cuts** explicitly — multi-shot models will otherwise insert one,
  and a cut mid-scrub reads as a broken scroll.
- Keep every camera move in one direction. The sequence is scrubbed both ways;
  a move that reverses inside a clip looks like a stutter on the way back up.

---

## 3. Convert to the sequence

```bash
python tools/extract_frames.py --frames 420 --width 1600 clip1.mp4 clip2.mp4 clip3.mp4 clip4.mp4 clip5.mp4 clip6.mp4
```

The script splits the 420-frame budget across clips by duration, centre-crops
to 16:9, encodes WebP, renumbers contiguously and rewrites
`assets/sequence/manifest.json`. It prints a reminder if the final count is not
420.

Needs `ffmpeg` on PATH:

```bash
winget install Gyan.FFmpeg
```

---

## 4. Weight

The procedural sequence is ~19 KB/frame (≈8 MB total) because the scene is
mostly black. Photographic frames compress far worse — budget **60–110 KB per
frame at 1600 px**, so 420 frames lands around 25–45 MB.

That is fine for the loader (it only blocks on ~81 priority frames and streams
the rest), but if it feels heavy:

- drop `--width` to 1440,
- raise `ladderStep` in `js/config.js` from 12 to 16,
- or cut `count` to 300 and regenerate.

Serve the folder with a long `Cache-Control` and, ideally, HTTP/2.

---

## 5. Verifying the swap

```bash
python -m http.server 5173
```

Then open `http://localhost:5173`, and in the console:

```js
APEX_APP.seq.readyCount    // should reach APEX.sequence.count
APEX_APP.hero.index        // frame index under the current scroll position
```

Scrub the hero to the bottom and back to the top. If the reveal reverses
exactly, the sequence is contiguous and correctly numbered.
