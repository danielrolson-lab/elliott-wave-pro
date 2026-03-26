/**
 * SettingsScreen (app/settings.tsx)
 *
 * Phase 1 settings:
 *   • Theme override toggle (System / Light / Dark)
 *   • Sign out button
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { useThemeStore } from '../stores/theme';
import { supabase } from '../utils/supabase';

type ThemeOption = 'system' | 'light' | 'dark';
const THEME_OPTIONS: ThemeOption[] = ['system', 'light', 'dark'];
const THEME_LABELS: Record<ThemeOption, string> = {
  system: 'System',
  light:  'Light',
  dark:   'Dark',
};

export function SettingsScreen() {
  const theme    = useTheme();
  const override = useThemeStore((s) => s.override);
  const setOverride = useThemeStore((s) => s.setOverride);

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.content}>

        {/* Header */}
        <Text style={[styles.header, { color: theme.textPrimary }]}>Settings</Text>

        {/* Theme section */}
        <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>APPEARANCE</Text>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Color Theme</Text>
          <View style={[styles.segmentControl, { backgroundColor: theme.surfaceRaised }]}>
            {THEME_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[
                  styles.segment,
                  override === opt && { backgroundColor: theme.accent },
                ]}
                onPress={() => setOverride(opt)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: override === opt ? theme.accentText : theme.textSecondary },
                  ]}
                >
                  {THEME_LABELS[opt]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Account section */}
        <Text style={[styles.sectionLabel, { color: theme.textMuted, marginTop: 28 }]}>ACCOUNT</Text>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <TouchableOpacity style={styles.row} onPress={handleSignOut} activeOpacity={0.7}>
            <Text style={[styles.rowLabel, { color: theme.bearish }]}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* Version */}
        <Text style={[styles.version, { color: theme.textMuted }]}>
          Elliott Wave Pro · Phase 1
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  content: {
    flex:              1,
    paddingHorizontal: 16,
    paddingTop:        16,
  },
  header: {
    fontSize:     24,
    fontWeight:   '700',
    marginBottom: 28,
  },
  sectionLabel: {
    fontSize:      11,
    fontWeight:    '600',
    letterSpacing: 1,
    marginBottom:  8,
  },
  card: {
    borderRadius: 10,
    borderWidth:  1,
    overflow:     'hidden',
  },
  rowLabel: {
    fontSize:  15,
    fontWeight: '400',
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical:   14,
  },
  segmentControl: {
    flexDirection: 'row',
    borderRadius:  8,
    margin:        12,
    padding:       3,
  },
  segment: {
    flex:           1,
    paddingVertical: 7,
    alignItems:     'center',
    borderRadius:   6,
  },
  segmentText: {
    fontSize:   13,
    fontWeight: '500',
  },
  version: {
    textAlign:  'center',
    fontSize:   12,
    marginTop:  'auto',
    paddingBottom: 20,
  },
});
