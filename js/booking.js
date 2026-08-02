/* ============================================================================
   Studio X Detailing — booking dialog

   Four steps, each one a card that turns over into the next: what the car is
   in for, when, who you are, and a review before anything leaves the page.

   There is no backend. The last step composes an email and hands it to the
   visitor's own mail client, so the enquiry is only ever sent by them, from
   their address, with the whole thing visible before they press send.
   ========================================================================== */
(function (w) {
  'use strict';

  const U = w.APEX_U;
  const CFG = (w.APEX && w.APEX.booking) || null;
  const root = document.getElementById('bk');
  if (!CFG || !root) return;

  const d = document;
  const $ = (id) => d.getElementById(id);

  const deck    = $('bkDeck');
  const cards   = Array.from(deck.querySelectorAll('.bk__card'));
  const rail    = $('bkRail');
  const railLis = Array.from(rail.children);
  const btnNext = $('bkNext2');
  const btnBack = $('bkBack');
  const errEl   = $('bkErr');

  const MONTHS = ['January','February','March','April','May','June','July',
                  'August','September','October','November','December'];
  const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  /* ── state ─────────────────────────────────────────────────────────────
     Everything the visitor has told us. Re-opening the dialog keeps it, so
     closing by accident does not cost them the form. */
  const state = { step: 0, q: 0, services: [], date: null, time: null };
  let opener = null;
  let cursor = startOfDay(new Date());   // which month the calendar is showing

  /* ── date helpers ──────────────────────────────────────────────────────
     All local time. Dates are compared and keyed by y-m-d rather than by
     timestamp, so daylight saving cannot shift a day underneath us. */
  function startOfDay(dt) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); }
  function addDays(dt, n) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n); }
  function key(dt) { return dt.getFullYear() + '-' + (dt.getMonth() + 1) + '-' + dt.getDate(); }
  function sameDay(a, b) { return !!a && !!b && key(a) === key(b); }

  function bookable(dt) {
    const today = startOfDay(new Date());
    const first = addDays(today, CFG.leadDays);
    const last  = addDays(today, CFG.horizonDays);
    if (dt < first || dt > last) return false;
    return CFG.openDays.indexOf(dt.getDay()) !== -1;
  }

  function slots() {
    const out = [];
    for (let m = CFG.dayStart; m <= CFG.dayEnd; m += CFG.slotMins) {
      out.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
    }
    return out;
  }

  function longDate(dt) {
    return DAYS[dt.getDay()] + ' ' + dt.getDate() + ' ' + MONTHS[dt.getMonth()] + ' ' + dt.getFullYear();
  }

  /* ── step 1 · the service cards ────────────────────────────────────────
     Each card turns over: the front is the offer, the back is what the
     consultation actually covers. Selecting is a separate gesture from
     turning, or you could not read a card without also choosing it. */
  function buildServices() {
    const ul = $('bkSvcs');
    ul.innerHTML = '';
    CFG.services.forEach(function (svc, i) {
      const li = d.createElement('li');
      li.className = 'bk-svc';
      li.dataset.key = svc.key;
      li.innerHTML =
        '<div class="bk-svc__flip">' +
          '<button class="bk-svc__face bk-svc__front" type="button" aria-pressed="false">' +
            '<span class="bk-svc__num">' + String(i + 1).padStart(2, '0') + '</span>' +
            '<span class="bk-svc__name"></span>' +
            '<span class="bk-svc__blurb"></span>' +
            '<span class="bk-svc__lead"></span>' +
            '<span class="bk-svc__tick" aria-hidden="true">' +
              '<svg viewBox="0 0 16 16"><path d="M3 8.5 L6.5 12 L13 4"/></svg></span>' +
          '</button>' +
          '<div class="bk-svc__face bk-svc__back">' +
            '<span class="bk-svc__facetext"></span>' +
            '<span class="bk-svc__hint">Tap to turn back</span>' +
          '</div>' +
        '</div>' +
        '<button class="bk-svc__turn" type="button" aria-label="What this covers">' +
          '<span aria-hidden="true">i</span></button>';

      li.querySelector('.bk-svc__name').textContent  = svc.name;
      li.querySelector('.bk-svc__blurb').textContent = svc.blurb;
      li.querySelector('.bk-svc__lead').textContent  = svc.lead + ' in the studio';
      li.querySelector('.bk-svc__facetext').textContent = svc.face;

      li.querySelector('.bk-svc__front').addEventListener('click', function () { toggle(svc.key); });
      li.querySelector('.bk-svc__turn').addEventListener('click', function (e) {
        e.stopPropagation();
        li.classList.toggle('is-turned');
      });
      li.querySelector('.bk-svc__back').addEventListener('click', function () {
        li.classList.remove('is-turned');
      });
      ul.appendChild(li);
    });
  }

  function toggle(k) {
    const at = state.services.indexOf(k);
    if (at === -1) state.services.push(k); else state.services.splice(at, 1);
    paintServices();
    clearErr();
  }

  function paintServices() {
    Array.from(d.querySelectorAll('.bk-svc')).forEach(function (li) {
      const on = state.services.indexOf(li.dataset.key) !== -1;
      li.classList.toggle('is-on', on);
      li.querySelector('.bk-svc__front').setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ── step 2 · calendar and slots ───────────────────────────────────── */
  function buildCalendar() {
    const grid = $('bkGrid');
    grid.innerHTML = '';
    $('bkMonth').textContent = MONTHS[cursor.getMonth()] + ' ' + cursor.getFullYear();

    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    // Monday-first, the way a Melbourne calendar reads
    const lead = (first.getDay() + 6) % 7;
    for (let i = 0; i < lead; i++) grid.appendChild(d.createElement('span'));

    for (let day = 1; day <= total; day++) {
      const dt = new Date(cursor.getFullYear(), cursor.getMonth(), day);
      const b = d.createElement('button');
      b.type = 'button';
      b.className = 'bk-day';
      b.textContent = day;
      if (!bookable(dt)) {
        b.disabled = true;
        b.className += ' is-off';
      } else {
        b.addEventListener('click', function () {
          state.date = dt;
          state.time = null;
          buildCalendar();
          buildSlots();
          clearErr();
        });
      }
      if (sameDay(dt, state.date)) b.className += ' is-on';
      grid.appendChild(b);
    }

    // a month with nothing bookable in it should not look like a dead end
    const today = startOfDay(new Date());
    $('bkPrev').disabled = cursor.getFullYear() === today.getFullYear() &&
                           cursor.getMonth() === today.getMonth();
  }

  function buildSlots() {
    const wrap = $('bkChips');
    const label = $('bkSlotLabel');
    wrap.innerHTML = '';
    if (!state.date) { label.textContent = 'Pick a day first'; return; }
    label.textContent = longDate(state.date);

    slots().forEach(function (t) {
      const b = d.createElement('button');
      b.type = 'button';
      b.className = 'bk-chip' + (state.time === t ? ' is-on' : '');
      b.textContent = t;
      b.addEventListener('click', function () {
        state.time = t;
        buildSlots();
        clearErr();
      });
      wrap.appendChild(b);
    });
  }

  /* ── step 4 · review ───────────────────────────────────────────────── */
  function nameOf(k) {
    for (let i = 0; i < CFG.services.length; i++) if (CFG.services[i].key === k) return CFG.services[i].name;
    return k;
  }

  function details() {
    return {
      name:  $('bkName').value.trim(),
      phone: $('bkPhone').value.trim(),
      email: $('bkEmail').value.trim(),
      car:   $('bkCar').value.trim(),
      notes: $('bkNotes').value.trim()
    };
  }

  function buildSummary() {
    const dl = $('bkSummary');
    const v = details();
    const rows = [
      ['Service',  state.services.map(nameOf).join(', ')],
      ['Date',     state.date ? longDate(state.date) : ''],
      ['Time',     state.time || ''],
      ['Name',     v.name],
      ['Phone',    v.phone],
      ['Email',    v.email],
      ['Vehicle',  v.car],
      ['Notes',    v.notes]
    ].filter(function (r) { return r[1]; });

    dl.innerHTML = '';
    rows.forEach(function (r) {
      const dt = d.createElement('dt'); dt.textContent = r[0];
      const dd = d.createElement('dd'); dd.textContent = r[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
  }

  function mailto() {
    const v = details();
    const lines = [
      'Service:  ' + state.services.map(nameOf).join(', '),
      'Date:     ' + (state.date ? longDate(state.date) : ''),
      'Time:     ' + (state.time || ''),
      '',
      'Name:     ' + v.name,
      'Phone:    ' + (v.phone || '—'),
      'Email:    ' + (v.email || '—'),
      'Vehicle:  ' + (v.car || '—'),
      '',
      v.notes ? 'Notes:\n' + v.notes : ''
    ].join('\n').trim();

    const subject = 'Consultation — ' + state.services.map(nameOf).join(', ') +
                    (state.date ? ' — ' + longDate(state.date) : '');
    return 'mailto:' + CFG.email +
           '?subject=' + encodeURIComponent(subject) +
           '&body=' + encodeURIComponent(lines);
  }

  /* ── step 3 · one question per card ────────────────────────────────────
     The five inputs all stay in the DOM and only the active question is
     shown, so answers survive moving back and forth without being copied
     into state and back out again. */
  const qs = Array.from(deck.querySelectorAll('.bk__q'));

  /* Only the name is compulsory. The pair is checked once, on the card that
     closes it: asking for a phone and refusing to move on would be a lie,
     because an email on the next card does just as well. */
  function problemQ(i) {
    const v = details();
    if (i === 0 && !v.name) return 'We need a name.';
    if (i === 2) {
      if (v.email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v.email)) return 'That email does not look right.';
      if (!v.phone && !v.email) return 'A phone number or an email — either is fine.';
    }
    return null;
  }

  /* Jump straight to a question with no turn — used when the deck itself is
     changing card, where the step's own animation is already carrying it. */
  function resetQ(i) {
    state.q = U.clamp(i, 0, qs.length - 1);
    qs.forEach(function (el, k) {
      el.hidden = k !== state.q;
      if (w.gsap) w.gsap.set(el, { rotateX: 0, opacity: k === state.q ? 1 : 0 });
    });
    btnNext.textContent = state.q === qs.length - 1 ? 'Continue' : 'Next';
  }

  function showQ(next, back) {
    next = U.clamp(next, 0, qs.length - 1);
    const from = qs[state.q];
    const to   = qs[next];
    state.q = next;

    if (from !== to) {
      to.hidden = false;
      if (U.reducedMotion || !w.gsap) {
        from.hidden = true;
      } else {
        const g = w.gsap;
        g.killTweensOf([from, to]);
        g.to(from, {
          rotateX: back ? 22 : -22, opacity: 0, duration: 0.22, ease: 'power2.in',
          onComplete: function () { from.hidden = true; g.set(from, { rotateX: 0 }); }
        });
        g.fromTo(to, { rotateX: back ? -22 : 22, opacity: 0 },
          { rotateX: 0, opacity: 1, duration: 0.4, delay: 0.12, ease: 'power3.out' });
      }
    }

    btnNext.textContent = next === qs.length - 1 ? 'Continue' : 'Next';
    const field = to.querySelector('input, textarea');
    if (field) setTimeout(function () { field.focus(); }, U.reducedMotion ? 0 : 260);
    clearErr();
  }

  /* ── validation ────────────────────────────────────────────────────── */
  function problem(step) {
    if (step === 0 && !state.services.length) return 'Pick at least one service.';
    if (step === 1 && !state.date) return 'Pick a day.';
    if (step === 1 && !state.time) return 'Pick a time.';
    if (step === 2) {
      const v = details();
      if (!v.name) return 'We need a name.';
      if (!v.phone && !v.email) return 'A phone number or an email, either is fine.';
      if (v.email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v.email)) return 'That email does not look right.';
    }
    return null;
  }

  function clearErr() { errEl.textContent = ''; }

  /* ── the deck ──────────────────────────────────────────────────────────
     One card is visible at a time and the outgoing one turns away as the
     incoming one turns in, which is why both are briefly un-hidden. */
  function show(next) {
    if (next === state.step) return;
    const from = cards[state.step];
    const to   = cards[next];
    const back = next < state.step;
    state.step = next;

    if (next === 1) { buildCalendar(); buildSlots(); }
    if (next === 3) buildSummary();
    // arriving at the questions: first one going forward, last one coming back
    if (next === 2) resetQ(back ? qs.length - 1 : 0);

    to.hidden = false;
    if (U.reducedMotion || !w.gsap) {
      from.hidden = true;
      from.classList.remove('is-active');
      to.classList.add('is-active');
    } else {
      const g = w.gsap;
      g.killTweensOf([from, to]);
      g.to(from, {
        rotateY: back ? 55 : -55, opacity: 0, duration: 0.3, ease: 'power2.in',
        onComplete: function () { from.hidden = true; from.classList.remove('is-active'); g.set(from, { rotateY: 0 }); }
      });
      g.fromTo(to, { rotateY: back ? -55 : 55, opacity: 0 },
        { rotateY: 0, opacity: 1, duration: 0.55, delay: 0.16, ease: 'power3.out',
          onStart: function () { to.classList.add('is-active'); } });
    }

    paintChrome();
    clearErr();
  }

  function paintChrome() {
    railLis.forEach(function (li, i) {
      li.classList.toggle('is-on',   i === state.step);
      li.classList.toggle('is-done', i <  state.step);
    });
    btnBack.hidden = state.step === 0;
    btnNext.textContent = state.step === 3 ? 'Send enquiry'
      : (state.step === 2 && state.q < qs.length - 1) ? 'Next' : 'Continue';
    // the dialog scrolls internally; a step change should start at the top
    deck.scrollTop = 0;
  }

  /* ── open / close ──────────────────────────────────────────────────── */
  let lastFocus = null;

  function open(trigger) {
    opener = trigger || null;
    lastFocus = d.activeElement;

    const pre = trigger && trigger.getAttribute('data-service');
    if (pre && state.services.indexOf(pre) === -1) state.services.push(pre);
    paintServices();

    root.hidden = false;
    d.body.classList.add('is-modal');
    if (w.APEX_APP && w.APEX_APP.lenis) w.APEX_APP.lenis.stop();

    /* Always open on the service step, even when the answers from a previous
       visit are still filled in. Resuming somewhere in the middle — or worse,
       on the review card with Send under the thumb — is not what someone who
       just pressed "Book" is expecting. */
    state.step = 0;
    resetQ(0);
    cards.forEach(function (c, i) {
      c.hidden = i !== 0;
      c.classList.toggle('is-active', i === 0);
      if (w.gsap) w.gsap.set(c, { rotateY: 0, opacity: i === 0 ? 1 : 0 });
    });
    paintChrome();

    if (w.gsap && !U.reducedMotion) {
      const g = w.gsap;
      const dialog = root.querySelector('.bk__dialog');
      const scrim  = root.querySelector('.bk__scrim');
      g.killTweensOf([dialog, scrim]);

      /* The dialog is uncovered rather than slid in: the panel holds its
         final position and a clip opens down it, so the eye stays on the
         content instead of tracking a moving box. The scrim leads by a beat
         so the page is already receding when the panel arrives. */
      g.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: 0.45, ease: 'power2.out' });
      g.fromTo(dialog,
        { y: 14, opacity: 0, clipPath: 'inset(12% 0% 12% 0%)' },
        { y: 0, opacity: 1, clipPath: 'inset(0% 0% 0% 0%)', duration: 0.72, ease: 'expo.out' });

      /* The chrome settles after the panel it sits in. clearProps matters:
         the deck writes its own transforms on these later, and a leftover
         inline y would fight the card turn. */
      g.from([root.querySelector('.bk__bar'), root.querySelector('.bk__rail')], {
        y: 16, opacity: 0, duration: 0.6, ease: 'power3.out',
        stagger: 0.07, delay: 0.14, clearProps: 'all'
      });
    }
    setTimeout(function () { root.querySelector('.bk__close').focus(); }, 60);
  }

  /* Closing used to be a cut — `hidden` straight back on. Everything the
     dialog does on the way in, it now undoes on the way out, a little faster,
     because an exit that matches its entrance frame for frame reads as slow. */
  let closing = false;

  function close() {
    if (closing) return;

    function finish() {
      closing = false;
      root.hidden = true;
      d.body.classList.remove('is-modal');
      if (w.APEX_APP && w.APEX_APP.lenis) w.APEX_APP.lenis.start();
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      opener = null;
    }

    if (!w.gsap || U.reducedMotion) { finish(); return; }

    const g = w.gsap;
    const dialog = root.querySelector('.bk__dialog');
    const scrim  = root.querySelector('.bk__scrim');
    closing = true;
    g.killTweensOf([dialog, scrim]);
    g.to(dialog, {
      y: 10, opacity: 0, clipPath: 'inset(8% 0% 8% 0%)',
      duration: 0.34, ease: 'power2.in'
    });
    g.to(scrim, { opacity: 0, duration: 0.42, ease: 'power2.in', onComplete: finish });
  }

  /* ── wiring ────────────────────────────────────────────────────────── */
  buildServices();
  paintChrome();

  d.addEventListener('click', function (e) {
    const t = e.target.closest('[data-book]');
    if (t) { e.preventDefault(); open(t); return; }
    if (e.target.closest('[data-bk-close]')) { e.preventDefault(); close(); }
  });

  function advance() {
    // inside the questions the button walks the cards, not the steps
    if (state.step === 2) {
      const bad = problemQ(state.q);
      if (bad) { errEl.textContent = bad; return; }
      if (state.q < qs.length - 1) { showQ(state.q + 1, false); return; }
    }
    const p = problem(state.step);
    if (p) { errEl.textContent = p; return; }
    show(state.step + 1);
  }

  btnNext.addEventListener('click', function () {
    if (state.step === 3) {
      // re-check every earlier step: the review card is reachable by Back,
      // and a field can be emptied after it was first passed
      for (let i = 0; i < 3; i++) {
        const bad = problem(i);
        if (bad) { show(i); errEl.textContent = bad; return; }
      }
      w.location.href = mailto();
      return;
    }
    advance();
  });

  btnBack.addEventListener('click', function () {
    if (state.step === 2 && state.q > 0) { showQ(state.q - 1, true); return; }
    show(Math.max(0, state.step - 1));
  });

  /* Enter moves to the next question. Not in the textarea — that one wants
     newlines more than it wants to submit. */
  deck.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || state.step !== 2) return;
    if (e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    advance();
  });
  $('bkPrev').addEventListener('click', function () {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    buildCalendar();
  });
  $('bkNext').addEventListener('click', function () {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    buildCalendar();
  });

  d.addEventListener('keydown', function (e) {
    if (root.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    // focus stays inside the dialog while it is open
    const f = Array.from(root.querySelectorAll(
      'button:not([disabled]):not([hidden]), input, textarea, a[href]'))
      .filter(function (el) { return el.offsetParent !== null; });
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  w.APEX_Booking = { open: open, close: close, state: state };
})(window);
