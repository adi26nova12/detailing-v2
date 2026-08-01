/* ============================================================================
   APEX — boot

   Lenis owns the scroll position; ScrollTrigger reads it. Running GSAP's
   ScrollSmoother alongside Lenis would smooth an already-smoothed value and
   put a visible lag between the wheel and the sequence, so exactly one
   smoothing layer is installed. Everything else (pin, scrub, containerAnimation)
   is unaffected — it all runs through ScrollTrigger either way.
   ========================================================================== */
(function (w) {
  'use strict';

  const U = w.APEX_U;
  const C = w.APEX;
  const g = w.gsap;

  function registerPlugins() {
    const list = ['ScrollTrigger', 'Observer', 'Draggable', 'InertiaPlugin',
                  'Flip', 'MotionPathPlugin', 'CustomEase', 'SplitText'];
    const found = list.map(function (n) { return w[n]; }).filter(Boolean);
    g.registerPlugin.apply(g, found);
  }

  function initScroll() {
    if (U.reducedMotion || !w.Lenis) {
      w.ScrollTrigger.refresh();
      return null;
    }

    const lenis = new w.Lenis({
      duration: 1.15,
      easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
      wheelMultiplier: 0.95,
      touchMultiplier: 1.6,
      smoothWheel: true
    });

    lenis.on('scroll', w.ScrollTrigger.update);

    // Drive Lenis from GSAP's ticker so scroll, tweens and canvas draws all
    // land inside one animation frame.
    g.ticker.add(function (time) { lenis.raf(time * 1000); });
    g.ticker.lagSmoothing(0);

    // Anchor links go through Lenis or they fight it.
    document.addEventListener('click', function (e) {
      const a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      lenis.scrollTo(el, { offset: 0, duration: 1.6 });
    });

    return lenis;
  }

  function initVelocity() {
    if (!w.Observer) return;

    /* Velocity-based skew: sections lean into the direction of travel and
       settle back. One decaying value on the ticker — spawning a tween per
       scroll event would stack hundreds of them during a single flick. */
    const setters = Array.from(document.querySelectorAll('.voices, .stats, .compare'))
      .map(function (t) { return g.quickSetter(t, 'skewY', 'deg'); });

    let skew = 0, target = 0;

    w.ScrollTrigger.create({
      onUpdate: function (self) {
        target = U.clamp(self.getVelocity() / -1600, -3.2, 3.2);
      }
    });

    g.ticker.add(function () {
      target *= 0.88;                       // velocity decays on its own
      const next = skew + (target - skew) * 0.16;
      if (Math.abs(next - skew) < 0.002 && Math.abs(next) < 0.002) return;
      skew = next;
      for (let i = 0; i < setters.length; i++) setters[i](skew);
    });
  }

  function initMagnets() {
    Array.from(document.querySelectorAll('[data-magnetic]')).forEach(function (el) {
      U.magnetise(el, 0.34);
    });
  }

  function initClock() {
    const el = document.getElementById('footClock');
    if (!el) return;
    const tick = function () {
      el.textContent = new Intl.DateTimeFormat('en-AU', {
        timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date()) + ' AEST';
    };
    tick();
    setInterval(tick, 20000);
  }

  function boot() {
    registerPlugins();

    const seq = new w.APEX_Sequence(C.sequence);
    /* Scene 5's turntable and its scan layer are never on screen at first
       paint, so neither is part of what the preloader waits for — they
       stream in behind the hero. */
    const turnSeq = C.turn ? new w.APEX_Sequence(C.turn) : null;
    const holoSeq = C.turnHolo ? new w.APEX_Sequence(C.turnHolo) : null;
    const loader = new w.APEX_Preloader(seq);

    loader.start();

    /* The bar tracks the priority set, not all 420 frames — otherwise it would
       sit at 11% while a perfectly usable experience waits behind it. */
    const priorityTotal = seq.priorityList().length;
    seq.onProgress(function (_p, ready) {
      loader.progress(Math.min(1, ready / priorityTotal));
    });

    seq.preload().then(function () {
      // Lenis first: the gallery's drag gesture scrolls through it, so it has
      // to exist before the scenes are wired up.
      const lenis = initScroll();
      const heroPlate = w.APEX_Scenes.init(seq, lenis, turnSeq, holoSeq);

      initMagnets();
      initClock();
      initVelocity();

      w.ScrollTrigger.refresh();

      // Handles for debugging and for the swap-in workflow in HIGGSFIELD.md.
      w.APEX_APP = {
        seq: seq, turn: turnSeq, holo: holoSeq,
        loader: loader, hero: heroPlate
      };

      return loader.finish().then(function () {
        if (lenis) lenis.start();
        // Only now go after the remaining frames: the opening scene is on
        // screen and the network is free.
        seq.stream();
        // the turntable is the next thing the visitor reaches, so it goes
        // ahead of its own scan layer
        if (turnSeq) turnSeq.stream();
        if (holoSeq) holoSeq.stream();
        w.ScrollTrigger.refresh();
      });
    }).catch(function (err) {
      // Never trap the visitor behind a loader because one asset failed.
      console.error('[APEX] boot failed:', err);
      loader.reveal();
      seq.stream();
    });

    /* Watchdog. A stalled CDN, an offline cache or a tab that was never
       focused must not leave anyone staring at a logo. */
    setTimeout(function () {
      if (document.body.classList.contains('is-loading')) {
        console.warn('[APEX] preload watchdog fired — revealing early');
        loader.reveal();
        seq.stream();
        w.ScrollTrigger.refresh();
      }
    }, 14000);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) w.ScrollTrigger.refresh();
    });

    /* Re-measure once fonts land, or pinned sections start a few pixels off. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { w.ScrollTrigger.refresh(); });
    }

    let rt;
    w.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { w.ScrollTrigger.refresh(); }, 220);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
