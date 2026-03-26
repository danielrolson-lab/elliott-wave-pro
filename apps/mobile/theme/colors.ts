/**
 * theme/colors.ts
 *
 * Design-token sets for dark and light themes.
 *
 * Rules:
 *   • Dark  background: #000000 — true OLED black (saves battery on AMOLED)
 *   • Light background: #FFFFFF
 *   • Separator lines:  #1e293b (dark) / #e2e8f0 (light)
 *   • Bullish:  #22c55e  (green-500)
 *   • Bearish:  #ef4444  (red-500)
 *   • Neutral:  #f59e0b  (amber-500)
 *
 * Chart-specific rendering colors (Skia) live in chartTypes.ts and are
 * intentionally kept dark-only in Phase 1 — trading canvases are always dark.
 */

export interface ThemeColors {
  // Backgrounds
  background:    string;
  surface:       string;   // cards, inputs, modals
  surfaceRaised: string;   // elevated cards

  // Separators / borders
  separator:     string;
  border:        string;

  // Text
  textPrimary:   string;
  textSecondary: string;
  textMuted:     string;

  // Interactive
  accent:        string;   // primary CTA — blue
  accentText:    string;   // text on accent background

  // Semantic
  bullish:       string;
  bearish:       string;
  neutral:       string;

  // Status
  statusBar:     'light-content' | 'dark-content';
}

export const DARK: ThemeColors = {
  background:    '#000000',
  surface:       '#0d1117',
  surfaceRaised: '#161b22',

  separator:     '#1e293b',
  border:        '#30363d',

  textPrimary:   '#e6edf3',
  textSecondary: '#8b949e',
  textMuted:     '#6e7681',

  accent:        '#1d6fe8',
  accentText:    '#ffffff',

  bullish:       '#22c55e',
  bearish:       '#ef4444',
  neutral:       '#f59e0b',

  statusBar:     'light-content',
};

export const LIGHT: ThemeColors = {
  background:    '#ffffff',
  surface:       '#f8fafc',
  surfaceRaised: '#f1f5f9',

  separator:     '#e2e8f0',
  border:        '#cbd5e1',

  textPrimary:   '#0f172a',
  textSecondary: '#475569',
  textMuted:     '#94a3b8',

  accent:        '#1d6fe8',
  accentText:    '#ffffff',

  bullish:       '#22c55e',
  bearish:       '#ef4444',
  neutral:       '#f59e0b',

  statusBar:     'dark-content',
};
