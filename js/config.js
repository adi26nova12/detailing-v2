/* ============================================================================
   APEX — configuration
   The sequence block is the only thing that changes when photoreal Higgsfield
   frames replace the procedural ones. Keep the filenames and this file agrees.
   ========================================================================== */
window.APEX = {

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

  /* Scene 5's menu, in the order it populates. `mood` selects which effect
     plays over the rotating car as that line lands. Order and copy must match
     the markup in index.html. */
  services: [
    { key:'ppf',      mood:'film'    },
    { key:'ceramic',  mood:'beads'   },
    { key:'tint',     mood:'tint'    },
    { key:'detail',   mood:'swirl'   },
    { key:'package',  mood:'package' }
  ],

  /* Where the car sits inside the turntable frame — used to keep the canvas
     effects on the paint instead of scattered across the studio. */
  stage: { cx: 0.50, cy: 0.54, rx: 0.31, ry: 0.20 },

  /* Scene 4 — the readout settles on these once the surface is analysed. */
  metrics: {
    depth:   { to:127, decimals:0 },
    gloss:   { to:96,  decimals:0 },
    reflect: { to:99,  decimals:0 },
    water:   { to:112, decimals:0 },
    contam:  { to:0,   decimals:0 },
    swirl:   { to:0,   decimals:0 }
  },

  /* Frames used as stills elsewhere on the page. */
  stills: {
    inspect: 300,
    compare: 366,
    book:    408,
    gallery: [214, 262, 300, 342, 392]
  }
};
