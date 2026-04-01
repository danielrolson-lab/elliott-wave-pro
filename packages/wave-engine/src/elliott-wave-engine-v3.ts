/* eslint-disable max-lines */
/**
 * elliott-wave-engine-v3.ts
 *
 * Production-ready multi-hypothesis Elliott Wave engine.
 */

export type Timeframe = string;
export type AssetClass = "equity" | "forex" | "crypto" | "commodity" | "index";
export type Degree =
  | "subminuette"
  | "minuette"
  | "minute"
  | "minor"
  | "intermediate"
  | "primary";
export type PatternType =
  | "impulse"
  | "leading_diagonal"
  | "ending_diagonal"
  | "zigzag"
  | "regular_flat"
  | "expanded_flat";
export type CountStage =
  | "complete"
  | "forming_w3"
  | "forming_w4"
  | "forming_w5"
  | "forming_b"
  | "forming_c";
export type Recommendation =
  | "high_confidence"
  | "tradable_but_caution"
  | "low_confidence"
  | "ambiguous"
  | "invalid";

export interface Pivot {
  id?: string;
  ts: number;
  bar?: number;
  price: number;
  isHigh: boolean;
  volume?: number;
  rsi?: number;
  macdHist?: number;
  atr?: number;
  confirmed?: boolean;
}

