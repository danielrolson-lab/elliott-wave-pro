/**
 * components/voice/VoiceCommandHandler.tsx
 *
 * Microphone button for the chart header that activates voice command mode.
 *
 * UI states:
 *   idle      → microphone icon button
 *   listening → pulsing red dot + "Listening…" + tap-to-stop
 *   recognized→ shows transcript text for 1.5s before executing
 *   error     → brief error toast
 *
 * Commands supported:
 *   "show me the [timeframe] chart for [ticker]"
 *   "what is the primary wave count"
 *   "show/hide wave labels"
 *   "show/hide fibonacci"
 *   "switch to dark/light mode"
 *   "open options chain"
 *   "what is the put/call wall"
 */

import React, { useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated,
} from 'react-native';
import { useVoiceCommand, type VoiceCommand } from '../../hooks/useVoiceCommand';
import { useThemeStore } from '../../stores/theme';
import { DARK } from '../../theme/colors';

interface Props {
  onShowChart?:       (ticker: string, timeframe: string) => void;
  onToggleWaveLabels?: (show: boolean) => void;
  onToggleFibonacci?:  (show: boolean) => void;
  onOpenOptions?:     () => void;
}

function commandLabel(cmd: VoiceCommand): string {
  switch (cmd.type) {
    case 'SHOW_CHART':       return `Chart: ${cmd.ticker} ${cmd.timeframe}`;
    case 'SHOW_WAVE_COUNT':  return 'Primary wave count';
    case 'SHOW_WAVE_LABELS': return 'Show wave labels';
    case 'HIDE_WAVE_LABELS': return 'Hide wave labels';
    case 'SHOW_FIBONACCI':   return 'Show Fibonacci';
    case 'HIDE_FIBONACCI':   return 'Hide Fibonacci';
    case 'SWITCH_DARK_MODE': return 'Dark mode';
    case 'SWITCH_LIGHT_MODE':return 'Light mode';
    case 'OPEN_OPTIONS_CHAIN':return 'Open options chain';
    case 'SHOW_PUT_WALL':    return 'Put wall';
    case 'SHOW_CALL_WALL':   return 'Call wall';
    case 'UNKNOWN':          return `"${cmd.transcript}"`;
  }
}

export function VoiceCommandHandler({
  onShowChart,
  onToggleWaveLabels,
  onToggleFibonacci,
  onOpenOptions,
}: Props) {
  const setOverride = useThemeStore((s) => s.setOverride);
  const pulseAnim   = useRef(new Animated.Value(1)).current;
  const clearRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCommand = (cmd: VoiceCommand) => {
    switch (cmd.type) {
      case 'SHOW_CHART':
        onShowChart?.(cmd.ticker, cmd.timeframe);
        break;
      case 'SHOW_WAVE_LABELS':
        onToggleWaveLabels?.(true);
        break;
      case 'HIDE_WAVE_LABELS':
        onToggleWaveLabels?.(false);
        break;
      case 'SHOW_FIBONACCI':
        onToggleFibonacci?.(true);
        break;
      case 'HIDE_FIBONACCI':
        onToggleFibonacci?.(false);
        break;
      case 'SWITCH_DARK_MODE':
        setOverride('dark');
        break;
      case 'SWITCH_LIGHT_MODE':
        setOverride('light');
        break;
      case 'OPEN_OPTIONS_CHAIN':
        onOpenOptions?.();
        break;
      default:
        break;
    }
    // Auto-clear transcript after 1.5s
    if (clearRef.current) clearTimeout(clearRef.current);
    clearRef.current = setTimeout(reset, 1500);
  };

  const { state, startListening, stopListening, reset } = useVoiceCommand(handleCommand);

  // Pulse animation while listening
  useEffect(() => {
    if (state.listening) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.4, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 600, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
      return undefined;
    }
  }, [state.listening, pulseAnim]);

  const handlePress = () => {
    if (state.listening) {
      void stopListening();
    } else {
      void startListening();
    }
  };

  return (
    <View style={styles.wrapper}>
      {/* Transcript / status text */}
      {(state.listening || state.transcript) && (
        <View style={styles.statusBubble}>
          <Text style={styles.statusText} numberOfLines={1}>
            {state.listening
              ? 'Listening…'
              : state.command
              ? commandLabel(state.command)
              : state.transcript ?? ''}
          </Text>
        </View>
      )}

      {/* Microphone button */}
      <Pressable onPress={handlePress} hitSlop={8} style={styles.micBtn}>
        <Animated.View
          style={[
            styles.micInner,
            state.listening && styles.micInnerActive,
            { transform: [{ scale: pulseAnim }] },
          ]}
        >
          <Text style={[styles.micIcon, state.listening && styles.micIconActive]}>
            {state.listening ? '●' : '🎤'}
          </Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  statusBubble: {
    backgroundColor:   DARK.surfaceRaised,
    borderRadius:      10,
    paddingHorizontal: 8,
    paddingVertical:   4,
    maxWidth:          180,
    borderWidth:       1,
    borderColor:       DARK.border,
  },
  statusText: {
    color:    DARK.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
  micBtn: {
    padding: 4,
  },
  micInner: {
    width:           34,
    height:          34,
    borderRadius:    17,
    backgroundColor: DARK.surface,
    borderWidth:     1,
    borderColor:     DARK.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  micInnerActive: {
    backgroundColor: '#dc2626',
    borderColor:     '#dc2626',
  },
  micIcon: {
    fontSize: 15,
  },
  micIconActive: {
    color:    '#fff',
    fontSize: 12,
  },
});
