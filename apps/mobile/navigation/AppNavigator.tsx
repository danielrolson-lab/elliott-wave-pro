/**
 * AppNavigator.tsx
 *
 * Root navigation shell with auth gating.
 *
 * Flow:
 *   • On mount, resolves the Supabase session from MMKV (instant — no network).
 *   • onAuthStateChange keeps the session in sync during the app lifetime.
 *   • No session  → AuthStack (single AuthScreen)
 *   • Has session → MainTabs (5-tab bottom navigator)
 *
 * MainTabs:
 *   Home       → HomeScreen
 *   Watchlist  → WatchlistScreen
 *   Chart      → ChartStack (NativeStack with ChartMain + TickerDetail)
 *   Flow       → FlowScreen
 *   Settings   → SettingsScreen (+ Phase 3 screen links)
 *
 * Phase 3 screens (accessible from Settings / modal stack):
 *   WaveScan, Replay, Journal, Internals, DarkPool, WaveGrid,
 *   Earnings, Correlation, Paywall
 */

import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer }     from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen }           from '../app/index';
import { WatchlistScreen }      from '../app/watchlist';
import { ChartScreen }          from '../app/chart';
import { FlowScreen }           from '../app/flow';
import { AuthScreen }           from '../app/auth';
import { SettingsScreen }       from '../app/settings';
import { WaveScanScreen }       from '../app/wave-scan';
import { ReplayScreen }         from '../app/replay';
import { JournalScreen }        from '../app/journal';
import { InternalsScreen }      from '../app/internals';
import { DarkPoolScreen }       from '../app/darkpool';
import { WaveGridScreen }       from '../app/wave-grid';
import { EarningsScreen }       from '../app/earnings';
import { CorrelationScreen }    from '../app/correlation';
import { AlertDetailScreen }    from '../app/alert-detail';
import { PaywallScreen }        from '../components/paywall/PaywallScreen';
import { supabase }             from '../utils/supabase';
import { useAuthStore }         from '../stores/auth';
import { useTheme }             from '../theme/ThemeContext';
import { useAlertEngine }       from '../hooks/useAlertEngine';
import { useRevenueCat }        from '../hooks/useRevenueCat';
import { useWatchlistPrices }   from '../hooks/useWatchlistPrices';

// ── Param lists ───────────────────────────────────────────────────────────────

export type ChartStackParamList = {
  ChartMain:    undefined;
  TickerDetail: { ticker: string; name: string };
};

export type ScanStackParamList = {
  WaveScan: undefined;
  Replay:   { instanceIdx: number; scanKey: string };
};

export type AuthStackParamList = {
  Auth: undefined;
};

export type RootTabParamList = {
  Home:      undefined;
  Watchlist: undefined;
  Chart:     undefined;
  Flow:      undefined;
  Settings:  undefined;
};

// Phase 3 modal/stack param list (pushed from Settings or deep links)
export type Phase3StackParamList = {
  WaveScan:    undefined;
  Replay:      { instanceIdx: number; scanKey: string };
  Journal:     undefined;
  Internals:   undefined;
  DarkPool:    undefined;
  WaveGrid:    undefined;
  Earnings:    undefined;
  Correlation: undefined;
  AlertDetail: { alertId: string };
  Paywall:     { requiredTier?: 'pro' | 'elite' };
};

// ── Loading screen ────────────────────────────────────────────────────────────

function LoadingScreen() {
  const theme = useTheme();
  return (
    <View style={[placeholderStyles.root, { backgroundColor: theme.background }]}>
      <ActivityIndicator color={theme.accent} size="large" />
    </View>
  );
}

// ── Chart stack ───────────────────────────────────────────────────────────────

const ChartStack = createNativeStackNavigator<ChartStackParamList>();

function ChartNavigator() {
  const theme = useTheme();
  return (
    <ChartStack.Navigator
      screenOptions={{
        headerStyle:      { backgroundColor: theme.surface },
        headerTintColor:  theme.textPrimary,
        headerTitleStyle: { color: theme.textPrimary, fontWeight: '600' },
        contentStyle:     { backgroundColor: theme.background },
      }}
    >
      <ChartStack.Screen
        name="ChartMain"
        component={ChartScreen}
        options={{ title: 'Chart', headerShown: false }}
      />
    </ChartStack.Navigator>
  );
}

// ── Auth stack ────────────────────────────────────────────────────────────────

const AuthStack = createNativeStackNavigator<AuthStackParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Auth" component={AuthScreen} />
    </AuthStack.Navigator>
  );
}

// ── Tab icons (Unicode glyphs — replace with icon library in Phase 2) ─────────

const TAB_ICONS: Record<string, string> = {
  Home:      '⌂',
  Watchlist: '☆',
  Chart:     '▤',
  Flow:      '⟳',
  Settings:  '⚙',
};