export interface CandleLike {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface HardRuleResult {
  passed: boolean;
  violations: string[];
}

export interface InternalStructureResult {
  verified: boolean;
  unverifiable: boolean;
  score: number;
  notes: string[];
}

export interface ScoreBreakdown {
  prior: number;
  structure: number;
  fibonacci: number;
  internalStructure: number;
  volume: number;
  momentum: number;
  time: number;
  channel: number;
  degree: number;
  htfAlignment: number;
  total: number;
  notes: string[];
}

export interface WaveMetrics {
  l1?: number; l2?: number; l3?: number; l4?: number; l5?: number;
  r2?: number; e3?: number; r4?: number; rel5To1?: number; rel5To3?: number;
  time1?: number; time2?: number; time3?: number; time4?: number; time5?: number;
  aLen?: number; bLen?: number; cLen?: number;
  bRetrace?: number; cExtend?: number;
  timeA?: number; timeB?: number; timeC?: number;
}

export interface PatternCandidate {
  id: string;
  ticker: string;
  timeframe: Timeframe;
  assetClass: AssetClass;
  degree: Degree;
  type: PatternType;
  stage: CountStage;
  isBullish: boolean;
  pivots: Pivot[];
  metrics: Partial<WaveMetrics>;
  prior: number;
  hardViolations: string[];
  score: ScoreBreakdown;
  confidence: number;
  preferred: boolean;
  recommendation: Recommendation;
  invalidation?: number;
  targetZone?: [number, number];
  alternateRank?: number;
  summary: string;
}

export interface EngineState {
  preferredCandidateId?: string;
  preferredScore?: number;
  lastSwitchTs?: number;
}

export interface HigherTimeframeBias {
  direction?: "bullish" | "bearish" | "neutral";
  patternType?: PatternType | "unknown";
  degree?: Degree;
  confidence?: number;
}

export interface EngineConfig {
  assetClass: AssetClass;
  maxCounts: number;
  hysteresisMargin: number;
  wave5PosteriorThreshold: number;
  useVolume: boolean;
  useMomentum: boolean;
  useTimeSymmetry: boolean;
  useChanneling: boolean;
  requireConfirmedPivotsOnly: boolean;
  minBarsPerWave: number;
}

const DEFAULT_CONFIG: EngineConfig = {
  assetClass: "equity",
  maxCounts: 8,
  hysteresisMargin: 12,
  wave5PosteriorThreshold: 0.55,
  useVolume: true,
  useMomentum: true,
  useTimeSymmetry: true,
  useChanneling: true,
  requireConfirmedPivotsOnly: false,
  minBarsPerWave: 3,
};

const W2_RETRACE_MIN = 0.236;
const W2_RETRACE_IDEAL_LOW = 0.5;
const W2_RETRACE_IDEAL_HIGH = 0.618;
const W2_RETRACE_MAX = 0.999;
const W3_EXTEND_MIN = 1.0;
const W3_EXTEND_IDEAL = 1.618;
const W3_EXTEND_EXTREME = 2.618;
const W3_EXTENDED_THRESHOLD = 1.618;
const W4_RETRACE_MIN = 0.236;
const W4_RETRACE_IDEAL_LOW = 0.3;
const W4_RETRACE_IDEAL_HIGH = 0.5;
const W4_RETRACE_MAX = 0.618;
const W5_EXTEND_MIN = 0.618;
const W5_EXTEND_IDEAL_LOW = 0.618;
const W5_EXTEND_IDEAL_HIGH = 1.0;
const W5_EXTEND_SUSPECT = 2.618;
const ZIGZAG_B_RETRACE_MIN = 0.236;
const ZIGZAG_B_RETRACE_IDEAL_LOW = 0.382;
const ZIGZAG_B_RETRACE_IDEAL_HIGH = 0.786;
const ZIGZAG_B_RETRACE_MAX = 0.999;
const ZIGZAG_C_EXTEND_IDEAL = 1.0;
const ZIGZAG_C_EXTEND_MIN = 0.618;
const ZIGZAG_C_EXTEND_MAX = 2.618;
const FLAT_B_RETRACE_MIN = 0.9;
const REGULAR_FLAT_B_MAX = 1.05;
const EXPANDED_FLAT_B_MIN = 1.05;
const EXPANDED_FLAT_B_IDEAL = 1.236;
const EXPANDED_FLAT_B_MAX = 1.382;
const EXPANDED_FLAT_C_MIN = 1.236;
const EXPANDED_FLAT_C_IDEAL = 1.618;
const EXPANDED_FLAT_C_MAX = 2.618;
const SUSPECT_TIME_RATIO = 3.0;
const HARD_SUSPECT_TIME_RATIO = 5.0;
const CHANNEL_TOUCH_TOLERANCE = 0.02;
const DIAGONAL_CHANNEL_TOLERANCE = 0.1;
const POST_PATTERN_RETRACE_SUSPECT = 0.618;
const POST_PATTERN_RETRACE_CONFIRM = 0.786;

// Suppress unused variable warnings for constants used in type-only contexts
void W3_EXTEND_MIN;
void W5_EXTEND_MIN;

export function generateWaveCountsV3(args: {
  pivots: Pivot[];
  ticker: string;
  timeframe: Timeframe;
  assetClass?: AssetClass;
  state?: EngineState;
  config?: Partial<EngineConfig>;
  higherTimeframeBias?: HigherTimeframeBias;
  candles?: CandleLike[];
}): PatternCandidate[] {
  const config: EngineConfig = {
    ...DEFAULT_CONFIG,
    assetClass: args.assetClass ?? DEFAULT_CONFIG.assetClass,
    ...args.config,
  };
  const pivots = normalizePivots(args.pivots, config);
  if (pivots.length < 3) return [];
  const candidates: PatternCandidate[] = [];
  const seen = new Set<string>();
  for (let start = 0; start + 5 < pivots.length; start++) {
    const window = pivots.slice(start, start + 6);
    if (!strictAlternation(window)) continue;
    const windowCandidates = classifySixPivotWindow({ window, ticker: args.ticker, timeframe: args.timeframe, assetClass: config.assetClass, config, higherTimeframeBias: args.higherTimeframeBias, candles: args.candles });
    for (const c of windowCandidates) {
      if (!seen.has(c.id)) { seen.add(c.id); candidates.push(c); }
    }
  }
  for (const partial of generatePartialCandidates({ pivots, ticker: args.ticker, timeframe: args.timeframe, assetClass: config.assetClass, config, higherTimeframeBias: args.higherTimeframeBias })) {
    if (!seen.has(partial.id)) { seen.add(partial.id); candidates.push(partial); }
  }
  const ranked = rankAndNormalize(candidates, config);
  const stabilized = applyHysteresis(ranked, args.state, config);
  return stabilized.slice(0, config.maxCounts);
}

function classifySixPivotWindow(args: { window: Pivot[]; ticker: string; timeframe: Timeframe; assetClass: AssetClass; config: EngineConfig; higherTimeframeBias?: HigherTimeframeBias; candles?: CandleLike[]; }): PatternCandidate[] {
  const { window, ticker, timeframe, assetClass, config, higherTimeframeBias, candles } = args;
  const isBullish = !window[0].isHigh;
  const degree = inferDegreeFromWindow(window, timeframe);
  const results: PatternCandidate[] = [];
  const impulseMetrics = computeImpulseMetrics(window);
  const impulseRules = checkImpulseHardRules(window, isBullish);
  if (impulseRules.passed) results.push(buildCandidate({ ticker, timeframe, assetClass, degree, type: "impulse", stage: "complete", isBullish, pivots: window, metrics: impulseMetrics, prior: getPrior("impulse", "complete", assetClass), hardViolations: [], config, higherTimeframeBias, candles }));
  const leadingDiagRules = checkDiagonalRules(window, isBullish, "leading_diagonal");
  if (leadingDiagRules.passed) results.push(buildCandidate({ ticker, timeframe, assetClass, degree, type: "leading_diagonal", stage: "complete", isBullish, pivots: window, metrics: impulseMetrics, prior: getPrior("leading_diagonal", "complete", assetClass), hardViolations: [], config, higherTimeframeBias, candles }));
  const endingDiagRules = checkDiagonalRules(window, isBullish, "ending_diagonal");
  if (endingDiagRules.passed) results.push(buildCandidate({ ticker, timeframe, assetClass, degree, type: "ending_diagonal", stage: "complete", isBullish, pivots: window, metrics: impulseMetrics, prior: getPrior("ending_diagonal", "complete", assetClass), hardViolations: [], config, higherTimeframeBias, candles }));
  const zigzag = tryBuildZigzag(window, ticker, timeframe, assetClass, degree, config, higherTimeframeBias, candles);
  if (zigzag) results.push(zigzag);
  const regularFlat = tryBuildRegularFlat(window, ticker, timeframe, assetClass, degree, config, higherTimeframeBias, candles);
  if (regularFlat) results.push(regularFlat);
  const expandedFlat = tryBuildExpandedFlat(window, ticker, timeframe, assetClass, degree, config, higherTimeframeBias, candles);
  if (expandedFlat) results.push(expandedFlat);
  return results;
}

function buildCandidate(args: { ticker: string; timeframe: Timeframe; assetClass: AssetClass; degree: Degree; type: PatternType; stage: CountStage; isBullish: boolean; pivots: Pivot[]; metrics: Partial<WaveMetrics>; prior: number; hardViolations: string[]; config: EngineConfig; higherTimeframeBias?: HigherTimeframeBias; candles?: CandleLike[]; }): PatternCandidate {
  const { ticker, timeframe, assetClass, degree, type, stage, isBullish, pivots, metrics, prior, hardViolations, config, higherTimeframeBias, candles } = args;
  const internalStructure = validateInternalStructure(type, pivots, timeframe);
  const fib = scoreFibonacci(type, stage, metrics, assetClass);
  const volume = config.useVolume ? scoreVolume(type, stage, pivots, assetClass, metrics) : neutralScore("Volume disabled");
  const momentum = config.useMomentum ? scoreMomentum(type, stage, pivots, isBullish) : neutralScore("Momentum disabled");
  const time = config.useTimeSymmetry ? scoreTime(type, stage, metrics) : neutralScore("Time symmetry disabled");
  const channel = config.useChanneling ? scoreChannel(type, pivots, isBullish, metrics) : neutralScore("Channeling disabled");
  const degreeScore = scoreDegreeConsistency(degree, pivots, timeframe, config);
  const htfAlignment = scoreHigherTimeframeAlignment(type, isBullish, higherTimeframeBias);
  const structure = hardViolations.length === 0 ? 100 : 0;
  const total = prior * 100 * 0.05 + fib.score * 0.25 + internalStructure.score * 0.20 + volume.score * 0.12 + momentum.score * 0.12 + time.score * 0.10 + channel.score * 0.08 + degreeScore.score * 0.08 + htfAlignment.score * 0.05;
  const scoreTotal = clamp(total, 0, 100);
  const notes = [...fib.notes, ...internalStructure.notes, ...volume.notes, ...momentum.notes, ...time.notes, ...channel.notes, ...degreeScore.notes, ...htfAlignment.notes];
  const candidate: PatternCandidate = {
    id: makeCandidateId(ticker, timeframe, type, stage, degree, isBullish, pivots),
    ticker, timeframe, assetClass, degree, type, stage, isBullish, pivots, metrics, prior, hardViolations,
    score: { prior: prior * 100, structure, fibonacci: fib.score, internalStructure: internalStructure.score, volume: volume.score, momentum: momentum.score, time: time.score, channel: channel.score, degree: degreeScore.score, htfAlignment: htfAlignment.score, total: scoreTotal, notes },
    confidence: 0, preferred: false, recommendation: "ambiguous",
    invalidation: deriveInvalidation(type, stage, pivots, isBullish),
    targetZone: deriveTargetZone(type, stage, pivots, metrics, isBullish),
    summary: "",
  };
  candidate.recommendation = deriveRecommendation(candidate);
  candidate.summary = buildSummary(candidate);
  applyMorphChecks(candidate, candles);
  return candidate;
}

function checkImpulseHardRules(pivots: Pivot[], isBullish: boolean): HardRuleResult {
  const [p0, p1, p2, p3, p4] = pivots;
  const violations: string[] = [];
  const w1Start = p0.price, w1End = p1.price, w2End = p2.price, w3End = p3.price, w4End = p4.price;
  const l1 = absDiff(w1End, w1Start), l3 = absDiff(w3End, w2End), l5 = absDiff(pivots[5].price, w4End);
  // Rule 1: Wave 2 must not retrace more than 100% of Wave 1
  if (isBullish && w2End <= w1Start) violations.push("RULE1_W2_RETRACE_OVER_100");
  if (!isBullish && w2End >= w1Start) violations.push("RULE1_W2_RETRACE_OVER_100");
  // Rule 2: Wave 3 must not be the shortest impulse wave
  if (l3 < l1 && l3 < l5) violations.push("RULE2_W3_SHORTEST");
  // Guard: Wave 5 must have meaningful length (≥ 10% of Wave 1). Prevents
  // phantom counts where W3 and W5 endpoints converge at the same price.
  if (l5 < l1 * 0.10) violations.push("RULE2_W5_TOO_SHORT");
  // Rule 3: Wave 4 must not enter Wave 1's price territory.
  // For bullish: Wave 4 trough must be at or above Wave 1's peak (w1End).
  // For bearish: Wave 4 peak must be at or below Wave 1's trough (w1End).
  if (isBullish && w4End < w1End) violations.push("RULE3_W4_OVERLAP_W1");
  if (!isBullish && w4End > w1End) violations.push("RULE3_W4_OVERLAP_W1");
  return { passed: violations.length === 0, violations };
}

function checkDiagonalRules(pivots: Pivot[], isBullish: boolean, type: "leading_diagonal" | "ending_diagonal"): HardRuleResult {
  const violations: string[] = [];
  if (!hasWave14Overlap(pivots)) violations.push(`${type.toUpperCase()}_NO_WAVE14_OVERLAP`);
  if (!isConvergingWedge(pivots, type)) violations.push(`${type.toUpperCase()}_NO_CONVERGING_WEDGE`);
  const p1 = pivots[1].price, p3 = pivots[3].price;
  if (isBullish && (p3 <= p1)) violations.push(`${type.toUpperCase()}_INSUFFICIENT_PROGRESS`);
  if (!isBullish && (p3 >= p1)) violations.push(`${type.toUpperCase()}_INSUFFICIENT_PROGRESS`);
  return { passed: violations.length === 0, violations };
}

function tryBuildZigzag(window: Pivot[], ticker: string, timeframe: Timeframe, assetClass: AssetClass, degree: Degree, config: EngineConfig, higherTimeframeBias?: HigherTimeframeBias, candles?: CandleLike[]): PatternCandidate | null {
  const [p0, , p2, p3, , p5] = window;
  const isBullish = p5.price > p0.price;
  const aLen = absDiff(p2.price, p0.price), bLen = absDiff(p3.price, p2.price), cLen = absDiff(p5.price, p3.price);
  const bRetrace = safeDiv(bLen, aLen), cExtend = safeDiv(cLen, aLen);
  if (!(bRetrace >= ZIGZAG_B_RETRACE_MIN && bRetrace < 1.0 && cExtend >= ZIGZAG_C_EXTEND_MIN && cExtend <= ZIGZAG_C_EXTEND_MAX)) return null;
  return buildCandidate({ ticker, timeframe, assetClass, degree, type: "zigzag", stage: "complete", isBullish, pivots: window, metrics: { aLen, bLen, cLen, bRetrace, cExtend, timeA: Math.max(1, p2.ts - p0.ts), timeB: Math.max(1, p3.ts - p2.ts), timeC: Math.max(1, p5.ts - p3.ts) }, prior: getPrior("zigzag", "complete", assetClass), hardViolations: [], config, higherTimeframeBias, candles });
}

function tryBuildRegularFlat(window: Pivot[], ticker: string, timeframe: Timeframe, assetClass: AssetClass, degree: Degree, config: EngineConfig, higherTimeframeBias?: HigherTimeframeBias, candles?: CandleLike[]): PatternCandidate | null {
  const [p0, , p2, p3, , p5] = window;
  const isBullish = p5.price > p0.price;
  const aLen = absDiff(p2.price, p0.price), bLen = absDiff(p3.price, p2.price), cLen = absDiff(p5.price, p3.price);
  const bRetrace = safeDiv(bLen, aLen), cExtend = safeDiv(cLen, aLen);
  if (!(bRetrace >= FLAT_B_RETRACE_MIN && bRetrace <= REGULAR_FLAT_B_MAX && cExtend >= 1.0 && cExtend <= 1.05)) return null;
  return buildCandidate({ ticker, timeframe, assetClass, degree, type: "regular_flat", stage: "complete", isBullish, pivots: window, metrics: { aLen, bLen, cLen, bRetrace, cExtend, timeA: Math.max(1, p2.ts - p0.ts), timeB: Math.max(1, p3.ts - p2.ts), timeC: Math.max(1, p5.ts - p3.ts) }, prior: getPrior("regular_flat", "complete", assetClass), hardViolations: [], config, higherTimeframeBias, candles });
}

function tryBuildExpandedFlat(window: Pivot[], ticker: string, timeframe: Timeframe, assetClass: AssetClass, degree: Degree, config: EngineConfig, higherTimeframeBias?: HigherTimeframeBias, candles?: CandleLike[]): PatternCandidate | null {
  const [p0, , p2, p3, , p5] = window;
  const isBullish = p5.price > p0.price;
  const aLen = absDiff(p2.price, p0.price), bLen = absDiff(p3.price, p2.price), cLen = absDiff(p5.price, p3.price);
  const bRetrace = safeDiv(bLen, aLen), cExtend = safeDiv(cLen, aLen);
  if (!(bRetrace >= EXPANDED_FLAT_B_MIN && bRetrace <= EXPANDED_FLAT_B_MAX && cExtend >= EXPANDED_FLAT_C_MIN && cExtend <= EXPANDED_FLAT_C_MAX)) return null;
  return buildCandidate({ ticker, timeframe, assetClass, degree, type: "expanded_flat", stage: "complete", isBullish, pivots: window, metrics: { aLen, bLen, cLen, bRetrace, cExtend, timeA: Math.max(1, p2.ts - p0.ts), timeB: Math.max(1, p3.ts - p2.ts), timeC: Math.max(1, p5.ts - p3.ts) }, prior: getPrior("expanded_flat", "complete", assetClass), hardViolations: [], config, higherTimeframeBias, candles });
}

function generatePartialCandidates(args: { pivots: Pivot[]; ticker: string; timeframe: Timeframe; assetClass: AssetClass; config: EngineConfig; higherTimeframeBias?: HigherTimeframeBias; }): PatternCandidate[] {
  const { pivots, ticker, timeframe, assetClass, config, higherTimeframeBias } = args;
  const out: PatternCandidate[] = [];
  if (pivots.length >= 3) { const tail3 = pivots.slice(-3); if (strictAlternation(tail3)) { const c = buildPartialImpulse(tail3, ticker, timeframe, assetClass, "forming_w3", config, higherTimeframeBias); if (c) out.push(c); } }
  if (pivots.length >= 4) { const tail4 = pivots.slice(-4); if (strictAlternation(tail4)) { const c = buildPartialImpulse(tail4, ticker, timeframe, assetClass, "forming_w4", config, higherTimeframeBias); if (c) out.push(c); } }
  if (pivots.length >= 5) { const tail5 = pivots.slice(-5); if (strictAlternation(tail5)) { const c = buildPartialImpulse(tail5, ticker, timeframe, assetClass, "forming_w5", config, higherTimeframeBias); if (c) out.push(c); } }
  return out;
}

function buildPartialImpulse(pivots: Pivot[], ticker: string, timeframe: Timeframe, assetClass: AssetClass, stage: CountStage, config: EngineConfig, higherTimeframeBias?: HigherTimeframeBias): PatternCandidate | null {
  const isBullish = !pivots[0].isHigh;
  const degree = inferDegreeFromWindow(pivots, timeframe);
  if (stage === "forming_w3" && pivots.length === 3) {
    const [p0, p1, p2] = pivots;
    const l1 = absDiff(p1.price, p0.price), l2 = absDiff(p2.price, p1.price), r2 = safeDiv(l2, l1);
    if (r2 >= 1.0) return null;
    return buildCandidate({ ticker, timeframe, assetClass, degree, type: "impulse", stage, isBullish, pivots, metrics: { l1, l2, r2, time1: Math.max(1, p1.ts - p0.ts), time2: Math.max(1, p2.ts - p1.ts) }, prior: getPrior("impulse", stage, assetClass), hardViolations: [], config, higherTimeframeBias });
  }
  if (stage === "forming_w4" && pivots.length === 4) {
    const [p0, p1, p2, p3] = pivots;
    const l1 = absDiff(p1.price, p0.price), l2 = absDiff(p2.price, p1.price), l3 = absDiff(p3.price, p2.price);
    const r2 = safeDiv(l2, l1), e3 = safeDiv(l3, l1);
    if (r2 >= 1.0 || e3 < 1.0) return null;
    return buildCandidate({ ticker, timeframe, assetClass, degree, type: "impulse", stage, isBullish, pivots, metrics: { l1, l2, l3, r2, e3, time1: Math.max(1, p1.ts - p0.ts), time2: Math.max(1, p2.ts - p1.ts), time3: Math.max(1, p3.ts - p2.ts) }, prior: getPrior("impulse", stage, assetClass), hardViolations: [], config, higherTimeframeBias });
  }
  if (stage === "forming_w5" && pivots.length === 5) {
    const [p0, p1, p2, p3, p4] = pivots;
    const l1 = absDiff(p1.price, p0.price), l2 = absDiff(p2.price, p1.price), l3 = absDiff(p3.price, p2.price), l4 = absDiff(p4.price, p3.price);
    const r2 = safeDiv(l2, l1), e3 = safeDiv(l3, l1), r4 = safeDiv(l4, l3);
    if (r2 >= 1.0 || e3 < 1.0) return null;
    const w1Low = Math.min(p0.price, p1.price), w1High = Math.max(p0.price, p1.price);
    if (p4.price > w1Low && p4.price < w1High) return null;
    return buildCandidate({ ticker, timeframe, assetClass, degree, type: "impulse", stage, isBullish, pivots, metrics: { l1, l2, l3, l4, r2, e3, r4, time1: Math.max(1, p1.ts - p0.ts), time2: Math.max(1, p2.ts - p1.ts), time3: Math.max(1, p3.ts - p2.ts), time4: Math.max(1, p4.ts - p3.ts) }, prior: getPrior("impulse", stage, assetClass), hardViolations: [], config, higherTimeframeBias });
  }
  return null;
}

function computeImpulseMetrics(window: Pivot[]): WaveMetrics {
  const [p0, p1, p2, p3, p4, p5] = window;
  const l1 = absDiff(p1.price, p0.price), l2 = absDiff(p2.price, p1.price), l3 = absDiff(p3.price, p2.price), l4 = absDiff(p4.price, p3.price), l5 = absDiff(p5.price, p4.price);
  return { l1, l2, l3, l4, l5, r2: safeDiv(l2, l1), e3: safeDiv(l3, l1), r4: safeDiv(l4, l3), rel5To1: safeDiv(l5, l1), rel5To3: safeDiv(l5, l3), time1: Math.max(1, p1.ts - p0.ts), time2: Math.max(1, p2.ts - p1.ts), time3: Math.max(1, p3.ts - p2.ts), time4: Math.max(1, p4.ts - p3.ts), time5: Math.max(1, p5.ts - p4.ts) };
}

function scoreFibonacci(type: PatternType, stage: CountStage, metrics: Partial<WaveMetrics>, assetClass: AssetClass): { score: number; notes: string[] } {
  switch (type) {
    case "impulse": case "leading_diagonal": case "ending_diagonal": return scoreImpulseFib(type, stage, metrics, assetClass);
    case "zigzag": return scoreZigzagFib(metrics);
    case "regular_flat": return scoreRegularFlatFib(metrics);
    case "expanded_flat": return scoreExpandedFlatFib(metrics);
    default: return neutralScore("No fibonacci model");
  }
}

function scoreImpulseFib(type: PatternType, stage: CountStage, m: Partial<WaveMetrics>, assetClass: AssetClass): { score: number; notes: string[] } {
  let score = 0, denom = 0;
  const notes: string[] = [];
  if (isFiniteNumber(m.r2)) {
    denom += 24;
    if (between(m.r2!, W2_RETRACE_IDEAL_LOW, W2_RETRACE_IDEAL_HIGH)) { score += 24; notes.push("Wave 2 retracement is in the highest-probability zone"); }
    else if (between(m.r2!, 0.382, 0.786)) score += 18;
    else if (between(m.r2!, W2_RETRACE_MIN, W2_RETRACE_MAX)) { score += 8; notes.push("Wave 2 retracement is valid but less typical"); }
    else notes.push("Wave 2 retracement is atypical");
  }
  if ((stage === "forming_w4" || stage === "forming_w5" || stage === "complete") && isFiniteNumber(m.e3)) {
    denom += 28;
    if (near(m.e3!, W3_EXTEND_IDEAL, 0.25)) { score += 28; notes.push("Wave 3 extension is near the primary 1.618 target"); }
    else if (between(m.e3!, 1.0, 1.618)) { score += 16; notes.push("Wave 3 is valid but not strongly extended"); }
    else if (between(m.e3!, 1.75, 2.618)) { score += 20; notes.push("Wave 3 is strongly extended"); }
    else if (m.e3! > W3_EXTEND_EXTREME) { score += 12; notes.push("Wave 3 is extremely extended"); }
    else notes.push("Wave 3 is weak versus Wave 1");
  }
  if ((stage === "forming_w5" || stage === "complete") && isFiniteNumber(m.r4)) {
    denom += 18;
    if (between(m.r4!, W4_RETRACE_IDEAL_LOW, W4_RETRACE_IDEAL_HIGH)) { score += 18; notes.push("Wave 4 depth is typical"); }
    else if (between(m.r4!, W4_RETRACE_MIN, W4_RETRACE_MAX)) score += 10;
    else notes.push("Wave 4 retracement is suspect");
  }
  if (stage === "complete" && isFiniteNumber(m.rel5To1) && isFiniteNumber(m.e3)) {
    denom += 22;
    if (m.e3! >= W3_EXTENDED_THRESHOLD) {
      if (between(m.rel5To1!, W5_EXTEND_IDEAL_LOW, W5_EXTEND_IDEAL_HIGH)) { score += 22; notes.push("Wave 5 is appropriately sized relative to Wave 1 after an extended Wave 3"); }
      else if (near(m.rel5To1!, 1.618, 0.25)) score += 10;
      else if (m.rel5To1! > W5_EXTEND_SUSPECT) { score += 2; notes.push("Wave 5 is unusually extended, morph risk elevated"); }
      else score += 8;
    } else {
      if (near(m.rel5To1!, 1.618, 0.25) || between(m.rel5To1!, 1.0, 1.8)) { score += 22; notes.push("Wave 5 extension is reasonable when Wave 3 was not dominant"); }
      else score += 8;
    }
  }
  if (type === "impulse") {
    if (assetClass === "equity" && isFiniteNumber(m.e3) && m.e3! >= 1.618) notes.push("Equity prior supports a dominant Wave 3");
  }
  return { score: denom > 0 ? clamp((score / denom) * 100, 0, 100) : 50, notes };
}

function scoreZigzagFib(m: Partial<WaveMetrics>): { score: number; notes: string[] } {
  let score = 0, denom = 0;
  const notes: string[] = [];
  if (isFiniteNumber(m.bRetrace)) {
    denom += 40;
    if (between(m.bRetrace!, ZIGZAG_B_RETRACE_IDEAL_LOW, ZIGZAG_B_RETRACE_IDEAL_HIGH)) { score += 40; notes.push("B-wave retracement fits a typical zigzag"); }
    else if (between(m.bRetrace!, ZIGZAG_B_RETRACE_MIN, ZIGZAG_B_RETRACE_MAX)) score += 18;
  }
  if (isFiniteNumber(m.cExtend)) {
    denom += 60;
    if (near(m.cExtend!, ZIGZAG_C_EXTEND_IDEAL, 0.18)) { score += 60; notes.push("C-wave is near equality with A, the most common zigzag relationship"); }
    else if (near(m.cExtend!, 0.618, 0.12) || near(m.cExtend!, 1.618, 0.25)) score += 36;
    else if (between(m.cExtend!, ZIGZAG_C_EXTEND_MIN, ZIGZAG_C_EXTEND_MAX)) score += 18;
  }
  return { score: denom > 0 ? clamp((score / denom) * 100, 0, 100) : 50, notes };
}

function scoreRegularFlatFib(m: Partial<WaveMetrics>): { score: number; notes: string[] } {
  let score = 0, denom = 0;
  const notes: string[] = [];
  if (isFiniteNumber(m.bRetrace)) { denom += 45; if (between(m.bRetrace!, FLAT_B_RETRACE_MIN, REGULAR_FLAT_B_MAX)) { score += 45; notes.push("B-wave retracement fits a regular flat"); } }
  if (isFiniteNumber(m.cExtend)) { denom += 55; if (between(m.cExtend!, 1.0, 1.05)) { score += 55; notes.push("C-wave size is consistent with a regular flat"); } else if (between(m.cExtend!, 0.9, 1.15)) score += 30; }
  return { score: denom > 0 ? clamp((score / denom) * 100, 0, 100) : 50, notes };
}

function scoreExpandedFlatFib(m: Partial<WaveMetrics>): { score: number; notes: string[] } {
  let score = 0, denom = 0;
  const notes: string[] = [];
  if (isFiniteNumber(m.bRetrace)) { denom += 40; if (near(m.bRetrace!, EXPANDED_FLAT_B_IDEAL, 0.15)) { score += 40; notes.push("B-wave retracement is near the common expanded-flat center"); } else if (between(m.bRetrace!, EXPANDED_FLAT_B_MIN, EXPANDED_FLAT_B_MAX)) score += 25; }
  if (isFiniteNumber(m.cExtend)) { denom += 60; if (near(m.cExtend!, EXPANDED_FLAT_C_IDEAL, 0.25)) { score += 60; notes.push("C-wave is near the common 1.618 expanded-flat target"); } else if (between(m.cExtend!, EXPANDED_FLAT_C_MIN, EXPANDED_FLAT_C_MAX)) score += 35; }
  return { score: denom > 0 ? clamp((score / denom) * 100, 0, 100) : 50, notes };
}

function validateInternalStructure(type: PatternType, pivots: Pivot[], _timeframe: Timeframe): InternalStructureResult {
  const notes: string[] = [];
  const len = pivots.length;
  if (len < 3) return { verified: false, unverifiable: true, score: 40, notes: ["Too few pivots for internal validation"] };
  if (type === "impulse") {
    if (len >= 6) { notes.push("Outer motive structure is fully represented"); return { verified: true, unverifiable: false, score: 85, notes }; }
    if (len >= 4) { notes.push("Partial motive structure is plausible but not fully verifiable"); return { verified: false, unverifiable: true, score: 65, notes }; }
  }
  if (type === "leading_diagonal" || type === "ending_diagonal") {
    if (len >= 6) { notes.push("Diagonal candidate passes minimum segmentation check"); return { verified: true, unverifiable: false, score: 78, notes }; }
  }
  if (type === "zigzag" || type === "regular_flat" || type === "expanded_flat") {
    if (len >= 6) { notes.push("Corrective structure has enough pivots for top-level validation"); return { verified: true, unverifiable: false, score: 80, notes }; }
  }
  return { verified: false, unverifiable: true, score: 55, notes: ["Internal structure not fully verifiable"] };
}

function scoreVolume(type: PatternType, stage: CountStage, pivots: Pivot[], assetClass: AssetClass, metrics: Partial<WaveMetrics>): { score: number; notes: string[] } {
  if (assetClass === "forex") return neutralScore("Volume down-weighted for forex");
  const notes: string[] = [];
  if (pivots.length < 6 || !hasVolumes(pivots)) return { score: 55, notes: ["Volume data unavailable, neutral weighting"] };
  const v1 = averageDefined([pivots[0].volume, pivots[1].volume]);
  const v3 = averageDefined([pivots[2].volume, pivots[3].volume]);
  const v5 = averageDefined([pivots[4].volume, pivots[5].volume]);
  let score = 55;
  if (type === "impulse" || type === "leading_diagonal" || type === "ending_diagonal") {
    if (isFiniteNumber(v1) && isFiniteNumber(v3)) {
      if (v3! >= v1! * 1.5) { score += 25; notes.push("Wave 3 volume expansion supports motive structure"); }
      else if (v3! < v1!) { score -= 25; notes.push("Wave 3 volume is weaker than Wave 1, strong warning"); }
      else score += 5;
    }
    if (stage === "complete" && isFiniteNumber(v3) && isFiniteNumber(v5)) {
      if (v5! < v3! * 0.8) { score += 10; notes.push("Wave 5 volume divergence is supportive"); }
      else if (v5! > v3! && !(isFiniteNumber(metrics.rel5To1) && metrics.rel5To1! >= 1.0)) { score -= 10; notes.push("Wave 5 volume exceeds Wave 3 without clear extension"); }
    }
  }
  return { score: clamp(score, 0, 100), notes };
}

function scoreMomentum(type: PatternType, stage: CountStage, pivots: Pivot[], isBullish: boolean): { score: number; notes: string[] } {
  const notes: string[] = [];
  const rsi1 = pivots[1]?.rsi, rsi3 = pivots[3]?.rsi, rsi5 = pivots[5]?.rsi;
  const macd1 = pivots[1]?.macdHist, macd3 = pivots[3]?.macdHist, macd5 = pivots[5]?.macdHist;
  if (!isFiniteNumber(rsi1) && !isFiniteNumber(rsi3) && !isFiniteNumber(macd1) && !isFiniteNumber(macd3)) return { score: 55, notes: ["Momentum data unavailable, neutral weighting"] };
  let score = 55;
  if ((type === "impulse" || type === "leading_diagonal" || type === "ending_diagonal") && isFiniteNumber(rsi1) && isFiniteNumber(rsi3)) {
    if (isBullish && rsi3! > rsi1!) score += 18;
    if (!isBullish && rsi3! < rsi1!) score += 18;
  }
  if ((type === "impulse" || type === "leading_diagonal" || type === "ending_diagonal") && isFiniteNumber(macd1) && isFiniteNumber(macd3)) {
    if (isBullish && macd3! > macd1!) score += 16;
    if (!isBullish && macd3! < macd1!) score += 16;
  }
  if (stage === "complete" && isFiniteNumber(rsi3) && isFiniteNumber(rsi5)) {
    if (isBullish && rsi5! < rsi3!) { score += 12; notes.push("RSI divergence supports a terminal-wave interpretation"); }
    else if (!isBullish && rsi5! > rsi3!) { score += 12; notes.push("RSI divergence supports a terminal-wave interpretation"); }
    else if (type === "impulse") { score -= 6; notes.push("No clear RSI divergence at the terminal leg"); }
  }
  if (stage === "complete" && isFiniteNumber(macd3) && isFiniteNumber(macd5)) {
    if (isBullish && macd5! < macd3!) score += 8;
    if (!isBullish && macd5! > macd3!) score += 8;
  }
  return { score: clamp(score, 0, 100), notes };
}

function scoreTime(type: PatternType, _stage: CountStage, m: Partial<WaveMetrics>): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 60;
  if (type === "impulse" || type === "leading_diagonal" || type === "ending_diagonal") {
    if (isFiniteNumber(m.time1) && isFiniteNumber(m.time2)) {
      const ratio = safeDiv(Math.max(m.time2!, m.time1!), Math.min(m.time2!, m.time1!));
      if (ratio > HARD_SUSPECT_TIME_RATIO) { score -= 30; notes.push("Wave 2 time is severely disproportionate to Wave 1"); }
      else if (ratio > SUSPECT_TIME_RATIO) { score -= 15; notes.push("Wave 2 time is stretched versus Wave 1"); }
    }
    if (isFiniteNumber(m.e3) && m.e3! >= W3_EXTENDED_THRESHOLD && isFiniteNumber(m.time1) && isFiniteNumber(m.time5)) {
      const tRatio = safeDiv(Math.max(m.time1!, m.time5!), Math.min(m.time1!, m.time5!));
      if (tRatio <= 1.5) { score += 15; notes.push("Wave 1 and Wave 5 show useful time symmetry after an extended Wave 3"); }
      else if (tRatio > 2.0) { score -= 10; notes.push("Wave 1 and Wave 5 time symmetry is weak"); }
    }
  }
  if (type === "zigzag" || type === "regular_flat" || type === "expanded_flat") {
    if (isFiniteNumber(m.timeA) && isFiniteNumber(m.timeC)) {
      const ratio = safeDiv(Math.max(m.timeA!, m.timeC!), Math.min(m.timeA!, m.timeC!));
      if (ratio <= 1.8) { score += 10; notes.push("A and C duration are proportionate"); }
      else if (ratio > HARD_SUSPECT_TIME_RATIO) score -= 15;
    }
  }
  return { score: clamp(score, 0, 100), notes };
}

