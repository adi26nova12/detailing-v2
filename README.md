# APEX — Detail Studio, Melbourne

A scroll-driven cinematic site for a premium detailing studio. Everything on
the page is a position on the scrollbar: there is no autoplay, no video
element, and no animation that plays forward but not backward.

```bash
python -m http.server 5173
# http://localhost:5173
```

It also runs from `file://` — every script is a classic script and nothing is
fetched at runtime — but a local server is better for cache behaviour.

---

## Structure

```
index.html                 markup for all ten scenes
css/main.css               tokens, Swiss grid, every scene's layout
js/config.js               sequence paths, scene beats, service camera targets
js/utils.js                maths, cover-fit, SplitText fallback, magnetics
js/sequence.js             frame loader + Plate (a canvas bound to the sequence)
js/preloader.js            logo draw, progress, curtain
js/scenes.js               the ten scenes
js/main.js                 Lenis + ScrollTrigger boot, velocity, watchdog

assets/model/bmw-m4.glb    the source car (Draco + meshopt, 1.16 M tris)
assets/sequence/hero/      scenes 1-3, 420 frames
assets/sequence/turn/      scene 5's turntable, 240 frames
assets/sequence/turnholo/  scene 5's scan layer, 240 frames
tools/bake/index.html      three.js bake: model -> both frame sequences
tools/bake/sink.py         writes the baked frames to disk
tools/render_sequence.py   the earlier procedural renderer (fallback/reference)
tools/extract_frames.py    Higgsfield video -> the same frame sequence
HIGGSFIELD.md              the alternative, AI-generated route
```

---

## The scenes

| # | Section | Mechanic |
|---|---|---|
| 1–3 | `#hero` | 420-frame sequence scrubbed across 640 vh. Darkness → orbit → ceramic coat → light rails igniting → crane, with the headline resolving per character at 57 % |
| 4 | `#inspect` | Cursor-driven surface analysis. A contamination buffer is erased under the pointer and the six readouts are derived from it |
| 5 | `#services` | **Turntable.** Locked-off camera, car rotating counter-clockwise through one full revolution. The service menu populates down the left a line at a time, each line bringing its own effect over the paint, with a holographic scan tracking whichever service is landing |
| — | `#menu` | Consultation cards: PPF, ceramic, tint, detailing (15 min each) and the New Car Package |
| 6 | `#compare` | Draggable split. The "before" car is the same frame graded down with procedural oxidation, water spots and swirls |
| 7 | `#gallery` | Pinned horizontal scroll, per-shot counter-parallax and clip-path reveal |
| 8 | `#voices` | Glass cards, inertial 3D tilt, depth parallax |
| 9 | `#stats` | Counters on a stepped `CustomEase` so they tick rather than glide |
| 10 | `#book` | Floating hero plate, per-line reveal, pulsing CTA |

---

## Notes on the build

**One smoothing layer.** Lenis owns the scroll position and ScrollTrigger reads
it. GSAP's `ScrollSmoother` is deliberately *not* installed alongside it —
running both smooths an already-smoothed value and puts a visible lag between
the wheel and the frame index. That is the only requested feature left out, and
it is left out on purpose.

Where the rest earn their place:

| Plugin | Used for |
|---|---|
| ScrollTrigger | every scene: pin, scrub, `containerAnimation` on the gallery |
| SplitText | per-character headline reveal (with a manual fallback if the CDN is blocked) |
| Draggable + Inertia | the comparison slider |
| Observer | drag / swipe horizontally anywhere in the gallery to scroll it |
| Flip | the emerald marker that reparents between service list items |
| MotionPath | the highlight raking along the car's shoulder in the booking scene |
| CustomEase | `mass`, `glide` and the stepped `mech` used by the counters |

**Reversibility.** Scenes are either scrubbed timelines or deterministic
`onUpdate` handlers that compute state purely from `self.progress`. No scene
accumulates state across frames, which is why scrolling back retraces the film
exactly instead of approximately.

**Scene 5 is one continuous move.** It once fired a tween whenever the active
service changed, which both cut the animation and made the section imperfectly
reversible (a fire-and-forget tween does not un-fire). Everything is now a pure
function of scroll position:

- The plate scrubs the `turn` sequence directly, so the car rotates
  continuously. Nothing steps.
- `appearOf(i)` reveals each menu line on its own slice and leaves it up — the
  menu *accumulates* rather than cycling.
- `effectWeightOf(i)` / `effectLocalOf(i)` run each service's effect while its
  line is landing. Every effect above the cutoff is drawn in the same pass, so
  they dissolve into each other instead of being swapped.

