// Mochi, Burrow's pixel companion.
// Sprites are tiny text grids; each letter is a colour role. Drawn as crisp SVG.
//   b = body   i = inner ear   k = eye/mouth (ink)   c = cheek (accent)   s = feet/shadow
//   z = a floating "z" when sleepy (drawn without an outline)
(function (root) {
  const POSES = {
    idle: [
      '..bb....bb..', '.bib....bib.', '.bib....bib.', '..bbbbbbbb..', '.bbbbbbbbbb.',
      'bbbkbbbbkbbb', 'bcbbbbbbbbcb', 'bbbbbkkbbbbb', '.bbbbbbbbbb.', '..ss....ss..',
    ],
    blink: [
      '..bb....bb..', '.bib....bib.', '.bib....bib.', '..bbbbbbbb..', '.bbbbbbbbbb.',
      'bbbbbbbbbbbb', 'bckkbbbbkkcb', 'bbbbbkkbbbbb', '.bbbbbbbbbb.', '..ss....ss..',
    ],
    happy: [
      '............', '..bb....bb..', '.bib....bib.', '..bbbbbbbb..', '.bbbbbbbbbb.',
      'bbkbkbbkbkbb', 'bcbbbbbbbbcb', 'bbbbkkkkbbbb', '.bbbbbbbbbb.', '..ss....ss..',
    ],
    shades: [
      '..bb....bb..', '.bib....bib.', '.bib....bib.', '..bbbbbbbb..', '.bbbbbbbbbb.',
      'bkkkkkkkkkkb', 'bckkkbbkkkcb', 'bbbbbkkbbbbb', '.bbbbbbbbbb.', '..ss....ss..',
    ],
    wave: [
      '..bb....bb...', '.bib....bib..', '.bib....bib.b', '..bbbbbbbbbb.', '.bbbbbbbbbb..',
      'bbbkbbbbkbbb.', 'bcbbbbbbbbcb.', 'bbbbbkkbbbbb.', '.bbbbbbbbbb..', '..ss....ss...',
    ],
    // Drowsy: eyes shut, ears drooping, a little "z" floating up.
    sleepy: [
      '...........zz', '..bb....bb..z', '.bib....bibzz', '..bbbbbbbb...', '.bbbbbbbbbb..',
      'bbbbbbbbbbbb.', 'bckkbbbbkkcb.', 'bbbbbbkbbbbb.', '.bbbbbbbbbb..', '..ss....ss...',
    ],
    // Two walking frames: the feet swap places.
    walk1: [
      '..bb....bb..', '.bib....bib.', '.bib....bib.', '..bbbbbbbb..', '.bbbbbbbbbb.',
      'bbbkbbbbkbbb', 'bcbbbbbbbbcb', 'bbbbbkkbbbbb', '.bbbbbbbbbb.', '.ss......ss.',
    ],
    walk2: [
      '............', '..bb....bb..', '.bib....bib.', '.bbbbbbbbbb.', '.bbbbbbbbbb.',
      'bbbkbbbbkbbb', 'bcbbbbbbbbcb', 'bbbbbkkbbbbb', '.bbbbbbbbbb.', '...ss..ss...',
    ],
    // Squashed down, pushing a button (phase 8: Mochi presses a tab's ×).
    press: [
      '............', '............', '.bbb....bbb.', '.bbbbbbbbbb.', 'bbbbbbbbbbbb',
      'bbkkbbbbkkbb', 'bcbbbbbbbbcb', 'bbbbbkkbbbbb', 'bbbbbbbbbbbb', '.ss......ss.',
    ],
    // Paws up, cheering.
    celebrate: [
      'b.bb....bb.b', 'bbib....bibb', '.bib....bib.', '..bbbbbbbb..', '.bbbbbbbbbb.',
      'bbkbkbbkbkbb', 'bcbbbbbbbbcb', 'bbbbkkkkbbbb', '.bbbbbbbbbb.', '..ss....ss..',
    ],
    // Chomp! Mouth wide open, then cheeks puffed (Mochi eating a tab when its time is up).
    chomp1: [
      '..bb....bb..', '.bib....bib.', '.bib....bib.', '..bbbbbbbb..', '.bbkbbbbkbb.',
      'bbbbbbbbbbbb', 'bckkkkkkkkcb', 'bbk......kbb', '.bkkkkkkkkb.', '..ss....ss..',
    ],
    chomp2: [
      '..bb....bb..', '.bib....bib.', '.bib....bib.', '..bbbbbbbb..', '.bbbbbbbbbb.',
      'bbkkbbbbkkbb', 'ccbbbbbbbbcc', 'bcbbkkkkbbcb', '.bbbbbbbbbb.', '..ss....ss..',
    ],
    // Something went wrong: a little frown.
    oops: [
      '..bb....bb..', '.bib....bib.', '.bib....bib.', '..bbbbbbbb..', '.bbbbbbbbbb.',
      'bbbkbbbbkbbb', 'bcbbbbbbbbcb', 'bbbbbkkbbbbb', '.bbbkbbkbbb.', '..ss....ss..',
    ],
  };
  // Every pose is drawn on the same canvas, so switching poses never makes Mochi jump.
  const WIDTH = Math.max(...Object.values(POSES).flat().map((r) => r.length)) + 2;
  const HEIGHT = Math.max(...Object.values(POSES).map((p) => p.length)) + 2;

  // tokens: output of BurrowTheme.build (uses fg, accent, muted, mochiBody, mochiInner, mochiInk)
  function svg(tokens, pose, size) {
    const rows = POSES[pose] || POSES.idle;
    const ink = tokens.mochiInk || tokens.fg;
    const col = { b: tokens.mochiBody, i: tokens.mochiInner, k: ink, c: tokens.accent, s: tokens.muted, z: tokens.muted || ink };
    let outline = '', fill = '';
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if (ch === '.') return;
      if (ch !== 'z') outline += `<rect x="${x}" y="${y}" width="3" height="3"/>`;
      fill += `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${col[ch]}"/>`;
    }));
    const px = size || 48;
    return `<svg class="mochi-svg" data-pose="${pose in POSES ? pose : 'idle'}" width="${px}" height="${Math.round(px * HEIGHT / WIDTH)}" ` +
      `viewBox="0 0 ${WIDTH} ${HEIGHT}" shape-rendering="crispEdges" aria-hidden="true"><g fill="${ink}">${outline}</g>${fill}</svg>`;
  }

  // Flip through poses on an element, like a flip-book. Returns a function that stops it.
  //   play(el, tokens, ['walk1', 'walk2'], { fps: 8, size: 30, loop: true })
  function play(el, tokens, frames, { fps = 8, size = 48, loop = true, done } = {}) {
    let i = 0;
    const draw = () => { el.innerHTML = svg(tokens, frames[i % frames.length], size); };
    draw();
    const timer = setInterval(() => {
      i++;
      if (!loop && i >= frames.length) { clearInterval(timer); done?.(); return; }
      draw();
    }, 1000 / fps);
    return () => clearInterval(timer);
  }

  const api = { POSES, svg, play };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mochi = api;
})(typeof window !== 'undefined' ? window : globalThis);