function scoreChannel(type: PatternType, pivots: Pivot[], isBullish: boolean, metrics: Partial<WaveMetrics>): { score: number; notes: string[] } {
  const notes: string[] = [];
  if (pivots.length < 5) return { score: 55, notes: ["Not enough pivots for channel scoring"] };
  if (type === "impulse") {
    const deviation = computeImpulseChannelDeviation(pivots);
    if (!isFiniteNumber(deviation)) return { score: 55, notes: ["Channel could not be computed"] };
    let score = 100 - deviation * 100;
    if (deviation <= CHANNEL_TOUCH_TOLERANCE) notes.push("Terminal leg aligns with the acceleration channel");
    else if (deviation > 0.2) notes.push("Wave termination is materially off the channel projection");
    if (isFiniteNumber(metrics.e3) && metrics.e3! < 1.0) { score -= 15; notes.push("Wave 3 lacks channel-confirmed impulsiveness"); }
    return { score: clamp(score, 0, 100), notes };
  }
  if (type === "leading_diagonal" || type === "ending_diagonal") {
    const wedgeDeviation = computeDiagonalChannelDeviation(pivots);
    let score = 75;
    if (isFiniteNumber(wedgeDeviation)) {
      score = 100 - wedgeDeviation * 100;
      if (wedgeDeviation <= DIAGONAL_CHANNEL_TOLERANCE) notes.push("Price action is consistent with wedge geometry");
    }
    return { score: clamp(score, 0, 100), notes };
  }
  void isBullish;
  return { score: 55, notes: ["Channeling is less diagnostic for this corrective type"] };
}

