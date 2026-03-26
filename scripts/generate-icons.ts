/**
 * Elliott Wave Pro — Icon Generator
 * Generates all app icon assets programmatically using jimp.
 *
 * Output:
 *   apps/mobile/assets/icon.png               1024×1024  iOS App Icon
 *   apps/mobile/assets/splash-icon.png         512× 512  Expo Splash
 *   apps/mobile/assets/android-icon-foreground.png 1024×1024 Adaptive foreground
 *   apps/mobile/assets/notification-icon.png   96×  96  Android notification
 *   apps/mobile/assets/favicon.png             32×  32  Web favicon
 *
 * Run: pnpm tsx scripts/generate-icons.ts
 */

import Jimp from 'jimp';
import * as path from 'path';
import * as fs from 'fs';

const ASSETS = path.resolve(__dirname, '../apps/mobile/assets');
fs.mkdirSync(ASSETS, { recursive: true });

// ─── Colour palette ───────────────────────────────────────────────────────────
const BLACK       = 0x000000ff;
const WHITE       = 0xffffffff;
const TRANSPARENT = 0x00000000;
const WAVE_COLOR  = WHITE;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Draw a thick anti-aliased line using Bresenham + radial brush. */
function drawLine(
  img: Jimp,
  x0: number, y0: number,
  x1: number, y1: number,
  color: number,
  thickness: number,
): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = Math.round(x0);
  let cy = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const r = Math.ceil(thickness / 2);

  const w = img.getWidth();
  const h = img.getHeight();

  while (true) {
    // Paint a filled circle at (cx, cy)
    for (let py = -r; py <= r; py++) {
      for (let px = -r; px <= r; px++) {
        if (px * px + py * py <= r * r) {
          const nx = cx + px;
          const ny = cy + py;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            img.setPixelColor(color, nx, ny);
          }
        }
      }
    }
    if (cx === ex && cy === ey) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 <  dx) { err += dx; cy += sy; }
  }
}

/** Draw an "E" glyph (block capital, 7-segment style). */
function drawE(img: Jimp, ox: number, oy: number, size: number, color: number): void {
  const w = Math.round(size * 0.55);
  const h = size;
  const t = Math.max(2, Math.round(size * 0.14)); // stroke width

  // Vertical stroke (left)
  drawLine(img, ox, oy, ox, oy + h, color, t);
  // Top horizontal
  drawLine(img, ox, oy, ox + w, oy, color, t);
  // Middle horizontal
  drawLine(img, ox, oy + Math.round(h * 0.5), ox + Math.round(w * 0.8), oy + Math.round(h * 0.5), color, t);
  // Bottom horizontal
  drawLine(img, ox, oy + h, ox + w, oy + h, color, t);
}

/** Draw a "W" glyph. */
function drawW(img: Jimp, ox: number, oy: number, size: number, color: number): void {
  const w  = Math.round(size * 0.75);
  const h  = size;
  const t  = Math.max(2, Math.round(size * 0.14));
  const mx = ox + Math.round(w * 0.5);
  const my = oy + Math.round(h * 0.65);

  // Left stroke down-right to center bottom
  drawLine(img, ox,          oy, ox + Math.round(w * 0.2), oy + h, color, t);
  // Left-center
  drawLine(img, ox + Math.round(w * 0.2), oy + h, mx, my, color, t);
  // Right-center
  drawLine(img, mx, my, ox + Math.round(w * 0.8), oy + h, color, t);
  // Right stroke up
  drawLine(img, ox + Math.round(w * 0.8), oy + h, ox + w, oy, color, t);
}

/** Draw the 5-wave Elliott Wave impulse pattern as a polyline. */
function drawWavePattern(
  img: Jimp,
  canvasW: number,
  canvasH: number,
  color: number,
  thickness: number,
  marginPct: number,   // left/right margin as fraction
  topPct: number,      // topmost point Y as fraction from top
  bottomPct: number,   // baseline Y as fraction from top
): void {
  // 5-wave impulse waypoints as [xPct, yPct] from top-left
  // Wave1: low→high1  Wave2: high1→low2  Wave3: low2→high3  Wave4: high3→low4  Wave5: low4→high5
  const pts: [number, number][] = [
    [marginPct,       bottomPct],       // 0  wave start (low)
    [marginPct + 0.14, topPct + 0.28],  // 1  wave 1 high
    [marginPct + 0.22, topPct + 0.42],  // 2  wave 2 low
    [marginPct + 0.40, topPct + 0.04],  // 3  wave 3 high  (tallest)
    [marginPct + 0.50, topPct + 0.20],  // 4  wave 4 low
    [1 - marginPct,   topPct + 0.10],   // 5  wave 5 high
  ];

  for (let i = 0; i < pts.length - 1; i++) {
    const [x0p, y0p] = pts[i]!;
    const [x1p, y1p] = pts[i + 1]!;
    drawLine(
      img,
      Math.round(x0p * canvasW), Math.round(y0p * canvasH),
      Math.round(x1p * canvasW), Math.round(y1p * canvasH),
      color,
      thickness,
    );
  }
}

