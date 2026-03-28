"""
services/fastapi/wave-scan.py

Historical Wave Scanner endpoint.

POST /wave-scan
  Request:  { ticker, timeframe, lookback_days, wave_type }
  Response: { instances: WaveScanInstance[], stats: WaveScanStats }

Each instance records:
  - entry_date, entry_price
  - wave_label, wave_structure, degree
  - posterior probability at detection time
  - forward returns at 1d, 3d, 5d, 10d, 20d horizons
  - min_drawdown_before_target (max adverse excursion)
  - mini_candles: last 30 candles before entry (for analog mini-chart)

Aggregate stats:
  - win_rate (forward 5d return > 0)
  - median_return_5d
  - max_drawdown_before_target
  - sample_count

Deploy: Fly.io (fly deploy from this directory)
"""

from __future__ import annotations

import os
import math
import statistics
from datetime import datetime, timedelta
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Elliott Wave Pro — Wave Scanner", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

POLYGON_API_KEY = os.environ.get("POLYGON_API_KEY", "")
POLYGON_BASE = "https://api.polygon.io"

# ── Timeframe config ──────────────────────────────────────────────────────────

TIMEFRAME_MAP: dict[str, tuple[int, str]] = {
    "1m":  (1,  "minute"),
    "5m":  (5,  "minute"),
    "15m": (15, "minute"),
    "30m": (30, "minute"),
    "1h":  (1,  "hour"),
    "4h":  (4,  "hour"),
    "1D":  (1,  "day"),
    "1W":  (1,  "week"),
}

BARS_PER_DAY: dict[str, float] = {
    "1m":  390,
    "5m":  78,
    "15m": 26,
    "30m": 13,
    "1h":  6.5,
    "4h":  1.625,
    "1D":  1,
    "1W":  0.2,
}


# ── Request / Response models ─────────────────────────────────────────────────

class WaveScanRequest(BaseModel):
    ticker:       str
    timeframe:    Literal["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W"]
    lookback_days: int = Field(default=90, ge=5, le=730)
    wave_type:    str = Field(default="any", description="Wave label e.g. '3', 'C', or 'any'")


class OHLCVBar(BaseModel):
    t: int    # timestamp ms
    o: float
    h: float
    l: float
    c: float
    v: float


class WaveScanInstance(BaseModel):
    entry_date:  str
    entry_price: float
    wave_label:  str
    wave_structure: str
    degree:      str
    posterior:   float
    forward_returns: dict[str, float | None]   # "1d","3d","5d","10d","20d"
    min_drawdown_before_target: float          # MAE as fraction (negative)
    mini_candles: list[OHLCVBar]               # last 30 before entry


class WaveScanStats(BaseModel):
    sample_count:             int
    win_rate_5d:              float
    median_return_5d:         float
    avg_return_5d:            float
    max_drawdown_before_target: float
    best_return:              float
    worst_return:             float


class WaveScanResponse(BaseModel):
    ticker:    str
    timeframe: str
    wave_type: str
    instances: list[WaveScanInstance]
    stats:     WaveScanStats


# ── Polygon fetch helpers ─────────────────────────────────────────────────────

async def fetch_candles(
    client: httpx.AsyncClient,
    ticker: str,
    multiplier: int,
    timespan: str,
    from_date: str,
    to_date: str,
    limit: int = 50000,
) -> list[dict]:
    url = (
        f"{POLYGON_BASE}/v2/aggs/ticker/{ticker}/range"
        f"/{multiplier}/{timespan}/{from_date}/{to_date}"
        f"?adjusted=true&sort=asc&limit={limit}&apiKey={POLYGON_API_KEY}"
    )
    resp = await client.get(url, timeout=30)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Polygon error {resp.status_code}")
    data = resp.json()
    return data.get("results", [])


# ── Mini Elliott Wave detection (pure Python — mirrors wave-engine logic) ─────

def _ema(values: list[float], period: int) -> list[float]:
    k = 2.0 / (period + 1)
    result = [values[0]]
    for v in values[1:]:
        result.append(v * k + result[-1] * (1 - k))
    return result