function scoreDegreeConsistency(degree: Degree, pivots: Pivot[], timeframe: Timeframe, config: EngineConfig): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 70;
  if (pivots.length >= 2) {
    for (let i = 1; i < pivots.length; i++) {
      const bars = estimateBarsBetween(pivots[i - 1], pivots[i], timeframe);
      if (bars < config.minBarsPerWave) { score -= 20; notes.push("One or more waves are too short in bar count and may be noise"); break; }
    }
  }
  if (degree === "subminuette" || degree === "minuette") score += 5;
  return { score: clamp(score, 0, 100), notes };
}

function scoreHigherTimeframeAlignment(type: PatternType, isBullish: boolean, bias?: HigherTimeframeBias): { score: number; notes: string[] } {
  if (!bias || bias.direction === "neutral" || !bias.direction) return { score: 60, notes: ["No higher-timeframe bias applied"] };
  const notes: string[] = [];
  let score = 60;
  if ((bias.direction === "bullish" && isBullish) || (bias.direction === "bearish" && !isBullish)) { score += 25; notes.push("Direction aligns with higher timeframe bias"); }
  else { score -= 20; notes.push("Direction conflicts with higher timeframe bias"); }
  if (bias.patternType && bias.patternType !== "unknown" && bias.patternType === type) score += 10;
  return { score: clamp(score, 0, 100), notes };
}

