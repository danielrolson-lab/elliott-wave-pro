/**
 * hooks/useVoiceCommand.ts
 *
 * Voice command engine using expo-av for recording and expo-speech for TTS.
 * Uses keyword matching (no LLM) for sub-200ms command recognition latency.
 *
 * Recording flow:
 *   1. User taps mic → startListening()
 *   2. Audio captured via expo-av Audio.Recording
 *   3. After stopListening(), send audio URI to device speech API (Web Speech
 *      polyfill pattern) — on React Native we use a simplified keyword-pattern
 *      approach via a mock transcription for demo; production wires to a
 *      Whisper endpoint or on-device ASR.
 *   4. matchCommand() maps transcript to a VoiceCommand enum.
 *   5. Consumer executes the command.
 *
 * Note: expo-av and expo-speech are declared as optional peer deps so tsc
 * passes without native linking. The module is guarded with try/catch.
 */

import { useState, useCallback, useRef } from 'react';

export type VoiceCommand =
  | { type: 'SHOW_CHART';      ticker: string; timeframe: string }
  | { type: 'SHOW_WAVE_COUNT' }
  | { type: 'SHOW_WAVE_LABELS' }
  | { type: 'HIDE_WAVE_LABELS' }
  | { type: 'SHOW_FIBONACCI' }
  | { type: 'HIDE_FIBONACCI' }
  | { type: 'SWITCH_DARK_MODE' }
  | { type: 'SWITCH_LIGHT_MODE' }
  | { type: 'OPEN_OPTIONS_CHAIN' }
  | { type: 'SHOW_PUT_WALL' }
  | { type: 'SHOW_CALL_WALL' }
  | { type: 'UNKNOWN';         transcript: string };

export interface VoiceCommandState {
  listening:   boolean;
  transcript:  string | null;
  command:     VoiceCommand | null;
  error:       string | null;
}

// ── Keyword matching ───────────────────────────────────────────────────────────

const TIMEFRAME_MAP: Record<string, string> = {
  'one minute': '1m', '1 minute': '1m', 'one m': '1m',
  'five minute': '5m', '5 minute': '5m', 'five m': '5m',
  'fifteen minute': '15m', '15 minute': '15m',
  'thirty minute': '30m', '30 minute': '30m',
  'one hour': '1h', '1 hour': '1h', 'hourly': '1h',
  'four hour': '4h', '4 hour': '4h',
  'daily': '1D', 'day': '1D', 'one day': '1D',
  'weekly': '1W', 'week': '1W',
};

const TICKER_PATTERN = /\b([A-Z]{1,5}|spy|qqq|iwm|aapl|tsla|nvda|amzn|msft|goog|meta)\b/i;

export function matchCommand(raw: string): VoiceCommand {
  const text = raw.toLowerCase().trim();

  // show [timeframe] chart for [ticker]
  if (text.includes('chart')) {
    const tickerMatch = text.match(TICKER_PATTERN);
    const ticker = tickerMatch ? tickerMatch[1].toUpperCase() : 'SPY';
    let timeframe = '5m';
    for (const [kw, tf] of Object.entries(TIMEFRAME_MAP)) {
      if (text.includes(kw)) { timeframe = tf; break; }
    }
    return { type: 'SHOW_CHART', ticker, timeframe };
  }

  // wave count
  if (text.includes('wave count') || text.includes('primary wave')) {
    return { type: 'SHOW_WAVE_COUNT' };
  }

  // wave labels
  if (text.includes('hide') && text.includes('wave')) return { type: 'HIDE_WAVE_LABELS' };
  if (text.includes('show') && text.includes('wave')) return { type: 'SHOW_WAVE_LABELS' };

  // fibonacci
  if (text.includes('hide') && text.includes('fib')) return { type: 'HIDE_FIBONACCI' };
  if (text.includes('show') && text.includes('fib')) return { type: 'SHOW_FIBONACCI' };

  // theme
  if (text.includes('dark mode')) return { type: 'SWITCH_DARK_MODE' };
  if (text.includes('light mode')) return { type: 'SWITCH_LIGHT_MODE' };

  // options
  if (text.includes('options chain')) return { type: 'OPEN_OPTIONS_CHAIN' };

  // gex walls
  if (text.includes('put wall')) return { type: 'SHOW_PUT_WALL' };
  if (text.includes('call wall')) return { type: 'SHOW_CALL_WALL' };

  return { type: 'UNKNOWN', transcript: raw };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useVoiceCommand(onCommand: (cmd: VoiceCommand) => void) {
  const [state, setState] = useState<VoiceCommandState>({
    listening:  false,
    transcript: null,
    command:    null,
    error:      null,
  });

  const recordingRef = useRef<unknown>(null);
  const isListening  = useRef(false);

  const startListening = useCallback(async () => {
    if (isListening.current) return;
    isListening.current = true;

    setState({ listening: true, transcript: null, command: null, error: null });

    try {
      // expo-av is a native module — guarded with try/catch for environments
      // where it may not be linked yet (CI, storybook, etc.)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Audio } = require('expo-av') as typeof import('expo-av');
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
    } catch (err) {
      setState((s) => ({ ...s, listening: false, error: String(err) }));
      isListening.current = false;
    }
  }, []);

  const stopListening = useCallback(async () => {
    if (!isListening.current) return;
    isListening.current = false;

    setState((s) => ({ ...s, listening: false }));

    try {
      if (recordingRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Audio } = require('expo-av') as typeof import('expo-av');
        const rec = recordingRef.current as InstanceType<typeof Audio.Recording>;
        await rec.stopAndUnloadAsync();
        // In production: send rec.getURI() to Whisper or on-device ASR.
        // For demo/offline: acknowledge recording with placeholder.
        recordingRef.current = null;
      }

      // Placeholder transcript — in production replace with ASR API result
      const mockTranscript = 'show five minute chart for SPY';
      const cmd = matchCommand(mockTranscript);

      setState((s) => ({ ...s, transcript: mockTranscript, command: cmd }));
      onCommand(cmd);
    } catch (err) {
      setState((s) => ({ ...s, error: String(err) }));
    }
  }, [onCommand]);

  const reset = useCallback(() => {
    setState({ listening: false, transcript: null, command: null, error: null });
  }, []);

  return { state, startListening, stopListening, reset };
}
