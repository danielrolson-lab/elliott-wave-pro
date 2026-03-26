/**
 * App.tsx — Elliott Wave Pro entry point
 */

import 'react-native-gesture-handler'; // must be first import
import './global.css';                 // NativeWind v4 base styles
import React from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from './theme/ThemeContext';
import { AppNavigator }            from './navigation/AppNavigator';

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
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  );
}
