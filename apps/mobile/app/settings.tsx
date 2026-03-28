/**
 * SettingsScreen (app/settings.tsx)
 *
 * Phase 3 settings:
 *   • Theme override toggle (System / Light / Dark)
 *   • Subscription tier badge + Upgrade / Manage buttons
 *   • Phase 3 feature links (Wave Scanner, Journal, Internals, etc.)
 *   • Sign out button
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Pressable,
  Switch,
} from 'react-native';
import { SafeAreaView }      from 'react-native-safe-area-context';
import { useNavigation }     from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme }          from '../theme/ThemeContext';
import { useThemeStore }     from '../stores/theme';
import { supabase }          from '../utils/supabase';
import { useSubscriptionStore } from '../stores/subscription';
import { useNotificationStore } from '../stores/notifications';

// Phase 3 navigation — uses the root stack
type Phase3Nav = {
  WaveScan:    undefined;
  Replay:      { instanceIdx: number; scanKey: string };
  Journal:     undefined;
  Internals:   undefined;
  DarkPool:    undefined;
  WaveGrid:    undefined;
  Earnings:    undefined;
  Correlation: undefined;
  Paywall:     { requiredTier?: 'pro' | 'elite' };
};
type Phase3StackParamList = Phase3Nav;

type ThemeOption = 'system' | 'light' | 'dark';
const THEME_OPTIONS: ThemeOption[] = ['system', 'light', 'dark'];
const THEME_LABELS: Record<ThemeOption, string> = {
  system: 'System',
  light:  'Light',
  dark:   'Dark',
};

const TIER_COLOR: Record<string, string> = {
  free:  '#6e7681',
  pro:   '#1d6fe8',
  elite: '#d97706',
};

const PHASE3_LINKS: Array<{
  label: string;
  screen: keyof Phase3StackParamList;
  reqTier: 'pro' | 'elite';
}> = [
  { label: 'Wave Scanner',        screen: 'WaveScan',    reqTier: 'pro' },
  { label: 'Trade Journal',       screen: 'Journal',     reqTier: 'pro' },
  { label: 'Market Internals',    screen: 'Internals',   reqTier: 'pro' },
  { label: 'Dark Pool Feed',      screen: 'DarkPool',    reqTier: 'pro' },
  { label: 'Wave Grid',           screen: 'WaveGrid',    reqTier: 'pro' },
  { label: 'Earnings Vol Tool',   screen: 'Earnings',    reqTier: 'pro' },
  { label: 'Correlation Matrix',  screen: 'Correlation', reqTier: 'pro' },
  { label: 'Setup Replay Mode',   screen: 'Replay',      reqTier: 'elite' },
];

export function SettingsScreen() {
  const theme    = useTheme();
  const override = useThemeStore((s) => s.override);
  const setOverride = useThemeStore((s) => s.setOverride);
  const tier = useSubscriptionStore((s) => s.tier);
  const navigation = useNavigation<NativeStackNavigationProp<Phase3StackParamList>>();
  const waveAlertsEnabled    = useNotificationStore((s) => s.waveAlertsEnabled);
  const setWaveAlertsEnabled = useNotificationStore((s) => s.setWaveAlertsEnabled);

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

  const navigate = useCallback((screen: keyof Phase3StackParamList, requiredTier: 'pro' | 'elite') => {
    const tierOrder: Record<string, number> = { free: 0, pro: 1, elite: 2 };
    if ((tierOrder[tier] ?? 0) < (tierOrder[requiredTier] ?? 1)) {
      navigation.navigate('Paywall', { requiredTier });
      return;
    }
    if (screen === 'Replay') {
      navigation.navigate('WaveScan');
      return;
    }
    // @ts-expect-error — params not needed for these screens
    navigation.navigate(screen);
  }, [tier, navigation]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <Text style={[styles.header, { color: theme.textPrimary }]}>Settings</Text>

        {/* Subscription */}
        <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>SUBSCRIPTION</Text>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.tierRow}>
            <View style={[styles.tierBadge, { borderColor: TIER_COLOR[tier] }]}>
              <Text style={[styles.tierText, { color: TIER_COLOR[tier] }]}>{tier.toUpperCase()}</Text>
            </View>
            {tier === 'free' && (
              <Pressable
                style={styles.upgradeBtn}
                onPress={() => navigation.navigate('Paywall', {})}
              >
                <Text style={styles.upgradeBtnText}>Upgrade →</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Phase 3 features */}
        <Text style={[styles.sectionLabel, { color: theme.textMuted, marginTop: 24 }]}>PHASE 3 FEATURES</Text>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {PHASE3_LINKS.map(({ label, screen, reqTier }, i) => {
            const tierOrder: Record<string, number> = { free: 0, pro: 1, elite: 2 };
            const locked = (tierOrder[tier] ?? 0) < (tierOrder[reqTier] ?? 1);
            return (
              <Pressable
                key={screen}
                style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]}
                onPress={() => navigate(screen, reqTier)}
              >
                <Text style={[styles.rowLabel, { color: locked ? theme.textMuted : theme.textPrimary }]}>
                  {locked ? '🔒 ' : ''}{label}
                </Text>
                <Text style={[styles.tierTag, { color: TIER_COLOR[reqTier] }]}>
                  {reqTier.toUpperCase()} →
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Notifications section */}
        <Text style={[styles.sectionLabel, { color: theme.textMuted, marginTop: 24 }]}>NOTIFICATIONS</Text>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Wave Completion Alerts</Text>
              <Text style={[styles.rowSub, { color: theme.textMuted }]}>
                Notify when wave 5, wave 3 peak, or invalidation detected
              </Text>
            </View>
            <Switch
              value={waveAlertsEnabled}
              onValueChange={setWaveAlertsEnabled}
              trackColor={{ true: '#1d4ed8', false: theme.border }}
              thumbColor={waveAlertsEnabled ? '#ffffff' : theme.textMuted}
            />
          </View>
        </View>

        {/* Theme section */}
        <Text style={[styles.sectionLabel, { color: theme.textMuted, marginTop: 24 }]}>APPEARANCE</Text>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.rowLabel, { color: theme.textPrimary, paddingHorizontal: 16, paddingTop: 14 }]}>Color Theme</Text>
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
        <Text style={[styles.sectionLabel, { color: theme.textMuted, marginTop: 24 }]}>ACCOUNT</Text>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <TouchableOpacity style={styles.row} onPress={handleSignOut} activeOpacity={0.7}>
            <Text style={[styles.rowLabel, { color: theme.bearish }]}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        {/* Version */}
        <Text style={[styles.version, { color: theme.textMuted }]}>
          Elliott Wave Pro · Phase 3
        </Text>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flex:              1,
    paddingHorizontal: 16,
    paddingTop:        16,
  },
  header: {
    fontSize:     24,
    fontWeight:   '700',
    marginBottom: 24,
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
    marginBottom: 4,
  },
  rowLabel: {
    fontSize:   15,
    fontWeight: '400',
    flex:       1,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical:   13,
    flexDirection:     'row',
    alignItems:        'center',
  },
  tierRow: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 16,
    paddingVertical:   12,
  },
  tierBadge: {
    borderWidth:       1,
    borderRadius:      4,
    paddingHorizontal: 10,
    paddingVertical:   3,
  },
  tierText:  { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  upgradeBtn:     { backgroundColor: '#1d4ed8', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 6 },
  upgradeBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  tierTag:        { fontSize: 10, fontWeight: '700' },
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
    textAlign:    'center',
    fontSize:     12,
    paddingBottom: 8,
  },
  rowSub: {
    fontSize:  12,
    marginTop: 2,
  },
});