function getPrior(type: PatternType, stage: CountStage, assetClass: AssetClass): number {
  const base: Record<PatternType, number> = { impulse: 0.18, leading_diagonal: 0.06, ending_diagonal: 0.07, zigzag: 0.16, regular_flat: 0.09, expanded_flat: 0.12 };
  let prior = base[type];
  if (type === "impulse" && (stage === "forming_w4" || stage === "forming_w5" || stage === "complete")) prior += 0.03;
  if (assetClass === "equity" && type === "impulse") prior += 0.03;
  if (assetClass === "commodity" && type === "ending_diagonal") prior += 0.01;
  if (assetClass === "forex" && type === "zigzag") prior += 0.02;
  return clamp(prior, 0.01, 0.35);
}

function applyMorphChecks(candidate: PatternCandidate, candles?: CandleLike[]): void {
  const notes = candidate.score.notes;
  if (candidate.type === "impulse" && candidate.stage === "complete") {
    const { rel5To1, e3 } = candidate.metrics;
    if (isFiniteNumber(rel5To1) && rel5To1! > W5_EXTEND_SUSPECT) { candidate.score.total = clamp(candidate.score.total - 10, 0, 100); notes.push("Terminal extension is extreme, triggering morph suspicion"); }
    if (isFiniteNumber(e3) && e3! < 1.0) { candidate.score.total = clamp(candidate.score.total - 15, 0, 100); notes.push("Wave 3 is weak, corrective reinterpretation risk elevated"); }
    if (candles && candles.length > 0) {
      const retrace = estimatePostPatternRetrace(candidate, candles);
      if (isFiniteNumber(retrace)) {
        if (retrace! >= POST_PATTERN_RETRACE_CONFIRM) { candidate.score.total = clamp(candidate.score.total - 20, 0, 100); notes.push("Rapid deep retracement favors corrective reinterpretation"); }
        else if (retrace! >= POST_PATTERN_RETRACE_SUSPECT) { candidate.score.total = clamp(candidate.score.total - 10, 0, 100); notes.push("Post-pattern retracement is deeper than expected for a stable impulse"); }
      }
    }
  }
  candidate.confidence = clamp(candidate.score.total / 100, 0, 1);
  candidate.recommendation = deriveRecommendation(candidate);
  candidate.summary = buildSummary(candidate);
}

