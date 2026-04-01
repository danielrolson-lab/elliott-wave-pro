/**
 * App.tsx — Elliott Wave Pro entry point
 */

import 'react-native-gesture-handler'; // must be first import
import './global.css';                 // NativeWind v4 base styles
import React from 'react';
import { StatusBar, Text, View, ScrollView } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from './theme/ThemeContext';
import { AppNavigator }            from './navigation/AppNavigator';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message + '\n\n' + e.stack };
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, padding: 40, paddingTop: 80, backgroundColor: '#000' }}>
          <ScrollView>
            <Text style={{ color: '#ff4444', fontSize: 13, fontFamily: 'monospace' }}>
              {this.state.error}
            </Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

function Root() {
  const theme = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar
        barStyle={theme.statusBar}
        backgroundColor={theme.background}
      />
      <AppNavigator />
    </GestureHandlerRootView>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ErrorBoundary>
          <Root />
        </ErrorBoundary>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
