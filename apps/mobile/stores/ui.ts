import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D' | '1W';

export type ChartType = 'candlestick' | 'heikin_ashi' | 'line' | 'area' | 'renko' | 'point_figure';

export type LayoutMode = 'portrait' | 'landscape' | 'ipad';

export type BottomTab = 'watchlist' | 'chart' | 'options' | 'alerts' | 'settings';

export interface OverlayConfig {
  ema9: boolean;
  ema21: boolean;
  ema50: boolean;
  ema200: boolean;
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  vwap: boolean;
  anchoredVwap: boolean;
  bollingerBands: boolean;
  bollingerSd: number;
  keltnerChannels: boolean;
  ichimoku: boolean;
  vpvr: boolean;
  elliottWaveLabels: boolean;
  showEWChannel:    boolean;   // independent toggle for channel lines
  showInvalidation: boolean;   // invalidation price line
  showWaveLabels:   boolean;   // wave number labels on pivots
  showWaveProjection: boolean; // projected wave zig-zag simulation
  fibRetracements: boolean;
  fibExtensions: boolean;
  fibTimeZones: boolean;
  gexLevels: boolean;
  priorDayLevels: boolean;
  priorWeekLevels: boolean;
  monthlyOpen: boolean;
  roundNumbers: boolean;
}

export interface SubIndicatorConfig {
  active: 'rsi' | 'macd' | 'volume' | 'atr' | 'stoch_rsi' | 'cvd' | 'oi_iv' | 'breadth';
}

export interface UIState {
  // Navigation
  activeTab: BottomTab;
  layoutMode: LayoutMode;

  // Chart settings
  activeTimeframe: Timeframe;
  chartType: ChartType;
  overlays: OverlayConfig;
  subIndicator: SubIndicatorConfig;

  // Chart interaction state
  crosshairVisible: boolean;
  crosshairTimestamp: number | null;
  isFullscreen: boolean;

  // Bottom sheets / modals
  overlaySheetVisible: boolean;
  scenarioSheetVisible: boolean;

  // Loading states
  isChartLoading: boolean;

  // Actions
  setActiveTab: (tab: BottomTab) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setActiveTimeframe: (tf: Timeframe) => void;
  setChartType: (type: ChartType) => void;
  toggleOverlay: (key: keyof OverlayConfig) => void;
  setOverlayValue: <K extends keyof OverlayConfig>(key: K, value: OverlayConfig[K]) => void;
  setSubIndicator: (indicator: SubIndicatorConfig['active']) => void;
  setCrosshair: (visible: boolean, timestamp?: number) => void;
  setFullscreen: (fullscreen: boolean) => void;
  setOverlaySheetVisible: (visible: boolean) => void;
  setScenarioSheetVisible: (visible: boolean) => void;
  setChartLoading: (loading: boolean) => void;
}

const DEFAULT_OVERLAYS: OverlayConfig = {
  ema9: false,
  ema21: true,
  ema50: true,
  ema200: false,
  sma20: false,
  sma50: false,
  sma200: false,
  vwap: true,
  anchoredVwap: false,
  bollingerBands: false,
  bollingerSd: 2.0,
  keltnerChannels: false,
  ichimoku: false,
  vpvr: true,
  elliottWaveLabels: true,
  showEWChannel:    false,
  showInvalidation: true,
  showWaveLabels:   true,
  showWaveProjection: true,
  fibRetracements: true,
  fibExtensions: true,
  fibTimeZones: false,
  gexLevels: true,
  priorDayLevels: true,
  priorWeekLevels: false,
  monthlyOpen: false,
  roundNumbers: false,
};

export const useUIStore = create<UIState>()(
  immer((set) => ({
    activeTab: 'watchlist',
    layoutMode: 'portrait',
    activeTimeframe: '1h',
    chartType: 'candlestick',
    overlays: DEFAULT_OVERLAYS,
    subIndicator: { active: 'rsi' },
    crosshairVisible: false,
    crosshairTimestamp: null,
    isFullscreen: false,
    overlaySheetVisible: false,
    scenarioSheetVisible: false,
    isChartLoading: false,

    setActiveTab: (tab) =>
      set((state) => {
        state.activeTab = tab;
      }),

    setLayoutMode: (mode) =>
      set((state) => {
        state.layoutMode = mode;
      }),

    setActiveTimeframe: (tf) =>
      set((state) => {
        state.activeTimeframe = tf;
      }),

    setChartType: (type) =>
      set((state) => {
        state.chartType = type;
      }),

    toggleOverlay: (key) =>
      set((state) => {
        const val = state.overlays[key];
        if (typeof val === 'boolean') {
          (state.overlays[key] as boolean) = !val;
        }
      }),

    setOverlayValue: (key, value) =>
      set((state) => {
        (state.overlays[key] as typeof value) = value;
      }),

    setSubIndicator: (indicator) =>
      set((state) => {
        state.subIndicator.active = indicator;
      }),

    setCrosshair: (visible, timestamp) =>
      set((state) => {
        state.crosshairVisible = visible;
        state.crosshairTimestamp = timestamp ?? null;
      }),

    setFullscreen: (fullscreen) =>
      set((state) => {
        state.isFullscreen = fullscreen;
      }),

    setOverlaySheetVisible: (visible) =>
      set((state) => {
        state.overlaySheetVisible = visible;
      }),

    setScenarioSheetVisible: (visible) =>
      set((state) => {
        state.scenarioSheetVisible = visible;
      }),

    setChartLoading: (loading) =>
      set((state) => {
        state.isChartLoading = loading;
      }),
  })),
);
