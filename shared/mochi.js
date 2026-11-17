// Mochi, Burrow's pixel companion.
// Sprites are tiny text grids; each letter is a colour role. Drawn as crisp SVG.
//   b = body   i = inner ear   k = eye/mouth (ink)   c = cheek (accent)   s = feet/shadow
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
  };

  // tokens: output of BurrowTheme.build (uses fg, accent, muted, mochiBody, mochiInner)
  function svg(tokens, pose, size) {
    const rows = POSES[pose] || POSES.idle;
    const w = Math.max(...rows.map((r) => r.length)) + 2;
    const h = rows.length + 2;
    const ink = tokens.mochiInk || tokens.fg;
    const col = { b: tokens.mochiBody, i: tokens.mochiInner, k: ink, c: tokens.accent, s: tokens.muted };
    let outline = '', fill = '';
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if (ch === '.') return;
      outline += `<rect x="${x}" y="${y}" width="3" height="3"/>`;
      fill += `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${col[ch]}"/>`;
    }));
    const px = size || 48;
    return `<svg class="mochi-svg" width="${px}" height="${Math.round(px * h / w)}" viewBox="0 0 ${w} ${h}" ` +
      `shape-rendering="crispEdges" aria-hidden="true"><g fill="${ink}">${outline}</g>${fill}</svg>`;
  }

  const api = { POSES, svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mochi = api;
})(typeof window !== 'undefined' ? window : globalThis);