// ── Tab navigator ─────────────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<RootTabParamList>();

function MainTabs() {
  const theme = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown:             false,
        tabBarStyle:             { backgroundColor: theme.surface, borderTopColor: theme.separator, borderTopWidth: 1, height: 56, paddingBottom: 6 },
        tabBarActiveTintColor:   theme.textPrimary,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarIcon: ({ focused }) => (
          <Text style={{ fontSize: 18, color: focused ? theme.textPrimary : theme.textMuted }}>
            {TAB_ICONS[route.name] ?? '?'}
          </Text>
        ),
      })}
    >
      <Tab.Screen name="Home"      component={HomeScreen} />
      <Tab.Screen name="Watchlist" component={WatchlistScreen} />
      <Tab.Screen name="Chart"     component={ChartNavigator} />
      <Tab.Screen name="Flow"      component={FlowScreen} />
      <Tab.Screen name="Settings"  component={SettingsScreen} />
    </Tab.Navigator>
  );
}

// ── Root stack (tabs + Phase 3 screens pushed on top) ────────────────────────

type RootStackParamList = Phase3StackParamList & { MainTabs: undefined };
const RootStack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  const theme = useTheme();
  const screenOptions = {
    headerStyle:      { backgroundColor: theme.surface },
    headerTintColor:  theme.textPrimary,
    headerTitleStyle: { color: theme.textPrimary, fontWeight: '600' as const },
    contentStyle:     { backgroundColor: theme.background },
  };
  return (
    <RootStack.Navigator screenOptions={screenOptions}>
      <RootStack.Screen name="MainTabs"   component={MainTabs}         options={{ headerShown: false }} />
      <RootStack.Screen name="WaveScan"   component={WaveScanScreen}   options={{ title: 'Wave Scanner' }} />
      <RootStack.Screen name="Replay"     component={ReplayScreen}     options={{ title: 'Replay' }} />
      <RootStack.Screen name="Journal"    component={JournalScreen}    options={{ title: 'Trade Journal' }} />
      <RootStack.Screen name="Internals"  component={InternalsScreen}  options={{ title: 'Market Internals' }} />
      <RootStack.Screen name="DarkPool"   component={DarkPoolScreen}   options={{ title: 'Dark Pool' }} />
      <RootStack.Screen name="WaveGrid"   component={WaveGridScreen}   options={{ title: 'Wave Grid' }} />
      <RootStack.Screen name="Earnings"   component={EarningsScreen}   options={{ title: 'Earnings Vol' }} />
      <RootStack.Screen name="Correlation"  component={CorrelationScreen}  options={{ title: 'Correlations' }} />
      <RootStack.Screen name="AlertDetail" component={AlertDetailScreen} options={{ title: 'Alert Detail' }} />
      <RootStack.Screen
        name="Paywall"
        options={{ title: 'Upgrade', presentation: 'modal' }}
      >
        {({ route, navigation }: { route: { params: { requiredTier?: 'pro' | 'elite' } }; navigation: { goBack: () => void } }) => (
          <PaywallScreen
            requiredTier={route.params?.requiredTier}
            onDismiss={() => navigation.goBack()}
          />
        )}
      </RootStack.Screen>
    </RootStack.Navigator>
  );
}

// ── Root navigator ────────────────────────────────────────────────────────────

export function AppNavigator() {
  const session = useAuthStore((s) => s.session);
  const loading = useAuthStore((s) => s.loading);

  // Start alert evaluation engine for the lifetime of the app
  useAlertEngine();

  // Initialize RevenueCat + sync subscription tier
  useRevenueCat();

  // Fetch previous-day prices + sparkline data for all watchlist tickers
  useWatchlistPrices();

  // Bootstrap: resolve persisted session + subscribe to future changes.
  // Uses useAuthStore.getState() instead of hook-destructured actions to avoid
  // calling set() during Supabase's synchronous INITIAL_SESSION firing, which
  // happens mid-useEffect before NavigationContainer's context chain is ready.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      try {
        useAuthStore.getState().setSession(data.session);
        useAuthStore.getState().setLoading(false);
      } catch (_e) {
        // store not yet ready — safe to ignore, loading stays true until next event
      }
    }).catch(() => {
      try { useAuthStore.getState().setLoading(false); } catch (_e) {}
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      try {
        useAuthStore.getState().setSession(newSession);
        useAuthStore.getState().setLoading(false);
      } catch (_e) {
        // store not yet ready
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <NavigationContainer>
        <LoadingScreen />
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer>
      {session === null ? (
        <AuthNavigator />
      ) : (
        <RootNavigator />
      )}
    </NavigationContainer>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const placeholderStyles = StyleSheet.create({
  root: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 16,
  },
});
