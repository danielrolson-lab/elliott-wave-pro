/**
 * chartTypes.ts
 *
 * Shared constants, colors, and types for the Skia candlestick chart.
 */

export const CHART_COLORS = {
  // Canvas background — OLED black for battery savings on AMOLED
  background: '#000000',

  // Grid
  gridLine: '#1E2530',

  // Text
  textPrimary: '#C9D1D9',
  textMuted: '#6E7681',

  // Candles
  bullBody: '#26A69A',
  bearBody: '#EF5350',
  bullWick: '#26A69A',
  bearWick: '#EF5350',

  // Volume
  volumeBull: 'rgba(38,166,154,0.45)',
  volumeBear: 'rgba(239,83,80,0.45)',

  // Crosshair
  crosshair: 'rgba(180,180,180,0.7)',
  crosshairBg: '#1E2530',
  crosshairText: '#C9D1D9',

  // Moving averages
  ema9:   '#F7E422',
  ema21:  '#FF9800',
  ema50:  '#2196F3',
  ema200: '#9C27B0',

  // TimeframeSelector
  tfActiveBg:   '#1D6FE8',
  tfInactiveBg: '#161B22',
  tfBorder:     '#30363D',
  tfActiveText: '#FFFFFF',
  tfText:       '#8B949E',
} as const;

export const CHART_LAYOUT = {
  priceAxisWidth:  62,
  timeAxisHeight:  24,
  paddingTop:      12,
  volumeRatio:     0.18,   // volume pane = 18% of total canvas height
  candleGapRatio:  0.15,   // gap = candleWidth * this
  candleDefaultW:  5,
  candleMinW:      1.5,   // ~230 candles visible at max zoom-out
  candleMaxW:      40,
  gridLineCount:   6,
} as const;

export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W'] as const;
export type TimeframeOption = (typeof TIMEFRAMES)[number];

// Shared layout state computed on the UI thread inside CandlestickChart
export interface ChartLayoutParams {
  startIdx: number;
  endIdx:   number;
  minP:     number;
  maxP:     number;
  maxVol:   number;
  tx:       number;
  cw:       number;
  n:        number;
}