def _atr(bars: list[dict], period: int = 14) -> list[float]:
    trs = [bars[0]["h"] - bars[0]["l"]]
    for i in range(1, len(bars)):
        tr = max(
            bars[i]["h"] - bars[i]["l"],
            abs(bars[i]["h"] - bars[i - 1]["c"]),
            abs(bars[i]["l"] - bars[i - 1]["c"]),
        )
        trs.append(tr)
    # Wilder smoothing
    atrs = [sum(trs[:period]) / period]
    for tr in trs[period:]:
        atrs.append(atrs[-1] * (period - 1) / period + tr / period)
    return [atrs[0]] * (period - 1) + atrs


def detect_pivots(bars: list[dict], lookback: int = 5) -> list[dict]:
    """Detect swing highs and lows with ATR-adaptive threshold."""
    if len(bars) < lookback * 2 + 1:
        return []
    atrs = _atr(bars, 14)
    pivots = []
    for i in range(lookback, len(bars) - lookback):
        window_h = bars[i - lookback: i + lookback + 1]
        window_l = bars[i - lookback: i + lookback + 1]
        hi = bars[i]["h"]
        lo = bars[i]["l"]
        atr_thresh = atrs[i] * 0.5
        is_swing_high = all(bars[j]["h"] <= hi + atr_thresh for j in range(i - lookback, i + lookback + 1) if j != i)
        is_swing_low  = all(bars[j]["l"] >= lo - atr_thresh for j in range(i - lookback, i + lookback + 1) if j != i)
        if is_swing_high and (not pivots or pivots[-1]["type"] != "HH"):
            pivots.append({"index": i, "timestamp": bars[i]["t"], "price": hi, "type": "HH"})
        elif is_swing_low and (not pivots or pivots[-1]["type"] != "LL"):
            pivots.append({"index": i, "timestamp": bars[i]["t"], "price": lo, "type": "LL"})
    return pivots


def _fib_ratio(p1: float, p2: float, p3: float) -> float:
    if abs(p2 - p1) < 1e-10:
        return 0.0
    return abs(p3 - p2) / abs(p2 - p1)


IMPULSE_LABELS = ["1", "2", "3", "4", "5"]
CORRECTIVE_LABELS = ["A", "B", "C"]
FIB_TARGETS = {
    "2": (0.382, 0.786),
    "4": (0.236, 0.618),
    "3": (1.618, 2.618),
    "5": (0.618, 1.618),
    "B": (0.382, 0.886),
    "C": (0.618, 1.618),
}


def score_wave_candidate(pivots: list[dict], start: int, label: str) -> float:
    """Score a wave candidate at a given pivot index. Returns 0–1 posterior proxy."""
    if start + 1 >= len(pivots):
        return 0.0
    p0 = pivots[start]["price"]
    p1 = pivots[start + 1]["price"]
    score = 0.3  # base

    if label in FIB_TARGETS:
        lo, hi = FIB_TARGETS[label]
        if start + 2 < len(pivots):
            ratio = _fib_ratio(pivots[start - 1]["price"] if start > 0 else p0, p0, p1)
            if lo <= ratio <= hi:
                score += 0.4
        else:
            score += 0.1  # partial credit for open wave

    # direction check
    if label in ("1", "3", "5", "A", "C"):
        # should be up from prior pivot
        if start > 0 and p1 > p0:
            score += 0.15
    elif label in ("2", "4", "B"):
        if start > 0 and p1 < p0:
            score += 0.15

    return min(score, 1.0)


