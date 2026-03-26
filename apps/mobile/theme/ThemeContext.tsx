/**
 * theme/ThemeContext.tsx
 *
 * Provides the active ThemeColors to the component tree.
 *
 * Resolution order (highest priority first):
 *   1. Manual override stored in MMKV ('light' | 'dark')
 *   2. System color scheme from useColorScheme()
 *   3. Dark (fallback)
 *
 * Usage:
 *   const theme = useTheme();
 *   <View style={{ backgroundColor: theme.background }} />
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { MMKV } from 'react-native-mmkv';
import { useThemeStore } from '../stores/theme';
import { DARK, LIGHT, type ThemeColors } from './colors';

const mmkv = new MMKV({ id: 'theme-prefs' });

const ThemeContext = createContext<ThemeColors>(DARK);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme  = useColorScheme();        // 'light' | 'dark' | null
  const override      = useThemeStore((s) => s.override); // 'light' | 'dark' | 'system'

  const colors = useMemo((): ThemeColors => {
    const resolved =
      override === 'system'
        ? (systemScheme ?? 'dark')
        : override;
    return resolved === 'light' ? LIGHT : DARK;
  }, [systemScheme, override]);

  // Keep MMKV in sync for native modules that can't read context
  useMemo(() => {
    mmkv.set('resolved-scheme', colors === LIGHT ? 'light' : 'dark');
  }, [colors]);

  return (
    <ThemeContext.Provider value={colors}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Returns the active theme token set. */
export function useTheme(): ThemeColors {
  return useContext(ThemeContext);
}
