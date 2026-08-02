/* ============================================================================
   Studio X Detailing — scene choreography

   Every scene is either a scrubbed timeline or a deterministic onUpdate. No
   scene holds state that depends on the direction of travel, which is what
   makes scrolling back reverse the film exactly rather than approximately.
   ========================================================================== */
(function (w) {
  'use strict';

  const U = w.APEX_U;
  const g = w.gsap;
  const ST = w.ScrollTrigger;
  const C = w.APEX;

  /* Weighted eases. Nothing here uses a default. */
  const E = {};
  function buildEases() {
    if (!w.CustomEase) {
      E.mass = 'power3.out'; E.glide = 'power2.inOut'; E.mech = 'steps(12)';
      return;
    }
    // weight, then settle — nothing arrives at a constant speed
    E.mass  = w.CustomEase.create('mass',  'M0,0 C0.16,0 0.09,0.83 0.28,0.94 0.43,1.02 0.72,1 1,1');
    E.glide = w.CustomEase.create('glide', 'M0,0 C0.5,0 0.2,1 1,1');
    // a stepped ramp: the counters tick like a mechanical readout
    E.mech  = w.CustomEase.create('mech',  'M0,0 C0.3,0 0.1,0.5 0.4,0.5 0.7,0.5 0.62,1 1,1');
  }

  /* A single ticker drives every canvas effect; per-scene rAF loops compete
     with GSAP for the frame budget. */
  const loops = [];
  function addLoop(fn) { loops.push(fn); }
  function runLoops(time, delta) {
    for (let i = 0; i < loops.length; i++) loops[i](time, delta);
  }

  const Scenes = {};

  /* ══════════════════════════════════════════════════════════════════════
     SCENES 1–3 · discovery, coating, ignition
     ═══════════════════════════════════════════════════════════════════ */
  Scenes.hero = function (seq) {
    const canvas = document.getElementById('heroCanvas');
    const plate  = new w.APEX_Plate(canvas, seq);
    const hint   = document.getElementById('scrollHint');
    const capA   = document.querySelector('[data-hero-cap="0"]');
    const capB   = document.querySelector('[data-hero-cap="1"]');
    const type   = document.getElementById('heroType');

    plate.set(0);

    /* Headline: per-character rise out of a clipped line box. */
    const lines = Array.from(type.querySelectorAll('.line > span'));
    const chars = [];
    lines.forEach(function (el) { chars.push.apply(chars, U.split(el, 'chars').chars); });
    g.set(chars, { yPercent: 118, opacity: 0 });

    /* The section is a viewport taller than the film needs. That last
       viewport is the overlap the turntable dissolves across: the sticky
       stage is still stuck through it, holding frame 419, instead of
       scrolling up out of the way — a stage sliding upward behind a
       cross-fade is the one thing that gives the cut away.

       So the scrub ends a viewport early rather than at `bottom bottom`, and
       the figure is derived from the same numbers the CSS uses so the two
       cannot drift apart. */
    function heroSpan() {
      const svc = document.getElementById('services');
      // end exactly where the next section's box begins — that is where the
      // dissolve starts, and the film has to be finished by then
      const top = svc ? svc.getBoundingClientRect().top + w.scrollY : 0;
      return Math.max(1, Math.round(top));
    }

    const trigger = {
      trigger: '#hero', start: 'top top',
      end: function () { return '+=' + heroSpan(); },
      scrub: 0.6, invalidateOnRefresh: true
    };

    /* The frame index is set imperatively — a scrubbed tween of a numeric
       proxy adds a lag the sequence does not need. */
    ST.create(Object.assign({}, trigger, {
      onUpdate: function (self) {
        const i = self.progress * (seq.n - 1);
        plate.set(i);
        seq.hint(i);
      }
    }));

    const tl = g.timeline({ scrollTrigger: Object.assign({}, trigger) });

    tl.to(hint, { opacity: 0, y: 14, duration: 0.04, ease: 'none' }, 0)
      .fromTo(capA, { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.06, ease: E.mass }, 0.05)
      .to(capA, { opacity: 0, y: -22, duration: 0.05, ease: 'power2.in' }, 0.17)
      .fromTo(capB, { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.06, ease: E.mass }, 0.24)
      .to(capB, { opacity: 0, y: -22, duration: 0.05, ease: 'power2.in' }, 0.40)
      .to(type, { opacity: 1, duration: 0.02 }, 0.56)
      .to(chars, {
        yPercent: 0, opacity: 1, duration: 0.16, ease: E.mass, stagger: { each: 0.0016, from: 'start' }
      }, 0.57)
      .to('.hero__type-meta', { opacity: 1, y: 0, duration: 0.06 }, 0.68)
      .to(type, { opacity: 0, y: -60, duration: 0.07, ease: 'power2.in' }, 0.93);

    g.set('.hero__type-meta', { opacity: 0, y: 18 });

    /* Grain drifts so the noise never looks like a static overlay. */
    g.to('.hero__grain', {
      x: '6%', y: '4%', duration: 7, ease: 'sine.inOut', yoyo: true, repeat: -1
    });

    w.addEventListener('resize', function () { plate.resize(); });
    return plate;
  };

  /* ══════════════════════════════════════════════════════════════════════
     SCENE 4 · the turntable

     A locked-off camera; the car rotates counter-clockwise through one full
     revolution as the section scrolls. The service menu populates down the
     left, one line at a time, and each line brings its own effect over the
     paint. Everything is a pure function of scroll position, so the whole
     section plays as one continuous move and reverses exactly.

     The section's box starts one viewport before the hero ends (a negative
     margin in the CSS), and its stage dissolves up over the hero across that
     overlap. Both stages are sticky at top:0 and a full viewport tall, so
     nothing slides — the opening film cross-fades into the turntable. The
     dissolve is smoothstep(prog), like everything else here, so scrolling
     back up fades the hero straight back in.
     ═══════════════════════════════════════════════════════════════════ */
  Scenes.services = function (turnSeq, holoSeq) {
    const stage  = document.querySelector('.services__stage');
    const plate  = new w.APEX_Plate(document.getElementById('servicePlate'), turnSeq);
    const fx     = document.getElementById('serviceFx');
    const ctx    = fx.getContext('2d');
    const holoEl = document.getElementById('serviceHolo');
    const hctx   = holoEl.getContext('2d');
    const film   = document.getElementById('serviceFilm');
    const cabin  = document.getElementById('serviceCabin');
    const items  = Array.from(document.querySelectorAll('.svc-item'));
    const rules  = items.map(function (li) { return li.querySelector('.svc-item__rule'); });
    const N      = items.length;
    const S      = C.stage;

    let W = 0, H = 0, live = false;
    let prog = 0;                                  // 0 → 1 across the section

    /* How much of this section's scroll is spent dissolving up over the hero.
       Measured rather than hard-coded: the overlap is exactly one viewport,
       and the section scrubs across (its height − one viewport), so the
       fraction falls out of the two. Reduced motion drops the overlap in the
       CSS, so it takes no dissolve here either. */
    const SECTION = document.getElementById('services');
    let DISS = 0;
    function measureDissolve() {
      if (U.reducedMotion) { DISS = 0; return; }
      const span = SECTION.offsetHeight - w.innerHeight;
      DISS = span > 0 ? U.clamp(w.innerHeight / span, 0, 0.34) : 0;
    }
    measureDissolve();

    /* Each line owns a slice of what is left once the dissolve is done.
       `arrive` is where it lands; once landed it stays — the menu accumulates
       rather than cycling. Derived from the line count so adding or removing a
       service keeps the last line landing well before the section ends. */
    function head()  { return DISS + 0.03; }
    function slice() { return (0.89 - head()) / N; }
    function arriveAt(i) { return head() + i * slice(); }

    /* Where the turntable is released. The two plates only have to agree while
       the hero is still substantially on screen, and that is the first half of
       the dissolve rather than all of it — holding frame 0 across the whole
       overlap parked a full viewport of scroll on a single frame, which reads
       as the film having stopped rather than as a seamless hand-off. */
    function holdEnd() { return DISS * 0.55; }

    /* A quadratic lead-in meeting a constant-speed turn. The car pulls away
       from a standstill instead of snapping to scrub speed the moment the hold
       releases, so the few degrees it moves while the hero is still fading are
       imperceptible. Normalised so the last frame still lands exactly on the
       end of the section. LEAD is the share of the remaining scroll spent
       getting up to rate. */
    const LEAD = 0.16;
    function turnCurve(t) {
      const v = t < LEAD ? (t * t) / (2 * LEAD) : t - LEAD * 0.5;
      return v / (1 - LEAD * 0.5);
    }

    /* `film` and `cabin` are DOM layers, not canvas effects, so they are
       driven from whichever line claims that mood rather than a fixed index. */
    function indexOfMood(mood) {
      for (let i = 0; i < C.services.length; i++) if (C.services[i].mood === mood) return i;
      return -1;
    }
    const FILM_I  = indexOfMood('film');
    const CABIN_I = indexOfMood('cabin');

    function appearOf(i) {
      return U.smoothstep(arriveAt(i), arriveAt(i) + 0.13, prog);
    }

    /* The effect for a line runs while that line is arriving and settles
       shortly after, so the visual and the copy are always in step. */
    function effectWeightOf(i) {
      const a = arriveAt(i);
      return U.smoothstep(a, a + 0.09, prog) * (1 - U.smoothstep(a + 0.26, a + 0.44, prog));
    }
    function effectLocalOf(i) {
      return U.clamp((prog - arriveAt(i)) / 0.40, 0, 1);
    }

    function resize() {
      const r = fx.getBoundingClientRect();
      W = r.width; H = r.height;
      U.sizeCanvas(fx, W, H);
      U.sizeCanvas(holoEl, W, H);
      plate.resize();
    }

    /* Effects belong on the car, not on the studio behind it. */
    function onBody(u, v) {
      const dx = (u - S.cx) / S.rx;
      const dy = (v - S.cy) / S.ry;
      return U.clamp(1.0 - (dx * dx + dy * dy), 0, 1);
    }

    /* ── holographic scan ────────────────────────────────────────────────
       Turn frame n and turnholo frame n are the same pose, so the overlay
       lands on the car. The band is composited here, not baked, so it
       follows scroll and reverses. */
    let holoFrame = -1, holoScan = 0, holoAlpha = 0;
    let holoKey = '', holoLive = true;

    /* This was the most expensive thing in the section by a wide margin, for
       a reason that is invisible in the output: the mask gradient clamps to
       fully transparent at both ends, so every pixel outside the band is
       erased the instant it is drawn. The old pass rasterised the whole frame
       and then ran a full-canvas `destination-in` to throw about three
       quarters of it away — twice the viewport in pixel work, every frame,
       for a strip a fifth of it wide.

       Only the band is touched now: the slice of the source image the band
       can actually show is mapped back out of it and drawn on its own, and
       the mask runs inside a clip of the same width so the composite is
       bounded too. */
    function drawHolo() {
      if (!W || holoAlpha <= 0.002) {
        if (holoLive) {
          holoLive = false; holoKey = '';
          holoEl.style.opacity = '0';
          // an opacity:0 layer still costs a screen-blend composite every frame
          holoEl.style.visibility = 'hidden';
        }
        return;
      }
      const img = holoSeq && holoSeq.get(holoFrame);
      if (!img) return;

      /* The loop runs whether or not the reader is scrolling, and none of
         this changes unless one of these does — including the plate's
         framing, which the overlay has to track or it slides off the car. */
      const key = holoFrame + '|' + holoScan.toFixed(4) + '|' + holoAlpha.toFixed(3) +
                  '|' + W + '|' + H + '|' + plate.opt.zoom + '|' + plate.opt.ox +
                  '|' + plate.opt.oy;
      if (key === holoKey) return;

      const d = U.dpr();
      hctx.setTransform(d, 0, 0, d, 0, 0);
      hctx.clearRect(0, 0, W, H);

      // identical fit to the plate, or the overlay slides off the car
      const r = U.coverRect(W, H, img.naturalWidth, img.naturalHeight,
                            plate.opt.ox, plate.opt.oy, plate.opt.zoom, plate.opt.fit);

      /* The scanner travels across the image, not the canvas — with
         contain-fit the canvas has black margins the beam must not cross. */
      const x = r.x + holoScan * r.w;
      const band = Math.max(70, r.w * 0.19);
      const bx0 = Math.max(r.x, x - band);
      const bx1 = Math.min(r.x + r.w, x + band * 0.30);
      const bw = bx1 - bx0;
      if (bw <= 0) { holoKey = ''; holoEl.style.opacity = '0'; return; }

      hctx.save();
      hctx.beginPath();
      hctx.rect(bx0, r.y, bw, r.h);
      hctx.clip();

      const sx = (bx0 - r.x) / r.w * img.naturalWidth;
      const sw = bw / r.w * img.naturalWidth;
      hctx.drawImage(img, sx, 0, sw, img.naturalHeight, bx0, r.y, bw, r.h);

      // the gradient keeps its full geometry; only the area it covers shrinks
      const grad = hctx.createLinearGradient(x - band, 0, x + band * 0.30, 0);
      grad.addColorStop(0.00, 'rgba(0,0,0,0)');
      grad.addColorStop(0.55, 'rgba(0,0,0,0.55)');
      grad.addColorStop(0.86, 'rgba(0,0,0,1)');
      grad.addColorStop(1.00, 'rgba(0,0,0,0)');
      hctx.globalCompositeOperation = 'destination-in';
      hctx.fillStyle = grad;
      hctx.fillRect(bx0, r.y, bw, r.h);
      hctx.globalCompositeOperation = 'source-over';
      hctx.restore();

      const edge = hctx.createLinearGradient(x - 22, 0, x + 8, 0);
      edge.addColorStop(0, 'rgba(230,57,77,0)');
      edge.addColorStop(0.8, 'rgba(255,138,150,0.5)');
      edge.addColorStop(1, 'rgba(255,255,255,0)');
      hctx.fillStyle = edge;
      hctx.fillRect(x - 22, r.y, 30, r.h);

      if (!holoLive) { holoLive = true; holoEl.style.visibility = ''; }
      holoEl.style.opacity = holoAlpha.toFixed(3);
      holoKey = key;
    }

    /* ── effects ─────────────────────────────────────────────────────────
       All of these are positioned against `R`, the rectangle the turntable
       frame is actually drawn into — not the canvas. With contain-fit the
       image is letterboxed on narrow viewports, and anything anchored to the
       canvas would drift off the car. */
    let R = { x: 0, y: 0, w: 1, h: 1 };

    function measure() {
      const img = turnSeq.get(plate.index);
      R = img
        ? U.coverRect(W, H, img.naturalWidth, img.naturalHeight,
                      plate.opt.ox, plate.opt.oy, plate.opt.zoom, plate.opt.fit)
        : { x: 0, y: 0, w: W, h: H };
    }

    const PX = function (u) { return R.x + u * R.w; };
    const PY = function (v) { return R.y + v * R.h; };

    const drops = [];
    while (drops.length < 120) {
      const u = Math.random(), v = Math.random();
      if (onBody(u, v) < 0.12) continue;
      drops.push({ u: u, v: v, r: 2 + Math.random() * 6, roll: Math.random(), sp: 0.5 + Math.random() });
    }
    const sparks = [];
    for (let i = 0; i < 150; i++) {
      sparks.push({ u: Math.random(), v: Math.random(), p: Math.random() * 6.28, s: 0.6 + Math.random() * 1.6 });
    }

    // Car detailing — swirl marks polished out of the clearcoat
    function drawSwirl(t, p) {
      const remain = 1 - U.smoothstep(0.10, 0.82, p);
      if (remain <= 0.001) return;
      ctx.lineWidth = 1;
      for (let i = 0; i < 240; i++) {
        const a = i * 2.399;
        const rr = Math.pow(i / 240, 0.6);
        const u = S.cx + Math.cos(a) * rr * S.rx * 1.25;
        const v = S.cy + Math.sin(a) * rr * S.ry * 1.25;
        const fade = remain * (0.16 + 0.14 * Math.sin(i + t)) * onBody(u, v);
        if (fade < 0.004) continue;
        ctx.strokeStyle = 'rgba(233,223,225,' + fade.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(PX(u), PY(v), 6 + (i % 7) * 2.4, a, a + 1.3);
        ctx.stroke();
      }
    }

    // Ceramic coating — droplets land, bead, then roll off
    function drawBeads(t, p) {
      const land = U.smoothstep(0.02, 0.26, p);
      const bead = U.smoothstep(0.26, 0.52, p);
      const roll = U.smoothstep(0.52, 0.96, p);
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        const stagger = U.clamp(land * 1.4 - d.roll * 0.4, 0, 1);
        if (stagger <= 0.01) continue;
        const r = U.lerp(d.r, d.r * 0.42, bead) * stagger;
        const fall = roll * (0.30 + d.sp * 0.28);
        const u = d.u + Math.sin(t * 0.6 + d.roll * 6) * 0.004 * roll;
        const v = d.v + fall;
        if (v > 1.05) continue;
        const alpha = stagger * (1 - U.smoothstep(0.86, 1.0, p)) * 0.9 * onBody(u, d.v);
        if (alpha < 0.01) continue;
        const px = PX(u), py = PY(v);

        const gr = ctx.createRadialGradient(px - r * 0.3, py - r * 0.35, r * 0.05, px, py, r);
        gr.addColorStop(0, 'rgba(255,255,255,' + (alpha * 0.75).toFixed(3) + ')');
        gr.addColorStop(0.45, 'rgba(228,186,192,' + (alpha * 0.16).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(190,130,140,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(px, py, r, 0, 6.2832); ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,' + (alpha * 0.9).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(px - r * 0.34, py - r * 0.38, Math.max(0.6, r * 0.14), 0, 6.2832); ctx.fill();
      }
    }

    /* Window tinting — the film wipes across the greenhouse. The fx layer is
       screen-blended so it cannot darken; the tint reads instead as the sheen
       that travels over glass as the film is squeegeed down. */
    function drawTint(t, p) {
      const sweep = U.smoothstep(0.05, 0.85, p);
      const hold = 1 - U.smoothstep(0.80, 1.0, p);
      if (hold <= 0.002) return;

      const gy = PY(S.cy - S.ry * 0.62);
      const gh = R.h * S.ry * 0.95;
      const x0 = PX(S.cx - S.rx), x1 = PX(S.cx + S.rx);
      const x = U.lerp(x0, x1, sweep);

      const g1 = ctx.createLinearGradient(x - R.w * 0.09, 0, x + R.w * 0.03, 0);
      g1.addColorStop(0, 'rgba(150,150,155,0)');
      g1.addColorStop(0.7, 'rgba(180,180,188,' + (0.16 * hold).toFixed(3) + ')');
      g1.addColorStop(1, 'rgba(235,235,240,0)');
      ctx.fillStyle = g1;
      ctx.fillRect(x0, gy, x1 - x0, gh);

      // fine squeegee lines trailing the sweep
      ctx.lineWidth = 1;
      for (let k = 0; k < 16; k++) {
        const ly = gy + (k / 16) * gh;
        const a = 0.10 * hold * (1 - Math.abs(k / 16 - 0.5) * 1.4);
        if (a <= 0.002) continue;
        ctx.strokeStyle = 'rgba(200,200,208,' + a.toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(x0, ly);
        ctx.lineTo(x, ly);
        ctx.stroke();
      }
    }

    // New car package — the whole body flickers with flake and settles
    function drawPackage(t, p) {
      const rise = U.smoothstep(0.02, 0.35, p);
      const hold = 1 - U.smoothstep(0.72, 1.0, p);
      const amp = rise * hold;
      if (amp <= 0.002) return;

      for (let i = 0; i < sparks.length; i++) {
        const s = sparks[i];
        const m = onBody(s.u, s.v);
        if (m < 0.05) continue;
        const tw = 0.5 + 0.5 * Math.sin(t * 3.2 + s.p * 5.0);
        ctx.fillStyle = 'rgba(255,238,240,' + (amp * m * tw * 0.55).toFixed(3) + ')';
        ctx.fillRect(PX(s.u), PY(s.v), s.s, s.s);
      }

      const cx = PX(S.cx), cy = PY(S.cy);
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R.w * 0.42);
      halo.addColorStop(0, 'rgba(230,57,77,' + (amp * 0.07).toFixed(3) + ')');
      halo.addColorStop(1, 'rgba(230,57,77,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, H);
    }
    const EFFECTS = { swirl: drawSwirl, beads: drawBeads, tint: drawTint, package: drawPackage };

    /* Ambient life. Everything else in this section is scrub-driven, so the
       moment the reader stops scrolling every pixel stops with them — most
       obviously across the hand-off, where the turntable is holding one frame
       by design. A slow float on the viewport keeps the shot breathing without
       touching the plate's own framing, and it ramps in with the dissolve so
       it can never disturb the cross-fade with the hero. Translation only:
       `resize` measures this element's box, and a scale here would quietly
       mis-size the effect canvases. */
    const viewport = document.querySelector('.services__viewport');
    function breathe(t) {
      if (!viewport) return;
      const amp = DISS > 0 ? U.smoothstep(DISS * 0.4, DISS, prog) : 1;
      const y = Math.sin(t * 0.62) * 13 * amp;
      const x = Math.cos(t * 0.41) * 5 * amp;
      viewport.style.transform =
        'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)';
    }

    /* Between one service landing and the next nothing has any weight, and
       this canvas spent those stretches clearing a full viewport every frame
       and handing the compositor a transparent screen-blend layer to mix.
       It is cleared once on the way out and then left alone. */
    let fxDirty = false, fxLive = true;

    function draw(t) {
      if (!live || !W) return;
      if (!U.reducedMotion) breathe(t);
      drawHolo();

      let any = false;
      for (let i = 0; i < N; i++) {
        if (effectWeightOf(i) >= 0.01) { any = true; break; }
      }

      if (!any) {
        if (fxDirty) {
          const d0 = U.dpr();
          ctx.setTransform(d0, 0, 0, d0, 0, 0);
          ctx.clearRect(0, 0, W, H);
          fxDirty = false;
        }
        if (fxLive) { fxLive = false; fx.style.visibility = 'hidden'; }
        return;
      }
      if (!fxLive) { fxLive = true; fx.style.visibility = ''; }

      measure();
      const d = U.dpr();
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, W, H);

      /* Every effect with any weight is drawn, so they dissolve into each
         other rather than being swapped. At most two overlap. */
      for (let i = 0; i < N; i++) {
        const wgt = effectWeightOf(i);
        if (wgt < 0.01) continue;
        const f = EFFECTS[C.services[i].mood];
        if (!f) continue;
        ctx.globalAlpha = wgt;
        f(t, effectLocalOf(i));
      }
      ctx.globalAlpha = 1;
      fxDirty = true;
    }

    /* The camera move. Each line owns a framing; the plate eases from one to
       the next as the line lands, so the section plays as a shot list instead
       of one unbroken lap. Written as an accumulation rather than a lookup —
       every view above the playhead is folded in, in order — which keeps it a
       pure function of `prog` and therefore exactly reversible. */
    const BASE_VIEW = { zoom: 1, ox: 0.5, oy: 0.5 };
    function viewAt() {
      let v = BASE_VIEW;
      for (let i = 0; i < N; i++) {
        const want = (C.services[i] && C.services[i].view) || BASE_VIEW;
        const a = arriveAt(i);
        // starts a touch before the line lands so the move leads the copy
        const t = U.smoothstep(a - 0.05, a + 0.11, prog);
        if (t <= 0) break;
        v = {
          zoom: U.lerp(v.zoom, want.zoom, t),
          ox:   U.lerp(v.ox,   want.ox,   t),
          oy:   U.lerp(v.oy,   want.oy,   t)
        };
      }
      return v;
    }

    /* How much bigger cover is than contain for the current viewport — the
       zoom that turns this plate's contain-fit back into the hero's
       cover-fit. 1 on a 16:9 screen, where the two are the same rectangle. */
    function coverRatio() {
      const img = turnSeq.get(plate.index);
      if (!img || !W || !H) return 1;
      const a = W / img.naturalWidth, b = H / img.naturalHeight;
      return Math.max(a, b) / Math.min(a, b);
    }

    /* ── scroll choreography ─────────────────────────────────────────── */
    g.set(items, { opacity: 0, x: -26 });
    g.set(rules, { scaleX: 0 });
    // hidden until the dissolve lifts it, or the stage would sit on top of
    // the hero's last hundred viewport-heights fully opaque
    g.set(stage, { opacity: DISS > 0 ? 0 : 1 });

    ST.create({
      trigger: '#services', start: 'top bottom', end: 'bottom top',
      onToggle: function (self) { live = self.isActive; }
    });

    ST.create({
      trigger: '#services', start: 'top top', end: 'bottom bottom',
      scrub: 0.5, invalidateOnRefresh: true,
      onUpdate: function (self) {
        prog = self.progress;

        /* Dissolve up over the tail of the hero. The turntable is already
           turning underneath it, so the two films overlap rather than the
           second one starting once the first has stopped. */
        g.set(stage, { opacity: DISS > 0 ? U.smoothstep(0, DISS, prog) : 1 });

        /* The turntable is baked from the hero's final camera, so frame 0 is
           the hero's last frame. The only thing left that could give the
           hand-off away is the fit: the hero fills the viewport, the
           turntable has to show the whole car. On a 16:9 screen those are the
           same rectangle and `ratio` is 1, so nothing happens. Anywhere else
           the plate starts at the hero's exact framing and eases back to the
           full car — which reads as the crane continuing, not as a cut. */
        /* The revolution runs over what is left after the hold. Frame 0 is
           baked from the hero's final camera, so while both plates are on
           screen they show the same image and the fade is invisible — but that
           only has to survive the front half of the dissolve. Past `hold` the
           lead-in takes over: near-zero rate while the hero finishes fading,
           up to a steady turn once it is gone. */
        const hold = holdEnd();
        const turned = turnCurve(U.clamp((prog - hold) / (1 - hold || 1), 0, 1));
        const frame = turned * (turnSeq.n - 1);
        /* Hold the hero's exact framing for the whole dissolve — the moment
           both plates are on screen is the one moment they must not differ —
           then hand over to the shot list. `k` is that handover, so the first
           service's push-in is a continuation of the hero's crane rather than
           a second move starting after it. */
        const ratio = coverRatio();
        const v = viewAt();
        /* Released with the turn rather than after the dissolve, and over a
           wider ramp — smoothstep leaves at zero rate, so the crane starts
           moving before the hero is gone without the framing giving it away. */
        const k = U.smoothstep(hold, hold + 0.22, prog);
        plate.set(frame, {
          zoom: U.lerp(ratio, v.zoom, k),
          ox:   U.lerp(0.5,   v.ox,   k),
          oy:   U.lerp(0.5,   v.oy,   k),
          fit:  'contain'
        });
        turnSeq.hint(frame);

        // the menu populates and stays; the newest line reads brightest
        for (let i = 0; i < N; i++) {
          const a = appearOf(i);
          const fresh = 1 - U.smoothstep(0, 0.22, prog - (arriveAt(i) + 0.13));
          g.set(items[i], {
            opacity: a,
            x: U.lerp(-26, 0, a),
            visibility: a < 0.008 ? 'hidden' : 'visible'
          });
          g.set(items[i].querySelector('.svc-item__name'), {
            color: 'rgba(242,243,244,' + (0.55 + 0.45 * fresh).toFixed(3) + ')'
          });
          g.set(rules[i], { scaleX: a });
        }

        // the scan tracks whichever service is currently landing
        if (holoSeq) {
          holoFrame = U.clamp(Math.round(frame), 0, holoSeq.n - 1);
          let best = 0;
          for (let i = 0; i < N; i++) best = Math.max(best, effectWeightOf(i));
          const sl = slice();
          const lead = ((prog - head() + sl) % sl) / sl;
          holoScan = U.smoothstep(0.02, 0.86, lead);
          holoAlpha = best * 0.9;
          holoSeq.hint(holoFrame);
        }

        // PPF is a film sweeping over the paint — a DOM layer, not canvas
        if (FILM_I >= 0) {
          const filmW = effectWeightOf(FILM_I);
          const filmL = effectLocalOf(FILM_I);
          g.set(film, {
            opacity: filmW * U.smoothstep(0.04, 0.2, filmL) * (1 - U.smoothstep(0.85, 1, filmL)),
            backgroundPositionX: (filmL * 240 - 60).toFixed(1) + '%'
          });
        }

        // Car detailing reaches inside: the cabin warms up under the glass,
        // holds while the line is landing, then falls away again.
        if (CABIN_I >= 0) {
          const cabL = effectLocalOf(CABIN_I);
          g.set(cabin, {
            opacity: effectWeightOf(CABIN_I) * U.smoothstep(0.05, 0.3, cabL) * 0.85
          });
        }
      }
    });

    resize();
    // the overlap is a viewport tall, so its share of the scrub changes with
    // the viewport — re-measure before ScrollTrigger re-reads positions
    w.addEventListener('resize', function () { resize(); measureDissolve(); });
    ST.addEventListener('refreshInit', measureDissolve);
    addLoop(draw);
  };

  /* ══════════════════════════════════════════════════════════════════════
     SCENE 7 · horizontal gallery
     ═══════════════════════════════════════════════════════════════════ */
  Scenes.gallery = function (seq, lenis) {
    const track = document.getElementById('galleryTrack');
    const shots = Array.from(track.querySelectorAll('.shot'));
    const plates = shots.map(function (shot, i) {
      const p = new w.APEX_Plate(shot.querySelector('.shot__plate'), seq);
      p.set(C.stills.gallery[i % C.stills.gallery.length], { zoom: 1.22 });
      return p;
    });

    function distance() { return Math.max(0, track.scrollWidth - w.innerWidth); }

    const tween = g.to(track, {
      x: function () { return -distance(); },
      ease: 'none',
      scrollTrigger: {
        trigger: '#gallery',
        start: 'top top',
        end: function () { return '+=' + distance(); },
        pin: true, scrub: 0.7, invalidateOnRefresh: true, anticipatePin: 1
      }
    });

    /* Each plate counter-parallaxes inside its frame, and the mask peels back
       as the shot reaches the centre of the viewport. */
    shots.forEach(function (shot, i) {
      const plate = plates[i];
      ST.create({
        trigger: shot, containerAnimation: tween,
        start: 'left right', end: 'right left', scrub: true,
        onUpdate: function (self) {
          const centred = 1 - Math.abs(self.progress - 0.5) * 2;
          plate.set(plate.index, { zoom: U.lerp(1.34, 1.12, centred), ox: U.lerp(0.22, 0.66, self.progress) });
          g.set(shot.querySelector('.shot__mask'), { opacity: U.lerp(1, 0.42, centred) });
          g.set(shot.querySelector('.shot__meta'), { y: U.lerp(34, 0, centred), opacity: U.lerp(0.15, 1, centred) });
        }
      });

      g.fromTo(shot, { clipPath: 'inset(0% 0% 0% 100%)' }, {
        clipPath: 'inset(0% 0% 0% 0%)', ease: E.glide,
        scrollTrigger: { trigger: shot, containerAnimation: tween, start: 'left 92%', end: 'left 46%', scrub: true }
      });
    });

    /* The section reads as horizontal, so a horizontal drag or trackpad swipe
       should move it. Observer converts that gesture into vertical scroll,
       which is what actually drives the pin. */
    if (w.Observer && !U.reducedMotion) {
      w.Observer.create({
        target: '#gallery',
        type: 'pointer,touch',
        dragMinimum: 6,
        onDragStart: function () { document.body.style.userSelect = 'none'; },
        onDragEnd: function () { document.body.style.userSelect = ''; },
        onChangeX: function (self) {
          const to = w.scrollY - self.deltaX * 1.35;
          if (lenis) lenis.scrollTo(to, { immediate: true });
          else w.scrollTo(0, to);
        }
      });
    }

    w.addEventListener('resize', function () { plates.forEach(function (p) { p.resize(); }); });
  };

  /* ══════════════════════════════════════════════════════════════════════
     SCENE 8 · floating glass testimonials
     ═══════════════════════════════════════════════════════════════════ */
  Scenes.voices = function () {
    const field = document.getElementById('voicesField');
    const cards = Array.from(field.querySelectorAll('.glass'));

    g.set(cards, { opacity: 0, y: 70, rotateX: -12, transformPerspective: 1200 });
    g.to(cards, {
      opacity: 1, y: 0, rotateX: 0, duration: 1.4, ease: E.mass, stagger: 0.11,
      scrollTrigger: { trigger: '#voices', start: 'top 68%' }
    });

    // depth parallax on scroll
    cards.forEach(function (card) {
      const depth = parseFloat(card.dataset.depth) || 1;
      g.fromTo(card, { y: 60 * depth }, {
        y: -60 * depth, ease: 'none',
        scrollTrigger: { trigger: '#voices', start: 'top bottom', end: 'bottom top', scrub: 1 }
      });
    });

    if (!U.fine || U.reducedMotion) return;

    /* Tilt is written straight to the element on pointer move — a tween per
       mousemove would fight itself at 120 Hz. */
    cards.forEach(function (card) {
      const rot = { x: 0, y: 0, tx: 0, ty: 0 };
      card.addEventListener('mousemove', function (e) {
        const r = card.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        rot.tx = -ny * 15;
        rot.ty = nx * 18;
        card.style.setProperty('--mx', ((nx + 0.5) * 100).toFixed(1) + '%');
        card.style.setProperty('--my', ((ny + 0.5) * 100).toFixed(1) + '%');
      });
      card.addEventListener('mouseleave', function () { rot.tx = 0; rot.ty = 0; });

      /* Written through GSAP rather than style.transform: the scroll parallax
         above already owns this element's transform, and a raw assignment
         would wipe it every frame. */
      const setX = g.quickSetter(card, 'rotateX', 'deg');
      const setY = g.quickSetter(card, 'rotateY', 'deg');
      addLoop(function () {
        const dx = rot.tx - rot.x, dy = rot.ty - rot.y;
        if (Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005) return;
        rot.x += dx * 0.09;
        rot.y += dy * 0.09;
        setX(rot.x); setY(rot.y);
      });
    });
  };

  /* ══════════════════════════════════════════════════════════════════════
     SCENE 9 · statistics
     ═══════════════════════════════════════════════════════════════════ */
  Scenes.stats = function () {
    Array.from(document.querySelectorAll('.stats__num')).forEach(function (el, i) {
      const to = parseFloat(el.dataset.to);
      const dec = parseInt(el.dataset.decimals || '0', 10);
      const suffix = el.dataset.suffix || '';
      const proxy = { v: 0 };

      g.to(proxy, {
        v: to, duration: 2.3, delay: i * 0.13, ease: E.mech,
        scrollTrigger: { trigger: '#stats', start: 'top 74%' },
        onUpdate: function () { el.textContent = U.fmt(proxy.v, dec) + suffix; }
      });

      g.fromTo(el, { yPercent: 24, opacity: 0 }, {
        yPercent: 0, opacity: 1, duration: 1.1, delay: i * 0.13, ease: E.mass,
        scrollTrigger: { trigger: '#stats', start: 'top 74%' }
      });
    });
  };

  /* ══════════════════════════════════════════════════════════════════════
     Consultation menu
     ═══════════════════════════════════════════════════════════════════ */
  Scenes.menu = function () {
    const grid = document.getElementById('menuGrid');
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll('.card'));
    const inners = cards.map(function (c) { return c.querySelector('.card__in'); })
                        .filter(Boolean);

    /* The cells rise as one block and their contents follow half a beat
       behind, so the grid reads as depth rather than six identical fades. */
    g.set(cards, { opacity: 0, y: 54 });
    g.to(cards, {
      opacity: 1, y: 0, duration: 1.15, ease: E.mass, stagger: 0.075,
      scrollTrigger: { trigger: '#menu', start: 'top 74%' }
    });
    /* clearProps matters: the inline transform GSAP leaves behind outranks the
       :active press rule, and the button would stop responding to a click. */
    g.from(inners, {
      opacity: 0, y: 24, duration: 1.05, ease: E.mass, stagger: 0.075, delay: 0.14,
      clearProps: 'all',
      scrollTrigger: { trigger: '#menu', start: 'top 74%' }
    });

    // the head (eyebrow, heading, lede) is choreographed in Scenes.type, with
    // every other section heading on the page

    if (!U.fine || U.reducedMotion) return;

    /* The hover wash follows the pointer across each card, and --mx/--my
       (-1…1 from centre) drift the type a few pixels with it. The cell itself
       never moves — the 1px grid it draws has to stay put. */
    cards.forEach(function (card) {
      let raf = 0;
      card.addEventListener('mousemove', function (e) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          const r = card.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          card.style.setProperty('--cx', (x * 100).toFixed(1) + '%');
          card.style.setProperty('--cy', (y * 100).toFixed(1) + '%');
          card.style.setProperty('--mx', (x * 2 - 1).toFixed(3));
          card.style.setProperty('--my', (y * 2 - 1).toFixed(3));
        });
      });
      card.addEventListener('mouseleave', function () {
        card.style.setProperty('--mx', '0');
        card.style.setProperty('--my', '0');
      });
    });
  };

  /* ══════════════════════════════════════════════════════════════════════
     SCENE 10 · booking
     ═══════════════════════════════════════════════════════════════════ */
  Scenes.book = function (seq) {
    const plate = new w.APEX_Plate(document.getElementById('bookPlate'), seq);
    plate.set(C.stills.book, { zoom: 1.06 });

    // the car breathes rather than sits
    g.to(document.getElementById('bookPlate'), {
      y: -26, duration: 7, ease: 'sine.inOut', yoyo: true, repeat: -1
    });
    g.fromTo(document.getElementById('bookPlate'), { scale: 1.1 }, {
      scale: 1.0, ease: 'none',
      scrollTrigger: { trigger: '#book', start: 'top bottom', end: 'bottom bottom', scrub: 1 }
    });

    const lines = Array.from(document.querySelectorAll('.display--book .line > span'));
    g.set(lines, { yPercent: 116 });
    g.to(lines, {
      yPercent: 0, duration: 1.5, ease: E.mass, stagger: 0.09,
      scrollTrigger: { trigger: '#book', start: 'top 58%' }
    });

    g.to('.book__glow', {
      scale: 1.16, opacity: 0.72, duration: 5.5, ease: 'sine.inOut', yoyo: true, repeat: -1
    });

    w.addEventListener('resize', function () { plate.resize(); });
  };

  /* ══════════════════════════════════════════════════════════════════════
     SCENE 11 · typographic choreography

     The hero and the booking headline both rise line by line out of a clipped
     box. Every other heading on the page simply appeared, which is what made
     the middle of the document read flatter than its two ends. This gives the
     whole page one reveal grammar — heading, then its copy, in that order,
     every time — using the same `.line` mask the two ends already use.

     Reduced motion skips the whole module rather than animating faster: every
     reveal here starts from a hidden state, and hidden text that never gets
     its trigger is worse than text that simply arrives.
     ═══════════════════════════════════════════════════════════════════ */
  Scenes.type = function () {
    if (U.reducedMotion) return;

    /* Rebuilds a heading as the `.line > span` markup the hero already uses,
       so one CSS rule does the masking everywhere. Split on the <br> the
       markup already carries rather than on measured line boxes — these
       headings break where the author said they break, at every viewport,
       and nothing has to be re-split on resize. */
    function lineWrap(el) {
      const existing = el.querySelectorAll('.line > span');
      if (existing.length) return Array.from(existing);
      el.innerHTML = el.innerHTML
        .split(/<br\s*\/?>/i)
        .map(function (part) { return '<span class="line"><span>' + part + '</span></span>'; })
        .join('');
      return Array.from(el.querySelectorAll('.line > span'));
    }

    /* Words, not characters: a word split survives a resize untouched, where
       lines would have to be measured and rebuilt. Returns null if SplitText
       never loaded, and the caller falls back to moving the whole block. */
    function wordsOf(el) {
      if (!w.SplitText) return null;
      try {
        const s = new w.SplitText(el, { type: 'words', wordsClass: 'wd' });
        return s.words && s.words.length ? s.words : null;
      } catch (e) { return null; }
    }

    function headReveal(sel, trigger, start) {
      const el = document.querySelector(sel);
      if (!el) return;
      const lines = lineWrap(el);
      g.set(lines, { yPercent: 118 });
      g.to(lines, {
        yPercent: 0, duration: 1.45, ease: E.mass, stagger: 0.085,
        scrollTrigger: { trigger: trigger, start: start }
      });
    }

    function copyReveal(sel, trigger, start, delay) {
      const el = document.querySelector(sel);
      if (!el) return;
      const ws = wordsOf(el);
      const st = { trigger: trigger, start: start };
      if (ws) {
        g.set(ws, { opacity: 0, yPercent: 46 });
        g.to(ws, {
          opacity: 1, yPercent: 0, duration: 0.95, ease: E.mass,
          stagger: 0.018, delay: delay || 0, scrollTrigger: st
        });
      } else {
        g.from(el, {
          opacity: 0, y: 26, duration: 1.05, ease: E.mass,
          delay: delay || 0, scrollTrigger: st
        });
      }
    }

    /* `#services` is the one heading that cannot key off its own section top:
       the section box starts a viewport early to overlap the hero, so its
       stage — and this heading with it — is still transparent then. `top top`
       is the moment the stage pins and begins to dissolve up. */
    headReveal('.services__head h2', '#services', 'top top');
    headReveal('.gallery__intro h2', '#gallery',  'top 74%');
    headReveal('.voices__head h2',   '#voices',   'top 76%');
    headReveal('.menu__head h2',     '#menu',     'top 76%');

    copyReveal('.gallery__intro .lede', '#gallery', 'top 74%', 0.22);
    copyReveal('.menu__head .lede',     '#menu',    'top 76%', 0.22);
    copyReveal('.gallery__outro .lede', '#gallery', 'top 40%', 0);

    // the eyebrow leads the heading in, as a rule drawn left to right
    const eyebrow = document.querySelector('.menu__head .eyebrow');
    if (eyebrow) {
      g.fromTo(eyebrow,
        { clipPath: 'inset(0 100% 0 0)', opacity: 0 },
        {
          clipPath: 'inset(0 0% 0 0)', opacity: 1, duration: 1.1, ease: E.glide,
          scrollTrigger: { trigger: '#menu', start: 'top 78%' }
        });
    }

    // the stat labels travel with the figures they belong to
    const labels = Array.from(document.querySelectorAll('.stats__grid span'));
    if (labels.length) {
      g.from(labels, {
        opacity: 0, y: 20, duration: 0.95, ease: E.mass, stagger: 0.13, delay: 0.18,
        scrollTrigger: { trigger: '#stats', start: 'top 74%' }
      });
    }

    const footItems = Array.from(document.querySelectorAll('.foot > span'));
    if (footItems.length) {
      g.from(footItems, {
        opacity: 0, y: 16, duration: 0.9, ease: E.mass, stagger: 0.09,
        scrollTrigger: { trigger: '.foot', start: 'top 96%' }
      });
    }
  };

  /* ══════════════════════════════════════════════════════════════════════
     SCENE 12 · page chrome

     A hairline that reports how far through the film the reader is. Driven
     off one document-length ScrollTrigger through a quickSetter, so it costs
     a single transform write per frame and never allocates a tween.
     ═══════════════════════════════════════════════════════════════════ */
  Scenes.chrome = function () {
    const bar = document.querySelector('.prog i');
    if (bar) {
      const setX = g.quickSetter(bar, 'scaleX');
      setX(0);
      ST.create({
        start: 0, end: 'max',
        onUpdate: function (self) { setX(self.progress); }
      });
    }

    /* Collision between the nav and the page's type is handled in CSS, by the
       veil behind the nav — see `.nav-veil`. It was tried here first, hiding
       whichever part of the nav a heading was passing through, and the
       approach does not survive contact with this page: text is under that
       corner for most of the document, so the brand spent more time hidden
       than visible and strobed in the gaps between cards. Dimming what passes
       underneath costs nothing and never takes the navigation away. */
  };

  Scenes.init = function (seq, lenis, turnSeq, holoSeq) {
    buildEases();
    const heroPlate = Scenes.hero(seq);
    Scenes.services(turnSeq || seq, holoSeq);
    Scenes.gallery(seq, lenis);
    Scenes.voices();
    Scenes.stats();
    Scenes.menu();
    Scenes.book(seq);
    Scenes.type();
    Scenes.chrome();
    g.ticker.add(runLoops);
    return heroPlate;
  };

  w.APEX_Scenes = Scenes;
})(window);