// ─── Icon builder ─────────────────────────────────────────────────────────────

async function buildIcon(opts: {
  size: number;
  bgColor: number;
  waveColor: number;
  waveThickness: number;
  showLabel: boolean;
  labelSize: number;
  transparent?: boolean;
}): Promise<Jimp> {
  const { size, bgColor, waveColor, waveThickness, showLabel, labelSize, transparent } = opts;

  const img = new Jimp(size, size, transparent ? TRANSPARENT : bgColor);

  if (!transparent) {
    // Draw wave pattern
    drawWavePattern(
      img,
      size, size,
      waveColor,
      waveThickness,
      0.10,  // left/right margin 10%
      0.10,  // topmost at 10% from top
      0.60,  // baseline at 60% from top
    );

    // Draw "EW" label centered horizontally, below wave
    if (showLabel) {
      const charW = Math.round(labelSize * 0.55);
      const charH = labelSize;
      const gap   = Math.round(labelSize * 0.18);
      const totalW = charW + gap + Math.round(labelSize * 0.75);
      const startX = Math.round((size - totalW) / 2);
      const startY = Math.round(size * 0.68);

      drawE(img, startX, startY, charH, waveColor);
      drawW(img, startX + charW + gap, startY, charH, waveColor);
    }
  } else {
    // Notification icon: white wave on transparent bg
    drawWavePattern(
      img,
      size, size,
      waveColor,
      Math.max(1, Math.round(waveThickness * 0.8)),
      0.10, 0.15, 0.75,
    );
  }

  return img;
}

// ─── Generate all assets ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Generating Elliott Wave Pro icon assets...\n');

  // 1. Main app icon — 1024×1024
  console.log('  icon.png (1024×1024)...');
  const icon = await buildIcon({
    size: 1024, bgColor: BLACK, waveColor: WAVE_COLOR,
    waveThickness: 14, showLabel: true, labelSize: 140,
  });
  await icon.writeAsync(path.join(ASSETS, 'icon.png'));

  // 2. Splash screen icon — 512×512
  console.log('  splash-icon.png (512×512)...');
  const splash = await buildIcon({
    size: 512, bgColor: BLACK, waveColor: WAVE_COLOR,
    waveThickness: 7, showLabel: true, labelSize: 70,
  });
  await splash.writeAsync(path.join(ASSETS, 'splash-icon.png'));

  // 3. Android adaptive icon foreground — 1024×1024 (safe zone is inner 66%)
  console.log('  android-icon-foreground.png (1024×1024)...');
  const androidFg = await buildIcon({
    size: 1024, bgColor: BLACK, waveColor: WAVE_COLOR,
    waveThickness: 13, showLabel: true, labelSize: 130,
  });
  await androidFg.writeAsync(path.join(ASSETS, 'android-icon-foreground.png'));

  // 4. Notification icon — 96×96 white wave on transparent
  console.log('  notification-icon.png (96×96)...');
  const notif = await buildIcon({
    size: 96, bgColor: TRANSPARENT, waveColor: WHITE,
    waveThickness: 2, showLabel: false, labelSize: 0, transparent: true,
  });
  await notif.writeAsync(path.join(ASSETS, 'notification-icon.png'));

  // 5. Favicon — 32×32
  console.log('  favicon.png (32×32)...');
  const fav = await buildIcon({
    size: 32, bgColor: BLACK, waveColor: WAVE_COLOR,
    waveThickness: 1, showLabel: false, labelSize: 0,
  });
  await fav.writeAsync(path.join(ASSETS, 'favicon.png'));

  console.log('\nAll icon assets generated successfully.');
  console.log(`Output directory: ${ASSETS}`);
}

main().catch((err: unknown) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
