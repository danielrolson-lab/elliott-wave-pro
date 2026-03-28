import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface MilkyWaySetup {
  ticker:       string;
  companyName:  string;
  wavePosition: string;
  direction:    'bullish' | 'bearish';
  confidence:   number;
  currentPrice: number;
  t1:           number;
  t2:           number;
  t3:           number;
  stop:         number;
  riskReward:   number;
  fibContext:   string;
  degree:       string;
  rules:        string;
  mtfAligned:   boolean;
  timeframe:    string;
}

export interface MilkyWayResult {
  timeframe:    string;
  scanned:      number;
  generatedAt:  string;
  setups:       MilkyWaySetup[];
}

export type MilkyWayScanStatus = 'idle' | 'loading' | 'success' | 'error';

interface MilkyWayState {
  results:      Partial<Record<string, MilkyWayResult>>; // keyed by timeframe
  status:       Partial<Record<string, MilkyWayScanStatus>>;
  error:        Partial<Record<string, string>>;

  setResult:    (tf: string, result: MilkyWayResult) => void;
  setStatus:    (tf: string, status: MilkyWayScanStatus) => void;
  setError:     (tf: string, err: string) => void;
}

export const useMilkyWayStore = create<MilkyWayState>()(
  immer((set) => ({
    results: {},
    status: {},
    error: {},

    setResult: (tf, result) => set((s) => { s.results[tf] = result; s.status[tf] = 'success'; }),
    setStatus: (tf, status) => set((s) => { s.status[tf] = status; }),
    setError:  (tf, err) => set((s) => { s.error[tf] = err; s.status[tf] = 'error'; }),
  })),
);