function estimatePostPatternRetrace(candidate: PatternCandidate, candles: CandleLike[]): number | null {
  const lastPivot = candidate.pivots[candidate.pivots.length - 1];
  const firstPivot = candidate.pivots[0];
  const future = candles.filter((c) => c.ts > lastPivot.ts);
  if (!future.length) return null;
  const patternSpan = absDiff(lastPivot.price, firstPivot.price);
  if (patternSpan <= 0) return null;
  let maxRetrace = 0;
  if (candidate.isBullish) { const minFuture = Math.min(...future.map((c) => c.low)); maxRetrace = absDiff(lastPivot.price, minFuture); }
  else { const maxFuture = Math.max(...future.map((c) => c.high)); maxRetrace = absDiff(lastPivot.price, maxFuture); }
  return safeDiv(maxRetrace, patternSpan);
}

function rankAndNormalize(candidates: PatternCandidate[], config: EngineConfig): PatternCandidate[] {
  if (!candidates.length) return [];
  for (const c of candidates) {
    if (c.type === "impulse" && c.stage === "complete") {
      const hasTerminalDivergence = c.score.notes.some((n) => n.includes("divergence")) || c.score.notes.some((n) => n.includes("terminal-wave"));
      if (!hasTerminalDivergence) { c.score.total = clamp(c.score.total - 8, 0, 100); c.score.notes.push("Wave 5 lacks strong terminal divergence support"); }
    }
  }

  // Recency bias: penalise candidates whose last pivot is far from the most
  // recent candle. This ensures the engine surfaces the wave count that covers
  // current price action, not a well-proportioned older completed pattern.
  const allTs = candidates.flatMap((c) => c.pivots.map((p) => p.ts));
  const maxTs = Math.max(...allTs);
  const minTs = Math.min(...allTs);
  const timeSpan = maxTs - minTs;
  if (timeSpan > 0) {
    for (const c of candidates) {
      const lastPivotTs = c.pivots[c.pivots.length - 1].ts;
      const staleness = (maxTs - lastPivotTs) / timeSpan; // 0 = current, 1 = oldest
      if (staleness > 0.25) {
        // Up to 12 point penalty for counts whose last pivot is in the oldest 75%
        const penalty = clamp((staleness - 0.25) / 0.75 * 12, 0, 12);
        c.score.total = clamp(c.score.total - penalty, 0, 100);
        c.score.notes.push("Staleness: last pivot not at current price action");
      }
    }
  }

  for (const c of candidates) c.confidence = clamp(c.score.total / 100, 0, 1);
  let sorted = [...candidates].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (b.score.total !== a.score.total) return b.score.total - a.score.total;
    return a.pivots[0].ts - b.pivots[0].ts;
  });
  if (sorted[0] && sorted[0].type === "impulse" && sorted[0].stage === "complete" && sorted[0].confidence < config.wave5PosteriorThreshold) sorted[0].recommendation = "ambiguous";
  sorted.forEach((c, i) => { c.preferred = i === 0; if (i > 0) c.alternateRank = i; });
  return sorted;
}

