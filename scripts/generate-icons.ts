/**
 * Elliott Wave Pro — Icon Generator (v2, SVG + sharp)
 *
 * Replaces the old Jimp/Bresenham approach with SVG path data rasterised by
 * sharp. This gives fully anti-aliased, vector-quality output at any resolution.
 *
 * Output:
 *   apps/mobile/assets/icon.png                    1024×1024  iOS App Icon
 *   apps/mobile/assets/splash-icon.png             2048×2048  Expo Splash (hi-res)
 *   apps/mobile/assets/android-icon-foreground.png 1024×1024  Adaptive foreground
 *   apps/mobile/assets/notification-icon.png         96×96    Android notification
 *   apps/mobile/assets/favicon.png                   32×32    Web favicon
 *
 * Run: pnpm tsx scripts/generate-icons.ts
 */

import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';

const ASSETS = path.resolve(__dirname, '../apps/mobile/assets');
fs.mkdirSync(ASSETS, { recursive: true });

// ─── SVG builders ─────────────────────────────────────────────────────────────

/**
 * 5-wave Elliott Wave impulse as a polyline.
 * Waypoints are expressed as fractions of the canvas size so the pattern
 * scales perfectly at every output resolution.
 */
function wavePolyline(size: number): string {
  const s = size;
  const marginX = s * 0.10;
  const top     = s * 0.10;
  const base    = s * 0.60;

  // [xFrac, yFrac] relative to size — matches the original Jimp layout
  const pts: [number, number][] = [
    [marginX,           base],                // wave start (low)
    [marginX + s*0.14,  top  + s*0.28],       // wave 1 high
    [marginX + s*0.22,  top  + s*0.42],       // wave 2 low
    [marginX + s*0.40,  top  + s*0.04],       // wave 3 high  (tallest)
    [marginX + s*0.50,  top  + s*0.20],       // wave 4 low
    [s - marginX,       top  + s*0.10],        // wave 5 high
  ];

  const pointsAttr = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const strokeW    = (s * 0.030).toFixed(2);  // 3% of canvas — bold and readable

  return `<polyline
    points="${pointsAttr}"
    stroke="white"
    stroke-width="${strokeW}"
    stroke-linecap="round"
    stroke-linejoin="round"
    fill="none"
  />`;
}

/**
 * Optional wave count dots at each pivot — adds pro-chart authenticity.
 */
function waveDots(size: number): string {
  const s = size;
  const marginX = s * 0.10;
  const top     = s * 0.10;
  const base    = s * 0.60;
  const r       = (s * 0.018).toFixed(2);

  const pivots: [number, number, string][] = [
    [marginX,           base,               '0'],
    [marginX + s*0.14,  top  + s*0.28,      '1'],
    [marginX + s*0.22,  top  + s*0.42,      '2'],
    [marginX + s*0.40,  top  + s*0.04,      '3'],
    [marginX + s*0.50,  top  + s*0.20,      '4'],
    [s - marginX,       top  + s*0.10,       '5'],
  ];

  return pivots.map(([x, y]) =>
    `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="white" opacity="0.85"/>`
  ).join('\n  ');
}

/**
 * "EW" wordmark below the wave.
 * Uses a condensed sans-serif stack — renders cleanly at 1024+ px.
 * Letter-spacing and weight tuned for the trading/finance aesthetic.
 */
function ewLabel(size: number): string {
  const cx      = (size / 2).toFixed(2);
  const y       = (size * 0.785).toFixed(2);
  const fs      = (size * 0.115).toFixed(2);
  const spacing = (size * 0.06).toFixed(2);

  return `<text
    x="${cx}"
    y="${y}"
    text-anchor="middle"
    dominant-baseline="alphabetic"
    font-family="'Helvetica Neue', 'Arial', 'SF Pro Display', 'Inter', sans-serif"
    font-weight="800"
    font-size="${fs}"
    letter-spacing="${spacing}"
    fill="white"
    opacity="0.92"
  >EW</text>`;
}

/**
 * Thin horizontal rule between wave and label — adds polish.
 */
function divider(size: number): string {
  const y  = (size * 0.695).toFixed(2);
  const x1 = (size * 0.30).toFixed(2);
  const x2 = (size * 0.70).toFixed(2);
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"
    stroke="white" stroke-width="${(size * 0.006).toFixed(2)}" opacity="0.25"/>`;
}

/**
 * Builds the full SVG for a given size and variant.
 */
function buildSVG(opts: {
  size:        number;
  showLabel:   boolean;
  showDots:    boolean;
  transparent: boolean;
}): string {
  const { size, showLabel, showDots, transparent } = opts;

  const bg = transparent
    ? ''
    : `<rect width="${size}" height="${size}" fill="#000000"/>`;

  // Notification icon: tighter wave with more vertical room
  const wave = transparent
    ? `<polyline
        points="${[
          [size*0.10, size*0.75],
          [size*0.28, size*0.30],
          [size*0.40, size*0.52],
          [size*0.60, size*0.15],
          [size*0.72, size*0.38],
          [size*0.90, size*0.24],
        ].map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}"
        stroke="white"
        stroke-width="${(size * 0.080).toFixed(1)}"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      />`
    : wavePolyline(size);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
     xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision"
     text-rendering="optimizeLegibility">
  ${bg}
  ${wave}
  ${showDots && !transparent ? waveDots(size) : ''}
  ${showLabel && !transparent ? divider(size) : ''}
  ${showLabel && !transparent ? ewLabel(size) : ''}
</svg>`;
}

// ─── Rasteriser ──────────────────────────────────────────────────────────────

async function render(svg: string, outPath: string): Promise<void> {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outPath);
}

// ─── Generate all assets ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Generating Elliott Wave Pro icon assets (SVG → sharp)…\n');

  // 1. Main app icon — 1024×1024
  const iconPath = path.join(ASSETS, 'icon.png');
  console.log('  icon.png (1024×1024)…');
  await render(buildSVG({ size: 1024, showLabel: true, showDots: true, transparent: false }), iconPath);

  // 2. Splash screen — 2048×2048 (3× screens need headroom)
  const splashPath = path.join(ASSETS, 'splash-icon.png');
  console.log('  splash-icon.png (2048×2048)…');
  await render(buildSVG({ size: 2048, showLabel: true, showDots: true, transparent: false }), splashPath);

  // 3. Android adaptive icon foreground — 1024×1024
  const androidPath = path.join(ASSETS, 'android-icon-foreground.png');
  console.log('  android-icon-foreground.png (1024×1024)…');
  await render(buildSVG({ size: 1024, showLabel: true, showDots: true, transparent: false }), androidPath);

  // 4. Notification icon — 96×96 white wave on transparent
  const notifPath = path.join(ASSETS, 'notification-icon.png');
  console.log('  notification-icon.png (96×96)…');
  await render(buildSVG({ size: 96, showLabel: false, showDots: false, transparent: true }), notifPath);

  // 5. Favicon — 32×32
  const favPath = path.join(ASSETS, 'favicon.png');
  console.log('  favicon.png (32×32)…');
  await render(buildSVG({ size: 32, showLabel: false, showDots: false, transparent: false }), favPath);

  console.log('\nAll assets generated successfully.');
  console.log(`Output: ${ASSETS}`);
}

main().catch((err: unknown) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
