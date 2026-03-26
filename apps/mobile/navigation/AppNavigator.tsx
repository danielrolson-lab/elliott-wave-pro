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
 *   Flow       → FlowScreen  (placeholder)
 *   Settings   → SettingsScreen
 */

import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer }     from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen }      from '../app/index';
import { WatchlistScreen } from '../app/watchlist';
import { ChartScreen }     from '../app/chart';
import { FlowScreen }      from '../app/flow';
import { AuthScreen }      from '../app/auth';
import { SettingsScreen }  from '../app/settings';
import { supabase }        from '../utils/supabase';
import { useAuthStore }    from '../stores/auth';
import { useTheme }        from '../theme/ThemeContext';
import { useAlertEngine }  from '../hooks/useAlertEngine';

// ── Param lists ───────────────────────────────────────────────────────────────

export type ChartStackParamList = {
  ChartMain:    undefined;
  TickerDetail: { ticker: string; name: string };
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

// ── Placeholder screen ────────────────────────────────────────────────────────

// FlowScreen will be implemented in D5 (options flow feed)

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

// ── Root navigator ────────────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<RootTabParamList>();

export function AppNavigator() {
  const theme   = useTheme();
  const session = useAuthStore((s) => s.session);
  const loading = useAuthStore((s) => s.loading);
  const { setSession, setLoading } = useAuthStore();

  // Start alert evaluation engine for the lifetime of the app
  useAlertEngine();

  // Bootstrap: resolve persisted session + subscribe to future changes
  useEffect(() => {
    // Get the session from MMKV-backed Supabase storage (synchronous on device)
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    }).catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown:            false,
            tabBarStyle:            { backgroundColor: theme.surface, borderTopColor: theme.separator, borderTopWidth: 1, height: 56, paddingBottom: 6 },
            tabBarActiveTintColor:  theme.textPrimary,
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
