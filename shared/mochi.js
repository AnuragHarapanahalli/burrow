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

  // ---------- Outfits (bought with carrots) ----------
  // Each outfit is a few pixels placed relative to the pose's own head / eyes / feet, so it sits right
  // in every pose. a = accent colour, k = ink, g = gold.
  const OUTFITS = {
    scarf: { name: 'Scarf', price: 10 },
    bowtie: { name: 'Bow tie', price: 15 },
    glasses: { name: 'Glasses', price: 20 },
    beanie: { name: 'Beanie', price: 30 },
    crown: { name: 'Crown', price: 50 },
  };
  function anchors(rows) {
    const headTop = rows.findIndex((r) => (r.match(/b/g) || []).length >= 8);
    const eyeRow = rows.findIndex((r, i) => i >= headTop && r.includes('k'));
    const footRow = rows.findIndex((r) => r.includes('s'));
    return { headTop, eyeRow, footRow };
  }
  function outfitCells(rows, wear) {
    const { headTop, eyeRow, footRow } = anchors(rows);
    const cells = [];
    const put = (x, y, c, hat) => { if (y >= 0) cells.push({ x, y, c, hat }); };
    if (wear === 'scarf' && footRow > 0) {
      for (let x = 1; x <= 10; x++) put(x, footRow - 1, 'a');
      put(9, footRow, 'a');
    } else if (wear === 'bowtie' && footRow > 0) {
      put(4, footRow - 1, 'a'); put(5, footRow - 1, 'k'); put(6, footRow - 1, 'k'); put(7, footRow - 1, 'a');
    } else if (wear === 'glasses' && eyeRow > 0) {
      for (const x of [2, 4, 5, 6, 7, 9]) if (rows[eyeRow][x] !== 'k') put(x, eyeRow, 'k');
    } else if (wear === 'beanie' && headTop > 0) {
      for (let x = 2; x <= 9; x++) { put(x, headTop - 1, 'a', true); put(x, headTop, 'a', true); }
      put(5, headTop - 2, 'a', true); put(6, headTop - 2, 'a', true);
    } else if (wear === 'crown' && headTop > 0) {
      for (let x = 3; x <= 8; x++) put(x, headTop - 1, 'g', true);
      for (const x of [3, 5, 6, 8]) put(x, headTop - 2, 'g', true);
    }
    return cells;
  }

  // tokens: output of BurrowTheme.build (uses fg, accent, muted, mochiBody, mochiInner, mochiInk)
  // opts.look: 'left' | 'right' — Mochi glances that way (eyes move one pixel).
  // Mochi.wear: the outfit to draw (set by each page from your settings).
  function svg(tokens, pose, size, opts = {}) {
    let rows = POSES[pose] || POSES.idle;
    const ink = tokens.mochiInk || tokens.fg;
    const col = { b: tokens.mochiBody, i: tokens.mochiInner, k: ink, c: tokens.accent, s: tokens.muted, z: tokens.muted || ink, a: tokens.accent, g: '#E8B021' };
    if (opts.look === 'left' || opts.look === 'right') {
      const { eyeRow } = anchors(rows);
      const d = opts.look === 'left' ? -1 : 1;
      if (eyeRow > 0) {
        const r = [...rows[eyeRow]];
        const out = [...r];
        r.forEach((ch, x) => { if (ch === 'k' && r[x + d] === 'b') { out[x] = 'b'; out[x + d] = 'k'; } });
        rows = rows.map((row, i) => (i === eyeRow ? out.join('') : row));
      }
    }
    const wear = OUTFITS[api.wear] ? api.wear : null;
    const extra = wear ? outfitCells(rows, wear) : [];
    let outline = '', fill = '';
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if (ch === '.') return;
      if (ch !== 'z') outline += `<rect x="${x}" y="${y}" width="3" height="3"/>`;
      fill += `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${col[ch]}"/>`;
    }));
    for (const c of extra) {
      if (c.hat) outline += `<rect x="${c.x}" y="${c.y}" width="3" height="3"/>`;
      fill += `<rect x="${c.x + 1}" y="${c.y + 1}" width="1" height="1" fill="${col[c.c]}"/>`;
    }
    const px = size || 48;
    return `<svg class="mochi-svg" data-pose="${pose in POSES ? pose : 'idle'}"${wear ? ` data-outfit="${wear}"` : ''}${opts.look ? ` data-look="${opts.look}"` : ''} width="${px}" height="${Math.round(px * HEIGHT / WIDTH)}" ` +
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

  const api = { POSES, OUTFITS, svg, play, wear: null };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mochi = api;
})(typeof window !== 'undefined' ? window : globalThis);
