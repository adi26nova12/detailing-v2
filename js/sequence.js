/* ============================================================================
   APEX — image sequence engine

   Owns every frame on the page. One decoded copy of each frame serves the
   hero canvas, the inspection plate, the service push, the comparison slider,
   the gallery and the booking hero, so nothing is fetched twice.
   ========================================================================== */
(function (w) {
  'use strict';

  const U = w.APEX_U;

  function Sequence(cfg) {
    this.cfg = cfg;
    this.n = cfg.count;
    this.images = new Array(this.n);
    this.state = new Uint8Array(this.n);      // 0 idle · 1 pending · 2 ready · 3 failed
    this.readyCount = 0;
    this.queue = [];
    this.active = 0;
    this._listeners = [];
    this.plates = [];
  }

  Sequence.prototype.url = function (i) {
    const c = this.cfg;
    return c.path + c.prefix + String(c.start + i).padStart(c.pad, '0') + c.ext;
  };

  Sequence.prototype.onProgress = function (fn) { this._listeners.push(fn); };

  Sequence.prototype._emit = function () {
    const p = this.readyCount / this.n;
    for (let i = 0; i < this._listeners.length; i++) this._listeners[i](p, this.readyCount, this.n);
    // Any plate still showing nothing gets another chance as frames arrive,
    // so a still that was not in the priority set fills itself in.
    for (let k = 0; k < this.plates.length; k++) {
      if (this.plates[k]._drawn === -1) this.plates[k].render(true);
    }
  };

  Sequence.prototype._load = function (i) {
    const self = this;
    if (this.state[i]) return Promise.resolve();
    this.state[i] = 1;

    return new Promise(function (resolve) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        const done = function () {
          self.images[i] = img;
          self.state[i] = 2;
          self.readyCount++;
          self._emit();
          resolve();
        };
        // Decode off the main thread where supported so the first paint of a
        // frame during a scrub never costs a dropped frame.
        if (img.decode) img.decode().then(done, done); else done();
      };
      img.onerror = function () { self.state[i] = 3; self.readyCount++; self._emit(); resolve(); };
      img.src = self.url(i);
    });
  };

  /* Frames needed before the curtain lifts: a coarse ladder across the whole
     timeline (so any scroll position resolves to something) plus the opening
     run at full density. */
  Sequence.prototype.priorityList = function () {
    const c = this.cfg, out = [], seen = new Set();
    const push = (i) => { if (i >= 0 && i < this.n && !seen.has(i)) { seen.add(i); out.push(i); } };
    for (let i = 0; i < c.eagerHead; i++) push(i);
    for (let i = 0; i < this.n; i += c.ladderStep) push(i);
    push(this.n - 1);
    return out;
  };

  Sequence.prototype.preload = function () {
    const self = this;
    const list = this.priorityList();
    let cursor = 0;

    const runner = function () {
      if (cursor >= list.length) return Promise.resolve();
      const i = list[cursor++];
      return self._load(i).then(runner);
    };

    const lanes = [];
    for (let k = 0; k < Math.min(this.cfg.concurrency, list.length); k++) lanes.push(runner());
    return Promise.all(lanes);
  };

  /* Everything else, filled in behind the experience. */
  Sequence.prototype.stream = function () {
    const self = this;
    for (let i = 0; i < this.n; i++) if (!this.state[i]) this.queue.push(i);

    const pump = function () {
      while (self.active < self.cfg.concurrency && self.queue.length) {
        const i = self.queue.shift();
        if (self.state[i]) continue;
        self.active++;
        self._load(i).then(function () { self.active--; pump(); });
      }
    };
    pump();
  };

  /* Nearest decoded neighbour, so a scrub into un-streamed territory holds the
     closest real frame instead of flashing empty. */
  Sequence.prototype.get = function (i) {
    i = U.clamp(Math.round(i), 0, this.n - 1);
    if (this.state[i] === 2) return this.images[i];
    for (let r = 1; r < this.n; r++) {
      const a = i - r, b = i + r;
      if (a >= 0 && this.state[a] === 2) return this.images[a];
      if (b < this.n && this.state[b] === 2) return this.images[b];
    }
    return null;
  };

  /* Nudge the streaming queue so frames around the playhead land first. */
  Sequence.prototype.hint = function (i) {
    if (!this.queue.length) return;
    const c = U.clamp(Math.round(i), 0, this.n - 1);
    this.queue.sort((a, b) => Math.abs(a - c) - Math.abs(b - c));
  };

  /* ── drawing ─────────────────────────────────────────────────────────── */

  Sequence.prototype.paint = function (ctx, img, cssW, cssH, opt) {
    if (!img) return;
    const o = opt || {};
    const d = U.dpr();
    const r = U.coverRect(cssW, cssH, img.naturalWidth, img.naturalHeight,
                          o.ox, o.oy, o.zoom || 1, o.fit);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (o.filter) ctx.filter = o.filter;
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    if (o.filter) ctx.filter = 'none';
  };

  /* ── canvas bound to the sequence ────────────────────────────────────── */

  function Plate(canvas, seq) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.seq = seq;
    this.index = 0;
    this.opt = { zoom: 1, ox: 0.5, oy: 0.5 };
    this._drawn = -1;
    this._w = 0; this._h = 0;
    seq.plates.push(this);
    this.resize();
  }

  Plate.prototype.resize = function () {
    const r = this.canvas.getBoundingClientRect();
    const cw = r.width || this.canvas.offsetWidth || 1;
    const ch = r.height || this.canvas.offsetHeight || 1;
    this._w = cw; this._h = ch;
    U.sizeCanvas(this.canvas, cw, ch);
    this._drawn = -1;
    this.render(true);
  };

  Plate.prototype.set = function (index, opt) {
    this.index = index;
    if (opt) for (const k in opt) this.opt[k] = opt[k];
    this.render();
  };

  Plate.prototype.render = function (force) {
    const img = this.seq.get(this.index);
    if (!img) return;
    const key = this.index + '|' + this.opt.zoom + '|' + this.opt.ox + '|' + this.opt.oy
      + '|' + (this.opt.filter || '') + '|' + (this.opt.fit || '');
    if (!force && key === this._drawn) return;
    this._drawn = key;
    this.seq.paint(this.ctx, img, this._w, this._h, this.opt);
  };

  w.APEX_Sequence = Sequence;
  w.APEX_Plate = Plate;
})(window);
