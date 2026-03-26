/**
 * stores/theme.ts
 *
 * Manual theme override: 'light' | 'dark' | 'system'.
 * Persisted to MMKV so the user's choice survives restarts.
 */

import { create } from 'zustand';
import { MMKV } from 'react-native-mmkv';

type ThemeOverride = 'light' | 'dark' | 'system';

const mmkv = new MMKV({ id: 'theme-prefs' });

function loadOverride(): ThemeOverride {
  const stored = mmkv.getString('override');
  if (stored === 'light' || stored === 'dark') return stored;
  return 'system';
}

export interface ThemeStoreState {
  override:    ThemeOverride;
  setOverride: (v: ThemeOverride) => void;
}

export const useThemeStore = create<ThemeStoreState>()((set) => ({
  override: loadOverride(),

  setOverride: (v) => {
    mmkv.set('override', v);
    set({ override: v });
  },
}));
