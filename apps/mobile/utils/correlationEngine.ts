/**
 * utils/correlationEngine.ts
 *
 * Rolling 20-day Pearson correlation matrix computation.
 * Runs entirely on the client from daily close prices.
 */

/** Compute daily log returns from a price series. */
export function logReturns(prices: number[]): number[] {
  if (prices.length < 2) return [];
  return prices.slice(1).map((p, i) => Math.log(p / prices[i]));
}

/** Pearson correlation between two equal-length arrays. */
export function pearsonR(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, denomA = 0, denomB = 0;
  for (let i = 0; i < n; i++) {
    const dA = a[i] - meanA;
    const dB = b[i] - meanB;
    num    += dA * dB;
    denomA += dA * dA;
    denomB += dB * dB;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom === 0 ? NaN : num / denom;
}

export interface CorrelationMatrix {
  tickers: string[];
  matrix:  number[][];     // matrix[i][j] = Pearson R between tickers[i] and tickers[j]
  computed_at: number;
}

/**
 * Build a full NxN correlation matrix from a map of ticker → daily close prices.
 * Uses the last `window` prices for the rolling window.
 */
export function buildCorrelationMatrix(
  priceMap: Record<string, number[]>,
  window:   number = 20,
): CorrelationMatrix {
  const tickers = Object.keys(priceMap);
  const returns = Object.fromEntries(
    tickers.map((t) => [t, logReturns(priceMap[t].slice(-window - 1))]),
  );

  const n = tickers.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(NaN));

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1.0;
    for (let j = i + 1; j < n; j++) {
      const r = pearsonR(returns[tickers[i]], returns[tickers[j]]);
      matrix[i][j] = Math.round(r * 100) / 100;
      matrix[j][i] = matrix[i][j];
    }
  }

  return { tickers, matrix, computed_at: Date.now() };
}

/**
 * Detect correlation breakdowns: pairs whose |correlation| drops by > 0.3
 * compared to a prior matrix (regime change signal).
 */
export function detectCorrelationBreakdowns(
  current: CorrelationMatrix,
  prior:   CorrelationMatrix,
  threshold: number = 0.3,
): Array<{ tickers: [string, string]; delta: number; current_r: number; prior_r: number }> {
  const breakdowns: Array<{ tickers: [string, string]; delta: number; current_r: number; prior_r: number }> = [];

  for (let i = 0; i < current.tickers.length; i++) {
    for (let j = i + 1; j < current.tickers.length; j++) {
      const tA = current.tickers[i];
      const tB = current.tickers[j];
      const pi = prior.tickers.indexOf(tA);
      const pj = prior.tickers.indexOf(tB);
      if (pi < 0 || pj < 0) continue;

      const currR  = current.matrix[i][j];
      const priorR = prior.matrix[pi][pj];
      if (isNaN(currR) || isNaN(priorR)) continue;

      const delta = Math.abs(currR) - Math.abs(priorR);
      if (Math.abs(delta) >= threshold) {
        breakdowns.push({ tickers: [tA, tB], delta: Math.round(delta * 100) / 100, current_r: currR, prior_r: priorR });
      }
    }
  }

  return breakdowns.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/** Correlation → heatmap color (red=negative, green=positive, white=zero). */
export function correlationColor(r: number): string {
  if (isNaN(r)) return '#1e293b';
  const abs = Math.abs(r);
  const intensity = Math.round(abs * 255);
  if (r >= 0) {
    const g = intensity;
    const rb = 255 - intensity;
    return `rgb(${rb}, ${g}, ${rb})`;
  } else {
    const red = intensity;
    const gb  = 255 - intensity;
    return `rgb(${red}, ${gb}, ${gb})`;
  }
}