function applyHysteresis(candidates: PatternCandidate[], state: EngineState | undefined, config: EngineConfig): PatternCandidate[] {
  if (!candidates.length || !state?.preferredCandidateId) return candidates;
  const current = candidates.find((c) => c.id === state.preferredCandidateId);
  const best = candidates[0];
  if (!current || !best) return candidates;
  const currentStillValid = current.hardViolations.length === 0;
  const scoreGap = best.score.total - current.score.total;
  if (currentStillValid && best.id !== current.id && scoreGap < config.hysteresisMargin) {
    const reordered = [...candidates].sort((a, b) => {
      if (a.id === current.id) return -1;
      if (b.id === current.id) return 1;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.score.total - a.score.total;
    });
    reordered.forEach((c, i) => { c.preferred = i === 0; c.alternateRank = i === 0 ? undefined : i; });
    return reordered;
  }
  return candidates;
}

function deriveInvalidation(type: PatternType, stage: CountStage, pivots: Pivot[], isBullish: boolean): number | undefined {
  if (!pivots.length) return undefined;
  if (type === "impulse" || type === "leading_diagonal" || type === "ending_diagonal") {
    if (stage === "forming_w3") return pivots[0].price;
    if (stage === "forming_w4") return pivots[1].price;
    if (stage === "forming_w5" || stage === "complete") return pivots[Math.min(4, pivots.length - 1)].price;
  }
  if (type === "zigzag" || type === "regular_flat" || type === "expanded_flat") return pivots[Math.max(0, pivots.length - 2)]?.price;
  return isBullish ? Math.min(...pivots.map((p) => p.price)) : Math.max(...pivots.map((p) => p.price));
}

function deriveTargetZone(type: PatternType, stage: CountStage, pivots: Pivot[], metrics: Partial<WaveMetrics>, isBullish: boolean): [number, number] | undefined {
  if (type === "impulse" && stage === "forming_w5" && isFiniteNumber(metrics.l1)) {
    const base = pivots[4].price;
    const low = metrics.l1! * 0.618, high = metrics.l1! * 1.0;
    return isBullish ? [base + low, base + high] : [base - high, base - low];
  }
  if (type === "zigzag" && stage === "forming_c" && isFiniteNumber(metrics.aLen)) {
    const base = pivots[pivots.length - 1].price;
    const low = metrics.aLen! * 0.618, high = metrics.aLen! * 1.0;
    return isBullish ? [base + low, base + high] : [base - high, base - low];
  }
  return undefined;
}

function deriveRecommendation(c: PatternCandidate): Recommendation {
  if (c.hardViolations.length > 0) return "invalid";
  if (c.confidence >= 0.55 && c.score.total >= 80) return "high_confidence";
  if (c.confidence >= 0.35 && c.score.total >= 60) return "tradable_but_caution";
  if (c.confidence < 0.2) return "ambiguous";
  return "low_confidence";
}

function buildSummary(c: PatternCandidate): string {
  const dir = c.isBullish ? "Bullish" : "Bearish";
  const pattern = c.type.replace(/_/g, " ");
  const stage = stageLabel(c.stage);
  const topNotes = c.score.notes.slice(0, 3).join("; ");
  return `${dir} ${pattern}, ${stage}, confidence ${(c.confidence * 100).toFixed(0)}%, score ${c.score.total.toFixed(1)}. ${topNotes}`.trim();
}

function stageLabel(stage: CountStage): string {
  const map: Record<CountStage, string> = { complete: "complete", forming_w3: "forming Wave 3", forming_w4: "forming Wave 4", forming_w5: "forming Wave 5", forming_b: "forming B", forming_c: "forming C" };
  return map[stage] ?? stage;
}

