/* ============================================================================
   APEX — preloader
   The logo draws itself while the priority frames decode, then the curtain
   wipes up off the first frame of the sequence.
   ========================================================================== */
(function (w) {
  'use strict';

  const U = w.APEX_U;

  function Preloader(seq) {
    this.seq   = seq;
    this.root  = document.getElementById('loader');
    this.count = document.getElementById('loaderCount');
    this.bar   = document.getElementById('loaderBar');
    this.strokes = Array.from(this.root.querySelectorAll('.loader__stroke'));
    this.curtain = this.root.querySelector('.loader__curtain');
    this.shown = 0;
  }

  Preloader.prototype.start = function () {
    const g = w.gsap;

    // Real path lengths, so the draw rate matches the shape of each stroke.
    this.strokes.forEach(function (p) {
      const len = p.getTotalLength();
      p.style.setProperty('--len', len);
      g.set(p, { strokeDasharray: len, strokeDashoffset: len });
    });

    const tl = g.timeline();
    tl.to(this.strokes, {
      strokeDashoffset: 0, duration: 1.5, ease: 'expo.inOut', stagger: 0.13
    })
      .to('.loader__meta, .loader__bar', { opacity: 1, duration: 0.6 }, 0.35);

    this.tl = tl;
  };

  /* Progress is eased toward the true value: a jumpy counter reads as a
     progress bar, a smoothed one reads as a machine warming up. */
  Preloader.prototype.progress = function (p) {
    const self = this;
    const target = U.clamp(p, 0, 1);
    w.gsap.to(this, {
      shown: target, duration: 0.8, ease: 'power2.out', overwrite: true,
      onUpdate: function () {
        const v = Math.round(self.shown * 100);
        self.count.textContent = String(Math.min(99, v)).padStart(2, '0');
        w.gsap.set(self.bar, { scaleX: self.shown });
      }
    });
  };

  /* Hard reveal with no animation. requestAnimationFrame is suspended in a
     background tab, so a page opened in one would otherwise sit behind the
     loader until it is focused. */
  Preloader.prototype.reveal = function () {
    this.shown = 1;
    this.count.textContent = '100';
    this.root.style.display = 'none';
    this.root.style.visibility = 'hidden';
    document.body.classList.remove('is-loading');
  };

  Preloader.prototype.finish = function () {
    const self = this;
    const g = w.gsap;

    if (document.hidden) {
      this.reveal();
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      const tl = g.timeline({
        onComplete: function () {
          self.root.style.display = 'none';
          document.body.classList.remove('is-loading');
          resolve();
        }
      });

      tl.to(self, {
        shown: 1, duration: 0.55, ease: 'power2.inOut',
        onUpdate: function () {
          self.count.textContent = String(Math.round(self.shown * 100)).padStart(2, '0');
          g.set(self.bar, { scaleX: self.shown });
        }
      })
        .to('.loader__bar i', { backgroundColor: '#f2f3f4', duration: 0.3 }, '-=0.2')
        .to('.loader__meta, .loader__bar', { opacity: 0, duration: 0.4 }, '+=0.15')
        .to(self.strokes, {
          strokeDashoffset: function (i, t) { return -parseFloat(t.style.getPropertyValue('--len')); },
          duration: 1.0, ease: 'expo.inOut', stagger: 0.06
        }, '-=0.25')
        .to(self.curtain, { scaleY: 0, duration: 1.15, ease: 'expo.inOut' }, '-=0.55')
        .set(self.root, { autoAlpha: 0 });
    });
  };

  w.APEX_Preloader = Preloader;
})(window);
