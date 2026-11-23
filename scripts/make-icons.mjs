// Generates every app icon from one vector definition.
//   node scripts/make-icons.mjs [preview-dir]
// Writes assets/icon.png and the three Android adaptive-icon layers. With a
// preview dir it also writes what launchers will show (circle and squircle masks).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;
const BG = '#0B0D12';

// The mark: a rounded "F" with a spark beside it, drawn around the canvas centre.
// `ink` = null uses the brand colours; a colour draws a flat single-tone version.
function mark(scale, ink = null) {
  // Four-point spark: curves pulled most of the way to the centre, but not all, so it keeps some body.
  const star = (cx, cy, r) => {
    const k = r * 0.16;
    return `M${cx},${cy - r} Q${cx + k},${cy - k} ${cx + r},${cy} Q${cx + k},${cy + k} ${cx},${cy + r} Q${cx - k},${cy + k} ${cx - r},${cy} Q${cx - k},${cy - k} ${cx},${cy - r} Z`;
  };
  const stroke = ink ?? 'url(#f)';
  const spark = ink ?? '#5EEAD4';
  return `
  <g transform="translate(512 512) scale(${scale}) translate(-555 -512)">
    <g fill="none" stroke="${stroke}" stroke-width="104" stroke-linecap="round" stroke-linejoin="round">
      <!-- One path: a lone horizontal segment has an empty bounding box, which a gradient stroke cannot paint. -->
      <path d="M410,724 L410,300 L650,300 M410,500 L590,500"/>
    </g>
    <path d="${star(668, 690, 92)}" fill="${spark}"/>
  </g>`;
}

const defs = `
  <defs>
    <linearGradient id="f" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#C2B8FF"/>
      <stop offset="1" stop-color="#7A69FF"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.45" r="0.6">
      <stop offset="0" stop-color="#8B7CFF" stop-opacity="0.30"/>
      <stop offset="0.6" stop-color="#8B7CFF" stop-opacity="0.07"/>
      <stop offset="1" stop-color="#8B7CFF" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${defs}${body}</svg>`;
const backdrop = `<rect width="${SIZE}" height="${SIZE}" fill="${BG}"/><rect width="${SIZE}" height="${SIZE}" fill="url(#glow)"/>`;

// Android crops adaptive icons to the centre ~61%, so the layers use a smaller mark.
const ADAPTIVE_SCALE = 0.76;
const layers = {
  'icon.png': svg(backdrop + mark(1.2)),
  'android-icon-background.png': svg(backdrop),
  'android-icon-foreground.png': svg(mark(ADAPTIVE_SCALE)),
  'android-icon-monochrome.png': svg(mark(ADAPTIVE_SCALE, '#FFFFFF')),
};

const png = (source) => sharp(Buffer.from(source)).png().toBuffer();

for (const [name, source] of Object.entries(layers)) {
  fs.writeFileSync(path.join(root, 'assets', name), await png(source));
  console.log('wrote assets/' + name);
}

const previewDir = process.argv[2];
if (previewDir) {
  fs.mkdirSync(previewDir, { recursive: true });
  // What a launcher shows: background + foreground, zoomed to the visible 2/3, then masked.
  const full = svg(backdrop + mark(ADAPTIVE_SCALE));
  const visible = Math.round(SIZE * (72 / 108));
  const offset = Math.round((SIZE - visible) / 2);
  const cropped = await sharp(await png(full)).extract({ left: offset, top: offset, width: visible, height: visible }).resize(512, 512).png().toBuffer();
  const masks = {
    circle: '<circle cx="256" cy="256" r="256"/>',
    squircle: '<rect width="512" height="512" rx="150"/>',
  };
  for (const [shape, el] of Object.entries(masks)) {
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${el}</svg>`);
    await sharp(cropped).composite([{ input: mask, blend: 'dest-in' }]).png().toFile(path.join(previewDir, `preview-${shape}.png`));
  }
  await sharp(await png(layers['android-icon-monochrome.png'])).flatten({ background: '#3a3f55' }).resize(256, 256).png().toFile(path.join(previewDir, 'preview-mono.png'));
  // One sheet to look at: both masks and the legacy icon side by side on a mid-grey desk.
  await sharp({ create: { width: 1160, height: 420, channels: 4, background: '#30343f' } })
    .composite([
      { input: await sharp(path.join(previewDir, 'preview-circle.png')).resize(340, 340).toBuffer(), left: 40, top: 40 },
      { input: await sharp(path.join(previewDir, 'preview-squircle.png')).resize(340, 340).toBuffer(), left: 410, top: 40 },
      { input: await sharp(await png(layers['icon.png'])).resize(340, 340).toBuffer(), left: 780, top: 40 },
    ])
    .png()
    .toFile(path.join(previewDir, 'preview-sheet.png'));
  console.log('wrote previews to ' + previewDir);
}