export function explainCandidate(candidate: PatternCandidate): string[] {
  const out: string[] = [];
  if (candidate.hardViolations.length) { out.push(`Invalid due to: ${candidate.hardViolations.join(", ")}`); return out; }
  if (candidate.type === "impulse" && isFiniteNumber(candidate.metrics.r2) && candidate.metrics.r2! > 0.786) out.push("Wave 2 retracement is deeper than typical");
  if (candidate.type === "impulse" && isFiniteNumber(candidate.metrics.e3) && candidate.metrics.e3! < 1.0) out.push("Wave 3 lacks the extension normally seen in stronger impulse structures");
  if (candidate.type === "impulse" && isFiniteNumber(candidate.metrics.rel5To1) && candidate.metrics.rel5To1! > W5_EXTEND_SUSPECT) out.push("Wave 5 is unusually extended, raising relabel risk");
  if (candidate.score.internalStructure < 60) out.push("Internal wave structure is not strongly verified");
  if (candidate.score.volume < 45) out.push("Volume behavior is not strongly supportive");
  if (candidate.score.momentum < 45) out.push("Momentum behavior is not strongly supportive");
  if (candidate.score.channel < 45) out.push("Channel alignment is weak");
  if (candidate.recommendation === "ambiguous") out.push("This count should be treated as one of multiple live scenarios");
  if (!out.length) out.push("Structure and guideline fit are broadly supportive");
  return out;
}

function hasWave14Overlap(pivots: Pivot[]): boolean {
  const p0 = pivots[0].price, p1 = pivots[1].price, p4 = pivots[4].price;
  const low = Math.min(p0, p1), high = Math.max(p0, p1);
  return p4 > low && p4 < high;
}

function isConvergingWedge(pivots: Pivot[], _type: "leading_diagonal" | "ending_diagonal"): boolean {
  if (pivots.length < 6) return false;
  const b1 = getBar(pivots[1], 1), b2 = getBar(pivots[2], 2), b3 = getBar(pivots[3], 3), b4 = getBar(pivots[4], 4), b5 = getBar(pivots[5], 5);
  const s13 = safeDiv(pivots[3].price - pivots[1].price, b3 - b1);
  const s24 = safeDiv(pivots[4].price - pivots[2].price, b4 - b2);
  if (Math.sign(s13) !== Math.sign(s24) || s13 === s24) return false;
  const intersectionBar = safeDiv(pivots[2].price - pivots[1].price + s13 * b1 - s24 * b2, s13 - s24);
  return intersectionBar > b5;
}

function computeImpulseChannelDeviation(pivots: Pivot[]): number {
  if (pivots.length < 6) return Number.NaN;
  const p1 = pivots[1], p2 = pivots[2], p3 = pivots[3], p5 = pivots[5];
  const b1 = getBar(p1, 1), b2 = getBar(p2, 2), b3 = getBar(p3, 3), b5 = getBar(p5, 5);
  const slope = safeDiv(p3.price - p1.price, b3 - b1);
  const projectedAt5 = p2.price + slope * (b5 - b2);
  const deviation = absDiff(projectedAt5, p5.price);
  const width = Math.max(absDiff(p3.price, p2.price), 1e-9);
  return safeDiv(deviation, width);
}

function computeDiagonalChannelDeviation(pivots: Pivot[]): number {
  if (pivots.length < 6) return Number.NaN;
  const gross = Math.max(absDiff(pivots[5].price, pivots[0].price), 1e-9);
  const line13 = lineDistanceFromPoint(pivots[1], pivots[3], pivots[5]);
  return safeDiv(line13, gross);
}

function lineDistanceFromPoint(a: Pivot, b: Pivot, p: Pivot): number {
  const ax = getBar(a, 0), ay = a.price, bx = getBar(b, 1), by = b.price, px = getBar(p, 2), py = p.price;
  const num = Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax);
  const den = Math.sqrt((by - ay) ** 2 + (bx - ax) ** 2);
  return den === 0 ? 0 : num / den;
}

function normalizePivots(pivots: Pivot[], config: EngineConfig): Pivot[] {
  return [...pivots]
    .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.price))
    .filter((p) => !config.requireConfirmedPivotsOnly || p.confirmed !== false)
    .sort((a, b) => a.ts - b.ts)
    .reduce<Pivot[]>((acc, p) => {
      const last = acc[acc.length - 1];
      if (!last) { acc.push(p); return acc; }
      if (last.isHigh === p.isHigh) {
        const replace = (p.isHigh && p.price > last.price) || (!p.isHigh && p.price < last.price);
        if (replace) acc[acc.length - 1] = p;
        return acc;
      }
      acc.push(p);
      return acc;
    }, []);
}

function strictAlternation(pivots: Pivot[]): boolean {
  if (pivots.length < 2) return false;
  for (let i = 0; i < pivots.length - 1; i++) { if (pivots[i].isHigh === pivots[i + 1].isHigh) return false; }
  return true;
}

function inferDegreeFromWindow(pivots: Pivot[], timeframe: Timeframe): Degree {
  const totalMs = pivots[pivots.length - 1].ts - pivots[0].ts;
  if (timeframe.includes("1m") || timeframe.includes("5m")) return "subminuette";
  if (timeframe.includes("15m")) return "minuette";
  if (timeframe.includes("1h")) return "minute";
  if (timeframe.includes("4h")) return "minor";
  if (timeframe.toLowerCase().includes("d")) return totalMs > 45 * 24 * 60 * 60 * 1000 ? "intermediate" : "minor";
  return "primary";
}

function makeCandidateId(ticker: string, timeframe: Timeframe, type: PatternType, stage: CountStage, degree: Degree, isBullish: boolean, pivots: Pivot[]): string {
  const first = pivots[0], last = pivots[pivots.length - 1];
  return [ticker, timeframe, type, stage, degree, isBullish ? "bull" : "bear", first.ts, last.ts, pivots.length, first.price.toFixed(4), last.price.toFixed(4)].join(":");
}

function neutralScore(note: string): { score: number; notes: string[] } { return { score: 55, notes: [note] }; }
function absDiff(a: number, b: number): number { return Math.abs(a - b); }
function safeDiv(a: number, b: number): number { if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0; return a / b; }
function clamp(v: number, min: number, max: number): number { return Math.min(max, Math.max(min, v)); }
function between(v: number, low: number, high: number): boolean { return v >= low && v <= high; }
function near(v: number, center: number, tolerance: number): boolean { return Math.abs(v - center) <= tolerance; }
function isFiniteNumber(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function hasVolumes(pivots: Pivot[]): boolean { return pivots.some((p) => isFiniteNumber(p.volume)); }
function averageDefined(values: Array<number | undefined>): number | undefined {
  const valid = values.filter(isFiniteNumber) as number[];
  if (!valid.length) return undefined;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}
function getBar(p: Pivot, fallback: number): number { return isFiniteNumber(p.bar) ? p.bar! : fallback; }
function estimateBarsBetween(a: Pivot, b: Pivot, timeframe: Timeframe): number {
  const ms = Math.max(1, b.ts - a.ts);
  const tfMs = timeframeToMs(timeframe);
  return Math.max(1, Math.round(ms / tfMs));
}
function timeframeToMs(timeframe: string): number {
  const tf = timeframe.toLowerCase().trim();
  if (tf === "1m") return 60_000;
  if (tf === "5m") return 5 * 60_000;
  if (tf === "15m") return 15 * 60_000;
  if (tf === "30m") return 30 * 60_000;
  if (tf === "1h") return 60 * 60_000;
  if (tf === "4h") return 4 * 60 * 60_000;
  if (tf.startsWith("1d") || tf === "d") return 24 * 60 * 60_000;
  if (tf.startsWith("1w") || tf === "w") return 7 * 24 * 60 * 60_000;
  return 60 * 60_000;
}
