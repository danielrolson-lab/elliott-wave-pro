/**
 * AuthScreen (app/auth.tsx)
 *
 * Sign in / Sign up with:
 *   • Email + password (toggle between sign-in and sign-up)
 *   • Apple Sign-In (iOS only — expo-apple-authentication)
 *   • Google OAuth (expo-web-browser + Supabase PKCE flow)
 *
 * On success the AppNavigator's onAuthStateChange listener detects the new
 * session and switches to the main tab navigator automatically.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from '../utils/supabase';
import { DARK } from '../theme/colors';

WebBrowser.maybeCompleteAuthSession();

// ── Google OAuth ──────────────────────────────────────────────────────────────

async function signInWithGoogle(): Promise<string | null> {
  const redirectTo = makeRedirectUri({ scheme: 'com.elliottwave.pro', path: 'auth/callback' });
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options:  { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data.url) return error?.message ?? 'Failed to start Google sign-in';

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return null; // cancelled — not an error

  // Exchange the code for a session
  const fragment = result.url.split('#')[1] ?? result.url.split('?')[1] ?? '';
  const { error: exchError } = await supabase.auth.exchangeCodeForSession(fragment);
  return exchError?.message ?? null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AuthScreen() {
  const [mode, setMode]   = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info,  setInfo]  = useState<string | null>(null);

  const clearFeedback = () => { setError(null); setInfo(null); };

  // ── Email/password ──────────────────────────────────────────────────────────

  async function handleEmailAuth() {
    clearFeedback();
    if (!email.trim() || !pass.trim()) {
      setError('Email and password are required.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass });
        if (e) setError(e.message);
      } else {
        const { error: e } = await supabase.auth.signUp({ email: email.trim(), password: pass });
        if (e) setError(e.message);
        else   setInfo('Check your email to confirm your account.');
      }
    } finally {
      setBusy(false);
    }
  }

  // ── Apple Sign-In ───────────────────────────────────────────────────────────

  async function handleApple() {
    clearFeedback();
    setBusy(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const { error: e } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token:    credential.identityToken ?? '',
      });
      if (e) setError(e.message);
    } catch (e: unknown) {
      // User cancelled — code is 'ERR_REQUEST_CANCELED'
      const err = e as { code?: string; message?: string };
      if (err.code !== 'ERR_REQUEST_CANCELED') {
        setError(err.message ?? 'Apple Sign-In failed');
      }
    } finally {
      setBusy(false);
    }
  }

  // ── Google OAuth ────────────────────────────────────────────────────────────

  async function handleGoogle() {
    clearFeedback();
    setBusy(true);
    try {
      const errMsg = await signInWithGoogle();
      if (errMsg) setError(errMsg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Logo / title */}
          <View style={styles.titleBlock}>
            <Text style={styles.logoText}>▲</Text>
            <Text style={styles.appName}>Elliott Wave Pro</Text>
            <Text style={styles.tagline}>Institutional-grade wave analysis</Text>
          </View>

          {/* Mode toggle */}
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'signin' && styles.modeBtnActive]}
              onPress={() => { setMode('signin'); clearFeedback(); }}
            >
              <Text style={[styles.modeBtnText, mode === 'signin' && styles.modeBtnTextActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'signup' && styles.modeBtnActive]}
              onPress={() => { setMode('signup'); clearFeedback(); }}
            >
              <Text style={[styles.modeBtnText, mode === 'signup' && styles.modeBtnTextActive]}>Sign Up</Text>
            </TouchableOpacity>
          </View>

          {/* Feedback */}
          {error !== null && <Text style={styles.errorText}>{error}</Text>}
          {info  !== null && <Text style={styles.infoText}>{info}</Text>}

          {/* Email */}
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor={DARK.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
          />

          {/* Password */}
          <TextInput
            style={styles.input}
            value={pass}
            onChangeText={setPass}
            placeholder="Password"
            placeholderTextColor={DARK.textMuted}
            secureTextEntry
            textContentType={mode === 'signup' ? 'newPassword' : 'password'}
          />

          {/* Email CTA */}
          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
            onPress={handleEmailAuth}
            disabled={busy}
            activeOpacity={0.8}
          >
            {busy
              ? <ActivityIndicator color="#FFF" />
              : <Text style={styles.primaryBtnText}>{mode === 'signin' ? 'Sign In' : 'Create Account'}</Text>
            }
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* Apple Sign-In (iOS only) */}
          {Platform.OS === 'ios' && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={8}
              style={styles.appleBtn}
              onPress={handleApple}
            />
          )}

          {/* Google OAuth */}
          <TouchableOpacity
            style={styles.oauthBtn}
            onPress={handleGoogle}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Text style={styles.oauthBtnText}>Continue with Google</Text>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex:            1,
    backgroundColor: DARK.background,
  },
  kav: {
    flex: 1,
  },
  scroll: {
    flexGrow:          1,
    paddingHorizontal: 28,
    paddingTop:        48,
    paddingBottom:     40,
  },
  titleBlock: {
    alignItems:   'center',
    marginBottom: 40,
    gap:          4,
  },
  logoText: {
    fontSize:   48,
    color:      DARK.bullish,
    lineHeight: 52,
  },
  appName: {
    color:      DARK.textPrimary,
    fontSize:   24,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  tagline: {
    color:    DARK.textMuted,
    fontSize: 13,
  },
  modeRow: {
    flexDirection:   'row',
    backgroundColor: DARK.surface,
    borderRadius:    8,
    padding:         3,
    marginBottom:    20,
  },
  modeBtn: {
    flex:           1,
    paddingVertical: 8,
    alignItems:     'center',
    borderRadius:   6,
  },
  modeBtnActive: {
    backgroundColor: DARK.accent,
  },
  modeBtnText: {
    color:      DARK.textMuted,
    fontSize:   14,
    fontWeight: '500',
  },
  modeBtnTextActive: {
    color: '#FFF',
  },
  errorText: {
    color:        DARK.bearish,
    fontSize:     13,
    marginBottom: 12,
    textAlign:    'center',
  },
  infoText: {
    color:        DARK.bullish,
    fontSize:     13,
    marginBottom: 12,
    textAlign:    'center',
  },
  input: {
    backgroundColor:   DARK.surface,
    borderRadius:      8,
    borderWidth:       1,
    borderColor:       DARK.separator,
    color:             DARK.textPrimary,
    fontSize:          15,
    paddingHorizontal: 14,
    paddingVertical:   12,
    marginBottom:      12,
  },
  primaryBtn: {
    backgroundColor: DARK.accent,
    borderRadius:    8,
    paddingVertical: 13,
    alignItems:      'center',
    marginBottom:    20,
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color:      '#FFF',
    fontSize:   15,
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection:  'row',
    alignItems:     'center',
    marginBottom:   20,
    gap:            10,
  },
  dividerLine: {
    flex:            1,
    height:          1,
    backgroundColor: DARK.separator,
  },
  dividerText: {
    color:    DARK.textMuted,
    fontSize: 12,
  },
  appleBtn: {
    height:       48,
    marginBottom: 12,
  },
  oauthBtn: {
    backgroundColor: DARK.surface,
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     DARK.separator,
    paddingVertical: 13,
    alignItems:      'center',
    marginBottom:    12,
  },
  oauthBtnText: {
    color:      DARK.textPrimary,
    fontSize:   15,
    fontWeight: '500',
  },
});
