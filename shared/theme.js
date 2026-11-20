// Burrow theme engine.
// Turns ONE seed colour + light/dark into every colour token the browser uses.
// Shared by the main process (title bar colours) and every Burrow page (CSS variables).
(function (root) {
  const PRESETS = [
    { name: 'Signal red', hex: '#E63027' },
    { name: 'Tomato', hex: '#D9502E' },
    { name: 'Klein', hex: '#1F3FD1' },
    { name: 'Matcha', hex: '#6E9A4A' },
    { name: 'Plum', hex: '#8A3FA8' },
    { name: 'Teal', hex: '#138A82' },
    { name: 'Amber', hex: '#E0A100' },
    { name: 'Graphite', hex: '#555555' },
  ];
  const DEFAULT_SEED = PRESETS[0].hex;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function hexToHsl(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return hexToHsl(DEFAULT_SEED);
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }

  function hslToHex(h, s, l) {
    s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
    return ('#' + to(f(0)) + to(f(8)) + to(f(4))).toUpperCase();
  }

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  // Nudge a colour's lightness until it reaches a contrast ratio against bg.
  function ensureContrast(h, s, l, bg, ratio, dark) {
    let hex = hslToHex(h, s, l);
    for (let i = 0; i < 60 && contrast(hex, bg) < ratio; i++) {
      l += dark ? 1.5 : -1.5;
      hex = hslToHex(h, s, l);
    }
    return hex;
  }

  function normaliseHex(hex) {
    const m = /^#?([0-9a-f]{6})/i.exec(String(hex || '').trim());
    return m ? '#' + m[1].toUpperCase() : DEFAULT_SEED;
  }

  // Build all tokens. Every text-like token is checked for readable contrast.
  // look: 'soft' (Soft paper, the default since 0.3.0) or 'classic' (the original high-contrast look).
  function build(seedHex, dark, look) {
    const seed = normaliseHex(seedHex);
    const [h, s, l] = hexToHsl(seed);
    const soft = look !== 'classic';
    const t = { seed, dark: !!dark, look: soft ? 'soft' : 'classic' };
    // Soft paper: warm grey paper and ink (hue 30, barely tinted by your colour), hairlines, a softer accent.
    const PH = 30;
    if (soft && !dark) {
      t.bg = hslToHex(PH, 18, 96);
      t.fg = hslToHex(PH, 8, 22);
      t.surface = hslToHex(PH, 30, 99);
      t.line = hslToHex(PH, 12, 87);
      t.muted = ensureContrast(PH, 6, 44, t.bg, 4.6, false);
      t.accent = hslToHex(h, s * 0.85, clamp(l, 40, 62));
      t.accentInk = ensureContrast(h, s * 0.85, clamp(l, 40, 62), t.bg, 4.6, false);
      t.hover = hslToHex(PH, 14, 92);
      t.tint = hslToHex(h, Math.min(s, 70), 94);
      t.accentInk = ensureContrast(...hexToHsl(t.accentInk), t.tint, 4.6, false); // readable on the tint too
      t.mochiBody = '#FFFFFF';
      t.mochiInner = hslToHex(h, 70, 84);
    } else if (soft) {
      t.bg = hslToHex(PH, 6, 13);
      t.fg = hslToHex(PH, 10, 88);
      t.surface = hslToHex(PH, 6, 17);
      t.line = hslToHex(PH, 6, 25);
      t.muted = ensureContrast(PH, 6, 62, t.surface, 4.6, true);
      t.accent = hslToHex(h, Math.min(Math.max(s, 50), 75), Math.max(l, 64));
      t.hover = hslToHex(PH, 6, 19);
      t.tint = hslToHex(h, Math.min(s, 28), 20);
      t.accentInk = ensureContrast(h, Math.min(Math.max(s, 50), 75), Math.max(l, 64), t.tint, 4.6, true);
      t.mochiBody = t.fg;
      t.mochiInner = hslToHex(h, 60, 78);
    } else if (!dark) {
      t.bg = hslToHex(h, Math.min(s, 30), 95);
      t.fg = hslToHex(h, Math.min(s, 25), 9);
      t.surface = hslToHex(h, Math.min(s, 30), 99);
      t.line = hslToHex(h, Math.min(s, 20), 84);
      t.muted = ensureContrast(h, 8, 40, t.bg, 4.6, false);
      t.accent = seed;
      t.accentInk = ensureContrast(h, s, l, t.bg, 4.6, false); // accent used as text: AA for small text
      t.hover = hslToHex(h, Math.min(s, 25), 90);
      t.mochiBody = '#FFFFFF';
      t.mochiInner = hslToHex(h, 70, 84);
    } else {
      t.bg = hslToHex(h, 10, 7);
      t.fg = hslToHex(h, 12, 94);
      t.surface = hslToHex(h, 10, 11);
      t.line = hslToHex(h, 8, 19);
      // (Checked against the lighter card surface, so it's readable on the page and on cards.)
      t.muted = ensureContrast(h, 6, 64, t.surface, 4.6, true);
      t.accent = hslToHex(h, Math.max(s, 60), Math.max(l, 62));
      t.accentInk = ensureContrast(h, Math.max(s, 60), Math.max(l, 62), t.surface, 4.6, true);
      t.hover = hslToHex(h, 10, 13);
      t.mochiBody = t.fg;
      t.mochiInner = hslToHex(h, 60, 78);
    }
    if (!t.tint) t.tint = t.hover; // (Classic shows selection as an inverted block instead)
    else {
      // Soft paper: muted and accent text must also read on a hovered or selected (tinted) row.
      const backs = [t.bg, t.surface, t.hover, t.tint].sort((a, b) => luminance(a) - luminance(b));
      const worst = dark ? backs[backs.length - 1] : backs[0];
      t.muted = ensureContrast(...hexToHsl(t.muted), worst, 4.6, !!dark);
      t.accentInk = ensureContrast(...hexToHsl(t.accentInk), worst, 4.6, !!dark);
    }
    // Status colours, separate from the brand accent: readable as text on the page, cards and hover.
    // Checked against the closest background (the darkest one in light mode, the lightest in dark mode).
    const near = dark ? [t.surface, t.hover, t.tint].sort((a, b) => luminance(b) - luminance(a))[0]
      : [t.bg, t.hover].sort((a, b) => luminance(a) - luminance(b))[0];
    const STATUS = { danger: [4, 70], warning: [32, 85], success: [142, 55], info: [212, 70] };
    for (const k in STATUS) {
      const [sh, ss] = STATUS[k];
      t[k] = ensureContrast(sh, ss, dark ? 66 : 42, near, 4.6, dark);
    }
    // Mochi's eyes + outline are always dark ink, so the face reads in both modes.
    t.mochiInk = hslToHex(h, Math.min(s, 25), 9);
    // Text on the accent colour (buttons, chips): white or near-black, whichever reads better — and if
    // neither reaches 4.5:1, the accent is nudged darker (or lighter) just enough. (Signal red and Klein
    // used to sit at 4.4:1.)
    const best = (bgHex) => Math.max(contrast('#FFFFFF', bgHex), contrast('#111111', bgHex));
    if (best(t.accent) < 4.5) {
      const [ah, as, al] = hexToHsl(t.accent);
      const whiteWins = contrast('#FFFFFF', t.accent) >= contrast('#111111', t.accent);
      let ll = al;
      let hex = t.accent;
      for (let i = 0; i < 60 && best(hex) < 4.5; i++) { ll += whiteWins ? -0.5 : 0.5; hex = hslToHex(ah, as, ll); }
      t.accent = hex;
    }
    t.onAccent = contrast('#FFFFFF', t.accent) >= contrast('#111111', t.accent) ? '#FFFFFF' : '#111111';
    return t;
  }

  const CSS_NAMES = {
    bg: '--bg', fg: '--fg', surface: '--surface', line: '--line', muted: '--muted',
    accent: '--accent', accentInk: '--accent-ink', onAccent: '--on-accent', hover: '--hover',
    mochiBody: '--mochi-body', mochiInner: '--mochi-inner', tint: '--tint',
    danger: '--danger', warning: '--warning', success: '--success', info: '--info',
  };

  function apply(tokens, el) {
    el = el || document.documentElement;
    for (const k in CSS_NAMES) if (tokens[k]) el.style.setProperty(CSS_NAMES[k], tokens[k]);
    // The look (Soft paper / Classic) and density switch whole sets of CSS variables in base.css.
    el.dataset.look = tokens.look === 'classic' ? 'classic' : 'soft';
    el.dataset.density = tokens.density === 'compact' ? 'compact' : 'comfortable';
    el.dataset.mode = tokens.dark ? 'dark' : 'light';
    el.style.colorScheme = tokens.dark ? 'dark' : 'light';
  }

  const api = { PRESETS, DEFAULT_SEED, build, apply, contrast, normaliseHex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BurrowTheme = api;
})(typeof window !== 'undefined' ? window : globalThis);
