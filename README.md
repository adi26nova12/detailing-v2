# Studio X Detailing — Melbourne

A scroll-driven cinematic site for Studio X Detailing (Williamstown North, VIC):
ceramic coating, PPF, paint correction, window tinting and complete detailing. Everything on
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
index.html                 markup for all eight scenes, plus the booking dialog
css/main.css               tokens, Swiss grid, every scene's layout
js/config.js               sequence paths, scene beats, service camera targets
js/utils.js                maths, cover-fit, SplitText fallback, magnetics
js/sequence.js             frame loader + Plate (a canvas bound to the sequence)
js/preloader.js            logo draw, progress, curtain
js/scenes.js               the eight scenes
js/booking.js              the booking dialog: services, calendar, details
js/main.js                 Lenis + ScrollTrigger boot, velocity, watchdog

assets/model/bmw-m4.glb    the source car (Draco + meshopt, 1.16 M tris)
assets/sequence/hero/      scenes 1-3, 420 frames
assets/sequence/turn/      scene 4's turntable, 240 frames
assets/sequence/turnholo/  scene 4's scan layer, 240 frames
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
| 4 | `#services` | **Turntable.** Locked-off camera, car rotating counter-clockwise through one full revolution. The service menu populates down the left a line at a time, each line bringing its own effect over the paint, with a holographic scan tracking whichever service is landing, and the framing changing with it — each line owns a `view` in the config and the plate eases from one to the next, so the section is a shot list rather than one unbroken lap. Frame 0 is baked from the hero's final camera, and the section dissolves up over the hero's held last frame, so the opening film becomes the turntable without a cut |
| — | `#menu` | Consultation cards, one per service. Each opens the booking dialog with that service already ticked |
| 5 | `#gallery` | Pinned horizontal scroll, per-shot counter-parallax and clip-path reveal |
| 6 | `#voices` | Glass cards, inertial 3D tilt, depth parallax |
| 7 | `#stats` | Counters on a stepped `CustomEase` so they tick rather than glide |
| 8 | `#book` | Floating hero plate, per-line reveal, and the CTA that opens the booking dialog |

---

## Notes on the build

**The turntable is a shot list.** `view` on each entry in `APEX.services` is
the framing that line lands on — `zoom` relative to the whole car, `ox`/`oy`
holding a part of the frame the way `background-position` does. `viewAt()`
folds in every view above the playhead in order rather than looking one up, so
the move is continuous, has no state of its own, and reverses exactly; each
push-in also starts a little before its line so the camera leads the copy. The
run tightens 1.26 → 1.98 through correction and then opens back out to the
whole car for the package. Everything drawn over the paint — the effects, the
holographic scan — is positioned through the plate's drawn rect, so it all
follows the reframe without being told about it.

**The hero and the turntable are one move.** Three things have to agree or the
hand-off reads as a cut, and all three were wrong at first:

1. *The camera.* `CFG.turn` in the bake is now `CAM_KEYS[last]` verbatim —
   same bearing, elevation, distance, fov and target — with `poseTurnCamera`
   applying `dolly` and the same off-centre `lookAt` as `poseCamera`, and
   `applyTerminalLook()` reproducing the lighting the schedule ends on.
   Turn frame 1 and hero frame 420 differ by a mean of **0.02/255**.
2. *The rotation.* It runs over `(prog - DISS) / (1 - DISS)`, not `prog`.
   Starting it at the top of the section put the car 36° out by the halfway
   point of the fade — two different poses cross-dissolving.
3. *The framing.* The hero fills the viewport, the turntable has to show the
   whole car. Off 16:9 those are different rectangles, so the plate holds the
   hero's exact framing (`zoom = coverRatio()`) for the whole dissolve and
   only eases back to the full car once the hero has gone.

And the stage underneath has to stay still: a sticky element stops sticking at
`sectionHeight - 100vh`, so the hero is 740 vh with its scrub ending a viewport
early, and `.services` is pulled back **two** viewports rather than one. One
viewport put the fade exactly on the release and the hero slid upward through
it. Round-tripping the hand-off shows zero drift.

**No scene numbers on the page.** The sections are numbered in this file and
in the source, not in front of the visitor: `Scene 05 — Before / After` above a
heading is the author's table of contents leaking through the design. The same
went for the pulsing CTA glow, the spark that raked along the car in the
booking scene, and the preloader narrating itself — decoration that announces
it was added because it could be.

**The booking dialog.** `js/booking.js`, styled with the page's own tokens.
Four cards that turn over into each other: service (multi-select, and each card
turns to show what the consultation covers), day and time, contact details,
then a review. Everything it offers comes from `APEX.booking` in `js/config.js`
— the six services, the opening days, `dayStart`/`dayEnd`/`slotMins`, and the
lead time before the first bookable day.

There is no backend and the dialog does not pretend otherwise: the last step
composes a `mailto:` and hands it to the visitor's own mail client, so the
enquiry is only ever sent by them, from their address, with the whole thing in
front of them. If real bookings are wanted, that one line in `booking.js` is
the place to POST instead — the state it needs is already assembled there.

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
| Observer | drag / swipe horizontally anywhere in the gallery to scroll it |
| Flip | the marker that reparents between service list items |
| CustomEase | `mass`, `glide` and the stepped `mech` used by the counters |

**Reversibility.** Scenes are either scrubbed timelines or deterministic
`onUpdate` handlers that compute state purely from `self.progress`. No scene
accumulates state across frames, which is why scrolling back retraces the film
exactly instead of approximately.

**Scene 4 is one continuous move.** It once fired a tween whenever the active
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

**The paint.** The car is dark red because it is *baked* dark red — `CFG.paint`
in `tools/bake/index.html`, plus two of the seven light rails that carried a
green tint and now do not. A runtime hue rotation was tried first and rejected:
a hue rotation preserves the neutral axis but moves everything else, so making
the emerald body red also sent the tail lamps blue and the warm specular
highlights magenta. `APEX.paint.filter` survives as the hook for a grade cheap
enough not to justify re-baking, and is empty.

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
await BAKE.runTurn(false)  // scene 4     -> assets/sequence/turn/
await BAKE.runTurn(true)   // scene 4 scan-> assets/sequence/turnholo/
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
  metallic dark red with a clearcoat, stripping the weave from the colour **and**
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

- **Client-facing copy is still placeholder.** The gallery commissions, the
  four testimonials and the four statistics are template copy attributed to a
  real business — replace them with real work and real reviews before this is
  published. Each block is marked with a `PLACEHOLDER` comment in `index.html`.

- BMW's design and badging are trademarked. Check the model's licence before
  using this commercially; many marketplace car models are editorial-use only.
- Tuned for desktop and tablet. Below 640 px the scroll heights are long for a
  phone; the reduced-motion media query already shortens them and that is the
  right lever to reuse for a mobile breakpoint.
- Prices are not published anywhere; every service routes to an enquiry.
- The sequence is 12 MB. The loader only blocks on ~81 frames, but serve
  `assets/sequence/` with a long `Cache-Control` and HTTP/2.
