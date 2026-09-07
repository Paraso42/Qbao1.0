// Qbao 品牌图标生成器：SVG 母版 → Android mipmap / adaptive / iOS AppIcon
// 用法：node mobile/scripts/make-icons.mjs（sharp 来自仓库根 node_modules）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = path.join(ROOT, 'icon');
const svg = (name) => fs.readFileSync(path.join(iconDir, name));

const ANDROID_SIZES = { 'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192 };
const FOREGROUND_SIZES = { 'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432 };

// Q 字形（无背景）母版：内容缩至 62% 居中，落在 adaptive 安全区内
const Q_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <g transform="translate(512,512) scale(0.62) translate(-512,-512)" fill="none" stroke="#ffffff" stroke-width="150" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="452" cy="428" r="206"/>
    <path d="M598 592 L712 748"/>
  </g>
</svg>
`;

async function rasterize(svgBuf, size, opts = {}) {
  let s = sharp(svgBuf).resize(size, size, { fit: 'fill' });
  if (opts.flatten) s = s.flatten({ background: opts.flatten });
  return s.png().toBuffer();
}

let wrote = 0;
const resDir = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const andSvg = svg('icon-android.svg');
const andFgSvg = svg('icon-android-fg.svg');
for (const [dpi, px] of Object.entries(ANDROID_SIZES)) {
  const buf = await rasterize(andSvg, px, { flatten: '#4D6BFE' });
  await sharp(buf).toFile(path.join(resDir, 'mipmap-' + dpi, 'ic_launcher.png'));
  await sharp(buf).toFile(path.join(resDir, 'mipmap-' + dpi, 'ic_launcher_round.png'));
  await sharp(buf).toFile(path.join(resDir, 'mipmap-' + dpi, 'ic_launcher_foreground.png'));
  wrote += 3;
}
for (const [dpi, px] of Object.entries(FOREGROUND_SIZES)) {
  const buf = await rasterize(andFgSvg, px, { flatten: '#4D6BFE' });
  await sharp(buf).toFile(path.join(resDir, 'mipmap-' + dpi, 'ic_launcher_foreground.png'));
  wrote += 1;
}
const bgXml = path.join(resDir, 'values', 'ic_launcher_background.xml');
let bg = '#4D6BFE';
if (fs.existsSync(bgXml)) {
  const t = fs.readFileSync(bgXml, 'utf8');
  const m = t.match(/#[0-9a-fA-F]{6,8}/);
  if (m) bg = m[0];
}
fs.writeFileSync(bgXml, '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">' + bg + '</color></resources>\n');
wrote += 1;

const iosSet = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
const icon1024 = await rasterize(svg('icon-ios.svg'), 1024, { flatten: '#4D6BFE' });
await sharp(icon1024).toFile(path.join(iosSet, 'AppIcon-512@2x.png'));
wrote += 1;

console.log('icons generated: ' + wrote + ' files');