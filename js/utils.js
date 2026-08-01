/* ============================================================================
   Studio X Detailing — utilities
   ========================================================================== */
(function (w) {
  'use strict';

  const U = {};

  U.clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  U.lerp  = (a, b, t) => a + (b - a) * t;
  U.map   = (v, a, b, c, d) => c + (d - c) * U.clamp((v - a) / (b - a || 1e-6), 0, 1);

  U.smoothstep = (a, b, x) => { const t = U.clamp((x - a) / (b - a || 1e-6), 0, 1); return t * t * (3 - 2 * t); };

  U.reducedMotion = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  U.fine = !w.matchMedia || w.matchMedia('(hover:hover) and (pointer:fine)').matches;

  /* Device pixel ratio, capped. Above 2 the extra pixels cost more than they
     show on a dark, grain-heavy composition. */
  U.dpr = () => Math.min(w.devicePixelRatio || 1, 2);

  U.sizeCanvas = function (canvas, cssW, cssH) {
    const d = U.dpr();
    const w2 = Math.max(1, Math.round(cssW * d));
    const h2 = Math.max(1, Math.round(cssH * d));
    if (canvas.width !== w2 || canvas.height !== h2) {
      canvas.width = w2;
      canvas.height = h2;
      return true;
    }
    return false;
  };

  /* object-fit, computed. `contain` matters for the turntable: the whole car
     has to stay in frame on any viewport, and the letterbox is invisible
     against a black stage. On a 16:9 viewport the two are identical. */
  U.coverRect = function (dstW, dstH, srcW, srcH, ox, oy, zoom, fit) {
    const base = fit === 'contain'
      ? Math.min(dstW / srcW, dstH / srcH)
      : Math.max(dstW / srcW, dstH / srcH);
    const s = base * (zoom || 1);
    const w2 = srcW * s, h2 = srcH * s;
    return {
      x: (dstW - w2) * (ox === undefined ? 0.5 : ox),
      y: (dstH - h2) * (oy === undefined ? 0.5 : oy),
      w: w2, h: h2
    };
  };

  /* Every canvas that draws a baked frame composes the studio-wide paint
     regrade (APEX.paint.filter) with whatever local grade it wanted. Order
     matters: the regrade runs first so a local `saturate()` acts on the red
     car rather than on the emerald one underneath it. */
  U.paintFilter = function (local) {
    const base = (w.APEX && w.APEX.paint && w.APEX.paint.filter) || '';
    if (!base) return local || '';
    return local ? base + ' ' + local : base;
  };

  /* SplitText is on the free CDN now, but never let a blocked script take the
     headline with it — fall back to a manual line/char split. */
  U.split = function (el, type) {
    if (w.SplitText) {
      try { return new w.SplitText(el, { type: type || 'chars', charsClass: 'ch', linesClass: 'ln' }); }
      catch (e) { /* fall through */ }
    }
    const chars = [];
    const walk = (node) => {
      Array.from(node.childNodes).forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split('').forEach((c) => {
            const s = document.createElement('span');
            s.className = 'ch';
            s.style.display = 'inline-block';
            s.textContent = c === ' ' ? ' ' : c;
            frag.appendChild(s);
            chars.push(s);
          });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1) { walk(n); }
      });
    };
    walk(el);
    return { chars: chars, lines: [el], words: chars };
  };

  /* Magnetic pull. gsap.quickTo keeps this off the main animation path. */
  U.magnetise = function (el, strength) {
    if (!U.fine || U.reducedMotion) return;
    const s = strength || 0.35;
    const xTo = w.gsap.quickTo(el, 'x', { duration: 0.7, ease: 'power3' });
    const yTo = w.gsap.quickTo(el, 'y', { duration: 0.7, ease: 'power3' });
    let raf = 0;

    const move = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * s);
        yTo((e.clientY - (r.top + r.height / 2)) * s);
      });
    };
    const leave = () => { xTo(0); yTo(0); };

    el.addEventListener('mousemove', move);
    el.addEventListener('mouseleave', leave);
  };

  /* Number formatting for the stat counters. */
  U.fmt = (v, decimals) => decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-AU');

  w.APEX_U = U;
})(window);