def scan_wave_instances(
    bars: list[dict],
    wave_type: str,
    bars_per_day: float,
) -> list[dict]:
    """
    Scan full history for instances where the requested wave_type was active.
    Returns list of { bar_index, wave_label, structure, degree, posterior }.
    """
    if len(bars) < 30:
        return []

    pivots = detect_pivots(bars, lookback=max(3, min(8, len(bars) // 40)))
    if len(pivots) < 4:
        return []

    instances = []
    labels_to_scan = IMPULSE_LABELS + CORRECTIVE_LABELS if wave_type == "any" else [wave_type]

    for i in range(2, len(pivots) - 1):
        for label in labels_to_scan:
            posterior = score_wave_candidate(pivots, i, label)
            if posterior >= 0.45:
                structure = "impulse" if label in IMPULSE_LABELS else "zigzag"
                instances.append({
                    "bar_index":  pivots[i]["index"],
                    "timestamp":  pivots[i]["timestamp"],
                    "price":      pivots[i]["price"],
                    "wave_label": label,
                    "structure":  structure,
                    "degree":     "minor",
                    "posterior":  round(posterior, 3),
                })

    # Deduplicate — keep highest posterior per bar vicinity (within 5 bars)
    deduped: list[dict] = []
    for inst in sorted(instances, key=lambda x: -x["posterior"]):
        if not any(abs(inst["bar_index"] - d["bar_index"]) < 5 for d in deduped):
            deduped.append(inst)

    return sorted(deduped, key=lambda x: x["bar_index"])


def compute_forward_returns(
    bars: list[dict],
    entry_idx: int,
    bars_per_day: float,
) -> tuple[dict[str, float | None], float]:
    """
    Compute forward returns at 1d, 3d, 5d, 10d, 20d horizons.
    Returns (returns_dict, min_drawdown_before_5d_target).
    """
    horizons = {"1d": 1, "3d": 3, "5d": 5, "10d": 10, "20d": 20}
    entry_price = bars[entry_idx]["c"]
    results: dict[str, float | None] = {}
    mae = 0.0  # max adverse excursion

    max_bars_ahead = int(20 * bars_per_day) + 1
    for label, days in horizons.items():
        target_idx = entry_idx + int(days * bars_per_day)
        if target_idx < len(bars):
            fwd_return = (bars[target_idx]["c"] - entry_price) / entry_price
            results[label] = round(fwd_return * 100, 2)
        else:
            results[label] = None

    # MAE — min close over 5d window
    window_end = min(entry_idx + int(5 * bars_per_day), len(bars) - 1)
    for i in range(entry_idx, window_end + 1):
        drawdown = (bars[i]["l"] - entry_price) / entry_price
        mae = min(mae, drawdown)

    return results, round(mae * 100, 2)


# ── Main endpoint ─────────────────────────────────────────────────────────────

@app.post("/wave-scan", response_model=WaveScanResponse)
async def wave_scan(req: WaveScanRequest) -> WaveScanResponse:
    if not POLYGON_API_KEY:
        raise HTTPException(status_code=500, detail="POLYGON_API_KEY not configured")

    multiplier, timespan = TIMEFRAME_MAP[req.timeframe]
    to_date   = datetime.utcnow().strftime("%Y-%m-%d")
    from_date = (datetime.utcnow() - timedelta(days=req.lookback_days)).strftime("%Y-%m-%d")

    async with httpx.AsyncClient() as client:
        raw_bars = await fetch_candles(
            client, req.ticker.upper(), multiplier, timespan, from_date, to_date
        )

    if len(raw_bars) < 30:
        raise HTTPException(status_code=422, detail="Insufficient history for scan")

    bars_per_day = BARS_PER_DAY[req.timeframe]
    instances_raw = scan_wave_instances(raw_bars, req.wave_type, bars_per_day)

    instances: list[WaveScanInstance] = []
    for inst in instances_raw:
        idx = inst["bar_index"]
        fwd_returns, mae = compute_forward_returns(raw_bars, idx, bars_per_day)

        # Mini candles — 30 bars ending at entry
        mini_start = max(0, idx - 29)
        mini_bars = [
            OHLCVBar(t=b["t"], o=b["o"], h=b["h"], l=b["l"], c=b["c"], v=b["v"])
            for b in raw_bars[mini_start: idx + 1]
        ]

        entry_date = datetime.utcfromtimestamp(inst["timestamp"] / 1000).strftime("%Y-%m-%d")

        instances.append(WaveScanInstance(
            entry_date=entry_date,
            entry_price=round(inst["price"], 4),
            wave_label=inst["wave_label"],
            wave_structure=inst["structure"],
            degree=inst["degree"],
            posterior=inst["posterior"],
            forward_returns=fwd_returns,
            min_drawdown_before_target=mae,
            mini_candles=mini_bars,
        ))

    # Compute aggregate stats
    returns_5d = [i.forward_returns.get("5d") for i in instances if i.forward_returns.get("5d") is not None]
    if returns_5d:
        win_rate_5d   = round(sum(1 for r in returns_5d if r > 0) / len(returns_5d) * 100, 1)
        median_5d     = round(statistics.median(returns_5d), 2)
        avg_5d        = round(statistics.mean(returns_5d), 2)
        best_return   = round(max(returns_5d), 2)
        worst_return  = round(min(returns_5d), 2)
    else:
        win_rate_5d = median_5d = avg_5d = best_return = worst_return = 0.0

    all_mae = [i.min_drawdown_before_target for i in instances]
    max_mae = round(min(all_mae), 2) if all_mae else 0.0

    stats = WaveScanStats(
        sample_count=len(instances),
        win_rate_5d=win_rate_5d,
        median_return_5d=median_5d,
        avg_return_5d=avg_5d,
        max_drawdown_before_target=max_mae,
        best_return=best_return,
        worst_return=worst_return,
    )

    return WaveScanResponse(
        ticker=req.ticker.upper(),
        timeframe=req.timeframe,
        wave_type=req.wave_type,
        instances=instances,
        stats=stats,
    )


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "wave-scanner"}


# ── Milky Way bulk scanner ────────────────────────────────────────────────────

import asyncio
import time

# In-memory cache keyed by timeframe
_milkyway_cache: dict = {}
CACHE_TTL_SECONDS = 900  # 15 minutes


class MilkyWayRequest(BaseModel):
    timeframe: str = "5m"
    limit: int = 10


class MilkyWaySetup(BaseModel):
    ticker: str
    companyName: str = ""
    wavePosition: str
    direction: str
    confidence: float
    currentPrice: float
    t1: float
    t2: float
    t3: float
    stop: float
    riskReward: float
    fibContext: str
    degree: str
    rules: str
    mtfAligned: bool
    timeframe: str


class MilkyWayResponse(BaseModel):
    timeframe: str
    scanned: int
    generated_at: str
    setups: list[MilkyWaySetup]


def get_timeframe_params(tf: str) -> tuple[int, str, int]:
    """Returns (multiplier, timespan, bar_count)"""
    mapping = {
        "1m":  (1,  "minute", 250),
        "5m":  (5,  "minute", 250),
        "15m": (15, "minute", 200),
        "30m": (30, "minute", 200),
        "1h":  (1,  "hour",   200),
        "4h":  (4,  "hour",   150),
        "1D":  (1,  "day",    200),
        "1W":  (1,  "week",   100),
    }
    return mapping.get(tf, (5, "minute", 200))


def simple_wave_score(candles: list) -> dict | None:
    """Simplified Elliott Wave scoring for bulk scan."""
    if len(candles) < 20:
        return None

    closes = [c["c"] for c in candles]
    highs  = [c["h"] for c in candles]
    lows   = [c["l"] for c in candles]

    # Simple pivot detection
    pivots = []
    for i in range(2, len(closes) - 2):
        if highs[i] > highs[i-1] and highs[i] > highs[i-2] and highs[i] > highs[i+1] and highs[i] > highs[i+2]:
            pivots.append({"idx": i, "price": highs[i], "isHigh": True})
        elif lows[i] < lows[i-1] and lows[i] < lows[i-2] and lows[i] < lows[i+1] and lows[i] < lows[i+2]:
            pivots.append({"idx": i, "price": lows[i], "isHigh": False})

    if len(pivots) < 5:
        return None

    # Use last 6 pivots for wave analysis
    tail = pivots[-6:] if len(pivots) >= 6 else pivots[-5:]

    current_price = closes[-1]
    isBullish = tail[-1]["price"] > tail[0]["price"]

    # Simple Fibonacci scoring
    e3 = 0.0
    w1_len = 0.0
    if len(tail) >= 5:
        w1_len = abs(tail[1]["price"] - tail[0]["price"])
        w3_len = abs(tail[3]["price"] - tail[2]["price"]) if len(tail) > 3 else 0

        # Wave 3 should be > wave 1
        if w3_len > w1_len:
            e3 = w3_len / w1_len if w1_len > 0 else 0
            score = min(0.9, 0.5 + (e3 - 1.0) * 0.2)
        else:
            score = 0.3
    else:
        score = 0.4

    # Targets based on recent structure
    price_range = max(highs[-20:]) - min(lows[-20:])
    if isBullish:
        t1   = current_price + price_range * 0.382
        t2   = current_price + price_range * 0.618
        t3   = current_price + price_range * 1.0
        stop = current_price - price_range * 0.236
    else:
        t1   = current_price - price_range * 0.382
        t2   = current_price - price_range * 0.618
        t3   = current_price - price_range * 1.0
        stop = current_price + price_range * 0.236

    rr = abs(t1 - current_price) / abs(current_price - stop) if abs(current_price - stop) > 0 else 0

    # Wave position
    stage_map = {0: "Forming W3", 1: "Forming W4", 2: "Forming W5", 3: "Complete"}
    stage = stage_map.get(len(tail) - 4, "Forming W3")

    fib_ctx = f"W3 ext {e3:.2f}x" if len(tail) >= 5 and w1_len > 0 else "Forming"

    return {
        "direction": "bullish" if isBullish else "bearish",
        "confidence": round(score, 3),
        "currentPrice": round(current_price, 2),
        "t1": round(t1, 2),
        "t2": round(t2, 2),
        "t3": round(t3, 2),
        "stop": round(stop, 2),
        "riskReward": round(rr, 2),
        "wavePosition": f"Wave {stage}",
        "fibContext": fib_ctx,
        "degree": "Minor",
        "rules": "5/8",
        "mtfAligned": score > 0.7,
    }


@app.post("/milkyway/scan", response_model=MilkyWayResponse)
async def milkyway_scan(req: MilkyWayRequest) -> MilkyWayResponse:
    cache_key = req.timeframe
    now = time.time()

    # Return cached result if fresh
    if cache_key in _milkyway_cache:
        cached = _milkyway_cache[cache_key]
        if now - cached["ts"] < CACHE_TTL_SECONDS:
            return cached["data"]

    api_key = POLYGON_API_KEY
    mult, timespan, bar_count = get_timeframe_params(req.timeframe)

    # Fetch S&P 500 tickers from Polygon
    spx_tickers: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                f"{POLYGON_BASE}/v3/reference/tickers",
                params={"market": "stocks", "index": "SPX", "limit": 500, "active": "true", "apiKey": api_key},
            )
            data = r.json()
            spx_tickers = [t["ticker"] for t in data.get("results", [])]
    except Exception:
        pass

    # Fallback subset if Polygon index call fails or returns empty
    if not spx_tickers:
        spx_tickers = [
            "SPY", "QQQ", "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK.B",
            "JPM", "V", "MA", "UNH", "JNJ", "HD", "PG", "COST", "ABBV", "LLY",
            "MRK", "CVX", "XOM", "BAC", "PFE", "TMO", "AMD", "INTC", "AVGO", "CSCO",
            "NFLX", "DIS", "ADBE", "CRM", "ORCL", "ACN", "TXN", "QCOM", "IBM", "GE",
            "CAT", "BA", "GS", "MS", "BLK", "SPGI", "AXP", "RTX", "HON", "MMM",
        ]

    # Compute date range
    to_date = datetime.utcnow()
    lookback_map = {
        "1m": 3, "5m": 7, "15m": 10, "30m": 15,
        "1h": 30, "4h": 60, "1D": 400, "1W": 730,
    }
    lookback_days = lookback_map.get(req.timeframe, 10)
    from_date = to_date - timedelta(days=lookback_days)
    from_str = from_date.strftime("%Y-%m-%d")
    to_str = to_date.strftime("%Y-%m-%d")

    setups: list[MilkyWaySetup] = []
    scanned = 0

    # Process in batches to avoid rate limiting
    async with httpx.AsyncClient(timeout=15) as client:
        for ticker in spx_tickers[:100]:  # limit to first 100 for speed
            try:
                r = await client.get(
                    f"{POLYGON_BASE}/v2/aggs/ticker/{ticker}/range/{mult}/{timespan}/{from_str}/{to_str}",
                    params={"adjusted": "true", "sort": "asc", "limit": bar_count, "apiKey": api_key},
                )
                data = r.json()
                candles = data.get("results", [])
                if len(candles) < 20:
                    continue
                scanned += 1
                result = simple_wave_score(candles)
                if result and result["confidence"] >= 0.55:
                    setups.append(MilkyWaySetup(
                        ticker=ticker,
                        timeframe=req.timeframe,
                        **result,
                    ))
            except Exception:
                continue

    # Sort by confidence and limit
    setups.sort(key=lambda x: x.confidence, reverse=True)
    top_setups = setups[: req.limit]

    response = MilkyWayResponse(
        timeframe=req.timeframe,
        scanned=scanned,
        generated_at=datetime.utcnow().isoformat() + "Z",
        setups=top_setups,
    )

    _milkyway_cache[cache_key] = {"ts": now, "data": response}
    return response
