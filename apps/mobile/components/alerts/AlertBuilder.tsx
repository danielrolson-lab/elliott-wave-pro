/**
 * AlertBuilder.tsx
 *
 * 3-condition compound alert builder.
 *
 * UI flow:
 *   1. Label text input
 *   2. Up to 3 conditions — each has:
 *        - ticker text input
 *        - condition type picker (price / wave / regime / GEX / IV rank / RSI)
 *        - threshold value (numeric)
 *   3. Delivery channels (push / webhook / telegram toggles)
 *   4. Webhook URL + Telegram bot token / chat ID (shown when enabled)
 *   5. "Create Alert" button → writes to alerts store
 *
 * All conditions are AND-gated.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
} from 'react-native';
import { useAlertsStore, type AlertConditionType, type AlertOutputChannel } from '../../stores/alerts';
import { DARK } from '../../theme/colors';

// ── Condition type options ────────────────────────────────────────────────────

const CONDITION_TYPES: { label: string; value: AlertConditionType }[] = [
  { label: 'Price Above',         value: 'price_above' },
  { label: 'Price Below',         value: 'price_below' },
  { label: 'Price Cross',         value: 'price_cross' },
  { label: 'RSI Above',           value: 'rsi_above' },
  { label: 'RSI Below',           value: 'rsi_below' },
  { label: 'IV Rank Above',       value: 'iv_rank_above' },
  { label: 'IV Rank Below',       value: 'iv_rank_below' },
  { label: 'Wave Probability ≥',  value: 'wave_scenario_probability' },
  { label: 'Scenario Flip',       value: 'scenario_flip' },
  { label: 'Regime Change',       value: 'regime_change' },
  { label: 'Near GEX Zero',       value: 'gex_regime_change' },
];

// ── Local condition form state ────────────────────────────────────────────────

interface ConditionForm {
  ticker: string;
  type:   AlertConditionType;
  value:  string;   // numeric string
}

const EMPTY_COND: ConditionForm = { ticker: 'SPY', type: 'price_above', value: '' };

// ── Component ─────────────────────────────────────────────────────────────────

interface AlertBuilderProps {
  onDismiss?: () => void;
}

export function AlertBuilder({ onDismiss }: AlertBuilderProps) {
  const addAlert = useAlertsStore((s) => s.addAlert);

  const [label,       setLabel]       = useState('');
  const [conditions,  setConditions]  = useState<ConditionForm[]>([{ ...EMPTY_COND }]);
  const [usePush,     setUsePush]     = useState(true);
  const [useWebhook,  setUseWebhook]  = useState(false);
  const [useTelegram, setUseTelegram] = useState(false);
  const [webhookUrl,  setWebhookUrl]  = useState('');
  const [tgToken,     setTgToken]     = useState('');
  const [tgChatId,    setTgChatId]    = useState('');
  const [error,       setError]       = useState('');

  // ── Condition helpers ───────────────────────────────────────────────────────

  const updateCond = (idx: number, patch: Partial<ConditionForm>) => {
    setConditions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, ...patch };
      return next;
    });
  };

  const addCondition = () => {
    if (conditions.length < 3) setConditions((prev) => [...prev, { ...EMPTY_COND }]);
  };

  const removeCond = (idx: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Create alert ────────────────────────────────────────────────────────────

  const handleCreate = () => {
    setError('');

    if (!label.trim()) { setError('Label is required.'); return; }
    if (conditions.length === 0) { setError('Add at least one condition.'); return; }
    for (const c of conditions) {
      if (!c.ticker.trim()) { setError('Ticker is required.'); return; }
      const v = parseFloat(c.value);
      if (c.type !== 'scenario_flip' && c.type !== 'regime_change' && c.type !== 'gex_regime_change' && isNaN(v)) {
        setError(`Invalid threshold for "${c.type}".`); return;
      }
    }
    if (useWebhook && !webhookUrl.trim()) { setError('Webhook URL is required.'); return; }
    if (useTelegram && (!tgToken.trim() || !tgChatId.trim())) {
      setError('Telegram bot token and chat ID are required.'); return;
    }

    const channels: AlertOutputChannel[] = ['in_app'];
    if (usePush)     channels.push('push');
    if (useWebhook)  channels.push('webhook');
    if (useTelegram) channels.push('telegram');

    addAlert({
      id:          `alert_${Date.now()}`,
      label:       label.trim(),
      conditions:  conditions.map((c) => ({
        type:   c.type,
        ticker: c.ticker.toUpperCase().trim(),
        value:  parseFloat(c.value) || 0,
      })),
      delivery: {
        channels,
        webhookUrl:       useWebhook  ? webhookUrl.trim()  : undefined,
        telegramBotToken: useTelegram ? tgToken.trim()     : undefined,
        telegramChatId:   useTelegram ? tgChatId.trim()    : undefined,
      },
      status:      'active',
      createdAt:   Date.now(),
      triggeredAt: null,
      expiresAt:   null,
    });

    onDismiss?.();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>New Compound Alert</Text>

      {/* Label */}
      <Text style={styles.label}>Label</Text>
      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. SPY breakout + bullish regime"
        placeholderTextColor={DARK.textMuted}
      />

      {/* Conditions */}
      <Text style={styles.sectionHead}>Conditions (AND logic)</Text>
      {conditions.map((cond, idx) => (
        <View key={idx} style={styles.condBlock}>
          <View style={styles.condRow}>
            <Text style={styles.condIdx}>{idx + 1}</Text>
            {conditions.length > 1 && (
              <Pressable onPress={() => removeCond(idx)} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>✕</Text>
              </Pressable>
            )}
          </View>

          <Text style={styles.label}>Ticker</Text>
          <TextInput
            style={[styles.input, styles.inputSm]}
            value={cond.ticker}
            onChangeText={(t) => updateCond(idx, { ticker: t.toUpperCase() })}
            autoCapitalize="characters"
            placeholder="SPY"
            placeholderTextColor={DARK.textMuted}
          />

          <Text style={styles.label}>Condition Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typePicker}>
            {CONDITION_TYPES.map((ct) => (
              <Pressable
                key={ct.value}
                style={[styles.typeChip, cond.type === ct.value && styles.typeChipActive]}
                onPress={() => updateCond(idx, { type: ct.value })}
              >
                <Text style={[styles.typeChipText, cond.type === ct.value && styles.typeChipTextActive]}>
                  {ct.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {cond.type !== 'scenario_flip' &&
           cond.type !== 'regime_change' &&
           cond.type !== 'gex_regime_change' && (
            <>
              <Text style={styles.label}>Threshold</Text>
              <TextInput
                style={[styles.input, styles.inputSm]}
                value={cond.value}
                onChangeText={(v) => updateCond(idx, { value: v })}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={DARK.textMuted}
              />
            </>
          )}
        </View>
      ))}

      {conditions.length < 3 && (
        <Pressable style={styles.addCondBtn} onPress={addCondition}>
          <Text style={styles.addCondBtnText}>+ Add Condition</Text>
        </Pressable>
      )}

      {/* Delivery channels */}
      <Text style={styles.sectionHead}>Delivery</Text>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Push Notification</Text>
        <Switch value={usePush} onValueChange={setUsePush} />
      </View>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Webhook POST</Text>
        <Switch value={useWebhook} onValueChange={setUseWebhook} />
      </View>
      {useWebhook && (
        <TextInput
          style={styles.input}
          value={webhookUrl}
          onChangeText={setWebhookUrl}
          placeholder="https://hooks.example.com/…"
          placeholderTextColor={DARK.textMuted}
          autoCapitalize="none"
          keyboardType="url"
        />
      )}

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Telegram Bot</Text>
        <Switch value={useTelegram} onValueChange={setUseTelegram} />
      </View>
      {useTelegram && (
        <>
          <TextInput
            style={styles.input}
            value={tgToken}
            onChangeText={setTgToken}
            placeholder="Bot token (123456:ABC-DEF…)"
            placeholderTextColor={DARK.textMuted}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            value={tgChatId}
            onChangeText={setTgChatId}
            placeholder="Chat ID (-100…)"
            placeholderTextColor={DARK.textMuted}
            keyboardType="numbers-and-punctuation"
          />
        </>
      )}

      {/* Error */}
      {!!error && <Text style={styles.errorText}>{error}</Text>}

      {/* Action buttons */}
      <View style={styles.actions}>
        {onDismiss && (
          <Pressable style={styles.cancelBtn} onPress={onDismiss}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        )}
        <Pressable style={styles.createBtn} onPress={handleCreate}>
          <Text style={styles.createBtnText}>Create Alert</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK.background },
  content:   { padding: 16, paddingBottom: 40 },

  heading:     { color: DARK.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 16 },
  sectionHead: { color: DARK.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 20, marginBottom: 8 },
  label:       { color: DARK.textMuted, fontSize: 11, marginBottom: 4, marginTop: 10 },

  input: {
    backgroundColor: DARK.surface,
    borderWidth:     1,
    borderColor:     DARK.border,
    borderRadius:    6,
    color:           DARK.textPrimary,
    fontSize:        13,
    paddingHorizontal: 10,
    paddingVertical:    8,
  },
  inputSm: { width: 120 },

  condBlock: {
    backgroundColor: DARK.surface,
    borderWidth:     1,
    borderColor:     DARK.border,
    borderRadius:    8,
    padding:         12,
    marginBottom:    10,
  },
  condRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  condIdx:    { color: DARK.textMuted, fontSize: 11, fontWeight: '700' },
  removeBtn:  { padding: 4 },
  removeBtnText: { color: DARK.bearish, fontSize: 14, fontWeight: '700' },

  typePicker: { marginVertical: 6 },
  typeChip: {
    paddingHorizontal: 10,
    paddingVertical:    5,
    borderRadius:      6,
    borderWidth:       1,
    borderColor:       DARK.border,
    marginRight:       6,
    backgroundColor:   DARK.background,
  },
  typeChipActive:     { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  typeChipText:       { color: DARK.textMuted, fontSize: 11 },
  typeChipTextActive: { color: '#fff', fontWeight: '600' },

  addCondBtn: {
    borderWidth:   1,
    borderColor:   DARK.border,
    borderRadius:  6,
    borderStyle:   'dashed',
    paddingVertical: 10,
    alignItems:    'center',
    marginBottom:  4,
  },
  addCondBtnText: { color: DARK.textSecondary, fontSize: 13 },

  switchRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  switchLabel: { color: DARK.textPrimary, fontSize: 13 },

  errorText: { color: DARK.bearish, fontSize: 12, marginTop: 8 },

  actions:       { flexDirection: 'row', gap: 10, marginTop: 24 },
  cancelBtn:     { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: DARK.border },
  cancelBtnText: { color: DARK.textSecondary, fontSize: 14, fontWeight: '600' },
  createBtn:     { flex: 2, paddingVertical: 12, alignItems: 'center', borderRadius: 8, backgroundColor: '#1d4ed8' },
  createBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
