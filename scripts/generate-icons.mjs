// Generates PNG app icons from public/icon.svg for the PWA manifest + iOS.
// Run: node scripts/generate-icons.mjs
import sharp from 'sharp';
import { readFileSync } from 'fs';

const svg = readFileSync('public/icon.svg', 'utf-8');

// Maskable variant: full-bleed gradient, glyph shrunk into the 80% safe zone
// so Android's circle/squircle masks don't clip it.
const maskable = svg
  .replace('rx="112"', 'rx="0"')
  .replace('<g fill="none"', '<g transform="translate(256 256) scale(0.72) translate(-256 -256)" fill="none"');

const jobs = [
  { src: svg, size: 192, out: 'public/icon-192.png' },
  { src: svg, size: 512, out: 'public/icon-512.png' },
  { src: maskable, size: 512, out: 'public/icon-maskable-512.png' },
  // iOS ignores transparency and applies its own corner mask, so use full-bleed
  { src: maskable, size: 180, out: 'public/apple-touch-icon.png' },
];

for (const { src, size, out } of jobs) {
  await sharp(Buffer.from(src), { density: 384 }).resize(size, size).png().toFile(out);
  console.log(`wrote ${out}`);
}