Round-tripping the section returns identical state, and a 100-sample sweep
shows a max step of 2.4 frames out of 240.

**Contain-fit on the turntable.** The hero crops to fill (cinematic, correct),
but the turntable must always show the whole car, so its plate and scan layer
use `fit: 'contain'`. The letterbox is invisible against the black stage, and
on a 16:9 viewport contain and cover are identical. The canvas effects are
anchored to the drawn image rect rather than the canvas, or they would drift
off the car whenever the viewport is not 16:9.

**Loading.** The preloader blocks on ~81 frames — a coarse ladder across the
whole timeline plus the opening run at full density — so any scroll position
resolves to a real frame immediately. The remaining frames stream afterwards
and the queue re-sorts toward the playhead as you scroll. A watchdog reveals
the page after 14 s regardless, and a background tab (where
`requestAnimationFrame` is suspended) reveals without animation rather than
hanging.

**Cost control.** Frames decode once and are shared by every canvas on the
page. Each `Plate` skips redraw unless its index or transform actually changed.
DPR is capped at 2.

---

## Regenerating the frames

The sequence is baked on the GPU from `assets/model/bmw-m4.glb` by a three.js
scene that reproduces the studio and drives the camera along the same
choreography the site scrolls through.

Start the frame sink and the static server, then open the bake page:

```bash
python tools/bake/sink.py
```

```bash
python -m http.server 5173
```

Open `http://localhost:5173/tools/bake/`, wait for *model ready*, then in the
console:

```js
await BAKE.run(0, 420)     // scenes 1-3  -> assets/sequence/hero/
await BAKE.runTurn(false)  // scene 5     -> assets/sequence/turn/
await BAKE.runTurn(true)   // scene 5 scan-> assets/sequence/turnholo/
```

Roughly **430 ms/frame** for the hero, **390** for the turntable and **195**
for the scan on integrated graphics — about eight minutes for all three.

> Only ever run **one** copy of `sink.py`. Windows lets a second process bind
> the same port, and requests then land on whichever one the OS picks — which
> silently routed a whole hologram bake into the hero folder once. If the two
> sequences disagree, check `Get-NetTCPConnection -LocalPort 5200`.

### The turntable and its scan layer

`runTurn(false)` locks the camera off and rotates the model instead —
`CFG.turn.dir: 1` gives a counter-clockwise revolution seen from above
(rotating about +Y sends a point at +Z toward +X; in a bird's-eye view that is
bottom-to-right, i.e. counter-clockwise). `runTurn(true)` repeats the identical
rotation with the car swapped for a scanned-surface shader — fresnel rim plus
fine horizontal scan lines, no floor, no environment, flat exposure. Frame *n*
of each is the same pose, which is what makes the overlay sit on the car
instead of floating near it.

The travelling scan band is deliberately **not** baked in. `Scenes.services`
composites it at runtime with a `destination-in` gradient mask, so the scan
follows scroll position and reverses with it like everything else.

What the bake does to the model:

- normalises it to 4.80 m long, centred, sitting on the floor, nose toward +X
- repaints the four exterior shell materials (authored as carbon fibre) to
  metallic emerald with a clearcoat, stripping the weave from the colour **and**
  normal maps; mirrors stay carbon on purpose
- ramps the emissive lamps up as exposure falls, so scene 1 is lit by headlights
  alone, and damps the red tail lamps to keep red out of the palette
- ignites the seven light rails one at a time, rebuilding the IBL as it goes
- tightens clearcoat roughness across the coating beat
- renders at 2× and downsamples, which is the cheapest anti-aliasing available

Useful knobs in `CFG` at the top of `tools/bake/index.html`: `paint`, `dolly`
(pull the camera back or in), `quality`, `ss`, `bodyMaterials`.

Two alternative routes are kept in the repo: `tools/render_sequence.py`
(the standalone procedural renderer, needs no model) and
[HIGGSFIELD.md](HIGGSFIELD.md) (AI-generated video).

---

## Known limits

- **The model is an M8 Competition, not an M4.** The gallery copy still says
  "M4 Competition" — change one or the other.
- BMW's design and badging are trademarked. Check the model's licence before
  using this commercially; many marketplace car models are editorial-use only.
- Tuned for desktop and tablet. Below 640 px the scroll heights are long for a
  phone; the reduced-motion media query already shortens them and that is the
  right lever to reuse for a mobile breakpoint.
- Copy, prices and the Cremorne address are placeholders.
- The sequence is 12 MB. The loader only blocks on ~81 frames, but serve
  `assets/sequence/` with a long `Cache-Control` and HTTP/2.
