// Draws Burrow's app icon — Mochi's pixel face on a Signal-red square — from Mochi's own sprite, and
// writes build/icon.ico (16–256 px, for Windows and the installer) and build/icon.png / ui/icon.png.
// Every size is an exact multiple of the 16-pixel design, so it stays crisp.   Run: node scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { POSES } = require('../shared/mochi');

const ROOT = path.join(__dirname, '..');
const RED = [0xE6, 0x30, 0x27], INK = [0x1D, 0x14, 0x15], BODY = [0xFF, 0xFF, 0xFF], INNER = [0xF2, 0xA6, 0xA0], GREY = [0x9A, 0x8F, 0x8E];

// The 16x16 design: red square, Mochi's head (the idle pose without its feet), outlined in ink.
function design() {
  const g = Array.from({ length: 16 }, () => Array(16).fill(RED));
  const rows = POSES.idle.slice(0, 9);
  const col = { b: BODY, i: INNER, k: INK, c: RED, s: GREY };
  const ox = 2, oy = 4;
  const cells = [];
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') cells.push([ox + x, oy + y, col[ch]]); }));
  for (const [x, y] of cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx >= 0 && xx < 16 && yy >= 0 && yy < 16) g[yy][xx] = INK;
  }
  for (const [x, y, c] of cells) g[y][x] = c;
  return g;
}

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(grid, size) {
  const scale = size / 16;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const [r, g, b] = grid[Math.floor(y / scale)][Math.floor(x / scale)];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// .ico with PNG images inside (Windows Vista and later).
function ico(images) {
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size; dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([head, dir, ...images.map((im) => im.data)]);
}

const grid = design();
const sizes = [16, 32, 48, 64, 128, 256];
const images = sizes.map((size) => ({ size, data: png(grid, size) }));
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico(images));
fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), images[images.length - 1].data);
fs.writeFileSync(path.join(ROOT, 'ui', 'icon.png'), images[images.length - 1].data);
console.log('icon written:', sizes.join(', '), 'px');
