/* ============================================================================
   Studio X Detailing — configuration
   The sequence block is the only thing that changes when photoreal Higgsfield
   frames replace the procedural ones. Keep the filenames and this file agrees.
   ========================================================================== */
window.APEX = {

  /* A grade composed into every canvas that draws a baked frame, via
     U.paintFilter. Empty because the frames are baked red at source
     (`paint` in tools/bake/index.html) — a runtime hue rotation was tried
     first and rejected: it moves every non-neutral colour, so it also sent
     the tail lamps blue and the warm specular highlights magenta.

     Left in place as the hook for a cheap regrade — a global tint, a
     brightness trim — that does not justify re-baking 900 frames. */
  paint: {
    filter: ''
  },

  sequence: {
    path:   'assets/sequence/hero/',
    prefix: 'frame_',
    ext:    '.webp',
    pad:    4,
    start:  1,
    count:  420,
    width:  1600,
    height: 900,

    /* Loaded before the curtain lifts: a coarse ladder so scrubbing is
       instant, plus the opening run so scene 1 is never a blank canvas. */
    ladderStep: 12,
    eagerHead:  46,
    /* Simultaneous requests once streaming starts. Browsers cap at ~6 per
       origin anyway; going wider just delays the frames you need first. */
    concurrency: 8
  },

  /* Scene 5 — the turntable. A locked-off camera and the car rotating
     counter-clockwise through a full revolution across the section. */
  turn: {
    path:   'assets/sequence/turn/',
    prefix: 'frame_',
    ext:    '.webp',
    pad:    4,
    start:  1,
    count:  240,
    ladderStep: 8,
    eagerHead:  0,
    concurrency: 6
  },

  /* The scan layer for the same turntable: frame n is the same pose as
     turn frame n, so the overlay registers on the car exactly. The
     travelling scan band is applied at runtime, not baked, so it follows
     scroll position and reverses with it. */
  turnHolo: {
    path:   'assets/sequence/turnholo/',
    prefix: 'frame_',
    ext:    '.webp',
    pad:    4,
    start:  1,
    count:  240,
    ladderStep: 10,
    eagerHead:  0,
    concurrency: 6
  },

  /* Progress points inside the sequence, mirroring tools/render_sequence.py */
  beats: {
    revealEnd: 0.20,
    coatStart: 0.17,
    coatEnd:   0.44,
    igniteEnd: 0.92
  },

  /* The turntable's menu, in the order it populates. `mood` selects which
     effect plays over the rotating car as that line lands. Order and copy
     must match the markup in index.html.

     The six lines are the six services Studio X actually sells. `film` and
     `cabin` are DOM layers rather than canvas effects; the rest are drawn in
     scenes.js. Each mood is used once, so no two lines look alike.

     `view` reframes the turntable as that line lands, so the section is a
     shot list rather than one unbroken lap of the car. `zoom` is relative to
     the whole car in frame (1 = the full car); `ox`/`oy` say which part of
     the frame to hold, the way background-position does — 0 is left/top, 1 is
     right/bottom. Biasing `ox` under 0.5 pushes the car right, clear of the
     menu column. Values are interpolated between consecutive lines, so this
     is still a pure function of scroll and still reverses exactly. */
  services: [
    { key:'ppf',      mood:'film',    view:{ zoom:1.26, ox:0.46, oy:0.52 } },
    { key:'ceramic',  mood:'beads',   view:{ zoom:1.52, ox:0.44, oy:0.56 } },
    { key:'tint',     mood:'tint',    view:{ zoom:1.64, ox:0.45, oy:0.43 } },
    { key:'correct',  mood:'swirl',   view:{ zoom:1.98, ox:0.43, oy:0.55 } },
    { key:'detail',   mood:'cabin',   view:{ zoom:1.44, ox:0.46, oy:0.60 } },
    /* the package is the whole car again — the section opens out for it */
    { key:'package',  mood:'package', view:{ zoom:1.00, ox:0.50, oy:0.50 } }
  ],

  /* Where the car sits inside the turntable frame — used to keep the canvas
     effects on the paint instead of scattered across the studio. */
  stage: { cx: 0.50, cy: 0.54, rx: 0.31, ry: 0.20 },

  /* ── the booking flow ──────────────────────────────────────────────────
     Single source of truth for the enquiry dialog: what can be booked, when
     the studio is open, and where the enquiry ends up. There is no backend —
     the last step composes an email and hands it to the visitor's own mail
     client, so nothing is ever sent without them pressing send. */
  booking: {
    email: 'Info.studioxdetailing@gmail.com',
    phone: '+61 422 286 232',

    /* Mon–Sat by appointment, 9:00–18:30. 0 = Sunday. */
    openDays:  [1, 2, 3, 4, 5, 6],
    dayStart:  9 * 60,
    dayEnd:    18 * 60 + 30,
    slotMins:  30,
    leadDays:  1,          // earliest bookable day, counted from today
    horizonDays: 120,      // latest

    /* `face` is what the card shows once it is turned over — the flash-card
       side. Kept short: it is a prompt for the consultation, not a spec. */
    services: [
      { key:'ppf',     name:'Paint Protection Film', short:'PPF',
        blurb:'Invisible protection against chips and road damage.',
        face:'Coverage options, edge wrapping, and what the film does and does not hide.',
        lead:'2–3 days' },
      { key:'ceramic', name:'Ceramic Coating', short:'Ceramic',
        blurb:'Long-lasting gloss and easier maintenance.',
        face:'The system, its expected life on your paint, and the prep the finish depends on.',
        lead:'2–3 days' },
      { key:'tint',    name:'Window Tinting', short:'Tint',
        blurb:'Reduce heat, block UV, sharpen how the car reads.',
        face:'Legal VLT for Victoria, heat rejection, and how the glass looks once it is done.',
        lead:'1 day' },
      { key:'correct', name:'Paint Correction', short:'Correction',
        blurb:'Swirl marks removed and depth restored.',
        face:'Which stage your paint needs, and how much of the finish is recoverable.',
        lead:'1–2 days' },
      { key:'detail',  name:'Car Detailing', short:'Detailing',
        blurb:'Deep clean, restore and refresh every surface.',
        face:'Interior scope, exterior stages, and how long the car stays with us.',
        lead:'1 day' },
      { key:'package', name:'New Car Package', short:'New car',
        blurb:'Complete protection from day one.',
        face:'Film, coating and tint specified together before delivery — never corrected, only protected.',
        lead:'3 days' }
    ]
  },

  /* Frames used as stills elsewhere on the page. */
  stills: {
    book:    408,
    gallery: [214, 262, 300, 342, 392]
  }
};
