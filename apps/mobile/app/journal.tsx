/**
 * app/journal.tsx — Trade Journal screen
 *
 * Tabs:
 *   [Log Trade] — form to log a new trade; auto-populates from active chart state
 *   [History]   — all past trades with outcome badges
 *   [Analytics] — win rate by wave/regime, R distribution, equity curve, behavioral flags
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import {
  useJournalStore,
  computeAnalytics,
  type Direction,
  type InstrumentType,
  type EmotionalState,
  type JournalEntry,
} from '../stores/journal';
import { useWaveCountStore }  from '../stores/waveCount';
import { useMarketDataStore } from '../stores/marketData';
import { DARK } from '../theme/colors';

const ACTIVE_TICKER = 'SPY';
const ACTIVE_TF     = '5m';

// ── Pill selector ─────────────────────────────────────────────────────────────

function PillRow<T extends string>({
  options, selected, onSelect, label,
}: { options: readonly T[]; selected: T; onSelect: (v: T) => void; label: string }) {
  return (
    <View style={formStyles.field}>
      <Text style={formStyles.label}>{label}</Text>
      <View style={formStyles.pills}>
        {options.map((opt) => (
          <Pressable
            key={opt}
            style={[formStyles.pill, selected === opt && formStyles.pillActive]}
            onPress={() => onSelect(opt)}
          >
            <Text style={[formStyles.pillText, selected === opt && formStyles.pillTextActive]}>
              {opt}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const formStyles = StyleSheet.create({
  field:         { marginBottom: 10 },
  label:         { color: DARK.textMuted, fontSize: 11, marginBottom: 4 },
  pills:         { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: DARK.border },
  pillActive:    { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  pillText:      { color: DARK.textMuted, fontSize: 12 },
  pillTextActive: { color: '#fff' },
});

// ── Log form ──────────────────────────────────────────────────────────────────

function LogForm() {
  const { addEntry }    = useJournalStore();
  const waveKey         = `${ACTIVE_TICKER}_${ACTIVE_TF}`;
  const counts          = useWaveCountStore((s) => s.counts[waveKey] ?? []);
  const quote           = useMarketDataStore((s) => s.quotes[ACTIVE_TICKER]);

  const autoPrice = String(quote?.last ?? '');
  const autoWave  = counts[0]
    ? `Wave ${counts[0].currentWave?.label ?? '?'} (${counts[0].currentWave?.structure ?? ''})`
    : '';

  const [ticker,    setTicker]    = useState(ACTIVE_TICKER);
  const [direction, setDirection] = useState<Direction>('long');
  const [instrType, setInstrType] = useState<InstrumentType>('stock');
  const [entryP,    setEntryP]    = useState(autoPrice);
  const [stopP,     setStopP]     = useState('');
  const [targetP,   setTargetP]   = useState('');
  const [wave,      setWave]      = useState(autoWave);
  const [regime,    setRegime]    = useState('');
  const [emotional, setEmotional] = useState<EmotionalState>(3);
  const [notes,     setNotes]     = useState('');

  const riskReward = useMemo(() => {
    const e = parseFloat(entryP);
    const s = parseFloat(stopP);
    const t = parseFloat(targetP);
    if (!e || !s || !t) return null;
    const risk   = Math.abs(e - s);
    const reward = Math.abs(t - e);
    return risk > 0 ? Math.round(reward / risk * 10) / 10 : null;
  }, [entryP, stopP, targetP]);

  const handleLog = useCallback(() => {
    const e = parseFloat(entryP);
    const s = parseFloat(stopP);
    const t = parseFloat(targetP);
    if (!ticker || !e || !s || !t) {
      Alert.alert('Missing fields', 'Enter ticker, entry, stop, and target.');
      return;
    }
    addEntry({
      ticker:          ticker.toUpperCase(),
      direction,
      instrument_type: instrType,
      entry_price:     e,
      stop_price:      s,
      target_price:    t,
      active_wave:     wave,
      market_regime:   regime,
      gex_level:       '',
      iv_rank:         0,
      entry_date:      new Date().toISOString(),
      exit_price:      null,
      exit_date:       null,
      notes,
      emotional_state: emotional,
      outcome:         'open',
      pnl_r:           null,
      pnl_pct:         null,
    });
    setNotes('');
    Alert.alert('Logged', `${ticker.toUpperCase()} ${direction} trade logged.`);
  }, [ticker, direction, instrType, entryP, stopP, targetP, wave, regime, emotional, notes, addEntry]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={logStyles.scroll} showsVerticalScrollIndicator={false}>
        <View style={logStyles.container}>
          <View style={formStyles.field}>
            <Text style={formStyles.label}>TICKER</Text>
            <TextInput
              style={logStyles.input}
              value={ticker}
              onChangeText={(v) => setTicker(v.toUpperCase())}
              autoCapitalize="characters"
              placeholderTextColor={DARK.textMuted}
            />
          </View>

          <PillRow
            options={['long', 'short'] as const}
            selected={direction}
            onSelect={setDirection}
            label="DIRECTION"
          />

          <PillRow
            options={['stock', 'option_call', 'option_put', 'futures', 'etf', 'crypto'] as const}
            selected={instrType}
            onSelect={setInstrType}
            label="INSTRUMENT"
          />

          {/* Price inputs */}
          <View style={logStyles.priceRow}>
            {[
              { label: 'ENTRY', value: entryP,  setter: setEntryP },
              { label: 'STOP',  value: stopP,   setter: setStopP },
              { label: 'TARGET',value: targetP, setter: setTargetP },
            ].map(({ label, value, setter }) => (
              <View key={label} style={logStyles.priceField}>
                <Text style={formStyles.label}>{label}</Text>
                <TextInput
                  style={logStyles.priceInput}
                  value={value}
                  onChangeText={setter}
                  keyboardType="decimal-pad"
                  placeholderTextColor={DARK.textMuted}
                  placeholder="0.00"
                />
              </View>
            ))}
          </View>

          {riskReward !== null && (
            <Text style={logStyles.rrText}>R/R: 1:{riskReward}</Text>
          )}

          <View style={formStyles.field}>
            <Text style={formStyles.label}>WAVE (auto-filled)</Text>
            <TextInput
              style={logStyles.input}
              value={wave}
              onChangeText={setWave}
              placeholderTextColor={DARK.textMuted}
              placeholder="e.g. Wave 3 (impulse)"
            />
          </View>

          <View style={formStyles.field}>
            <Text style={formStyles.label}>REGIME</Text>
            <TextInput
              style={logStyles.input}
              value={regime}
              onChangeText={setRegime}
              placeholderTextColor={DARK.textMuted}
              placeholder="e.g. STRONG_TREND_UP"
            />
          </View>

          <View style={formStyles.field}>
            <Text style={formStyles.label}>EMOTIONAL STATE (1=fear  5=confident)</Text>
            <View style={formStyles.pills}>
              {([1, 2, 3, 4, 5] as EmotionalState[]).map((v) => (
                <Pressable
                  key={v}
                  style={[formStyles.pill, emotional === v && formStyles.pillActive]}
                  onPress={() => setEmotional(v)}
                >
                  <Text style={[formStyles.pillText, emotional === v && formStyles.pillTextActive]}>
                    {v}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={formStyles.field}>
            <Text style={formStyles.label}>NOTES</Text>
            <TextInput
              style={[logStyles.input, { height: 72, textAlignVertical: 'top' }]}
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholderTextColor={DARK.textMuted}
              placeholder="Setup reasoning, news catalyst…"
            />
          </View>

          <Pressable style={logStyles.logBtn} onPress={handleLog}>
            <Text style={logStyles.logBtnText}>Log Trade</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const logStyles = StyleSheet.create({
  scroll:    { maxHeight: '100%' },
  container: { padding: 16 },
  input: {
    backgroundColor: DARK.surface,
    borderColor:     DARK.border,
    borderWidth:     1,
    borderRadius:    6,
    color:           DARK.textPrimary,
    paddingHorizontal: 10,
    paddingVertical:   8,
    fontSize:          14,
  },
  priceRow:  { flexDirection: 'row', gap: 8, marginBottom: 4 },
  priceField: { flex: 1 },
  priceInput: {
    backgroundColor: DARK.surface,
    borderColor:     DARK.border,
    borderWidth:     1,
    borderRadius:    6,
    color:           DARK.textPrimary,
    paddingHorizontal: 8,
    paddingVertical:   8,
    fontSize:          13,
    textAlign:         'right',
  },
  rrText: {
    color:        '#60a5fa',
    fontSize:     12,
    marginBottom: 10,
    alignSelf:    'flex-end',
  },
  logBtn: {
    backgroundColor: '#1d6fe8',
    borderRadius:    8,
    paddingVertical: 12,
    alignItems:      'center',
    marginTop:       4,
  },
  logBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

// ── History tab ───────────────────────────────────────────────────────────────

const OUTCOME_COLOR: Record<string, string> = {
  win:       '#22c55e',
  loss:      '#ef4444',
  breakeven: '#f59e0b',
  open:      '#60a5fa',
};

function HistoryRow({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  const rColor = (entry.pnl_r ?? 0) >= 0 ? DARK.bullish : DARK.bearish;
  return (
    <View style={histStyles.row}>
      <View style={histStyles.left}>
        <Text style={histStyles.ticker}>{entry.ticker}</Text>
        <Text style={histStyles.date}>{entry.entry_date.slice(0, 10)}</Text>
        <Text style={histStyles.wave}>{entry.active_wave}</Text>
      </View>
      <View style={histStyles.mid}>
        <Text style={histStyles.dir}>{entry.direction.toUpperCase()}</Text>
        <Text style={histStyles.instr}>{entry.instrument_type}</Text>
        <Text style={histStyles.entry}>@ {entry.entry_price.toFixed(2)}</Text>
      </View>
      <View style={histStyles.right}>
        <View style={[histStyles.outcomeBadge, { borderColor: OUTCOME_COLOR[entry.outcome] }]}>
          <Text style={[histStyles.outcomeText, { color: OUTCOME_COLOR[entry.outcome] }]}>
            {entry.outcome.toUpperCase()}
          </Text>
        </View>
        {entry.pnl_r !== null && (
          <Text style={[histStyles.rValue, { color: rColor }]}>
            {entry.pnl_r >= 0 ? '+' : ''}{entry.pnl_r.toFixed(2)}R
          </Text>
        )}
        {entry.outcome === 'open' && (
          <Pressable style={histStyles.closeBtn} onPress={onClose}>
            <Text style={histStyles.closeBtnText}>Close</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const histStyles = StyleSheet.create({
  row: {
    flexDirection:     'row',
    paddingHorizontal: 12,
    paddingVertical:   10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
  },
  left:  { flex: 2, gap: 2 },
  mid:   { flex: 2, gap: 2 },
  right: { flex: 1.5, alignItems: 'flex-end', gap: 4 },
  ticker:{ color: DARK.textPrimary, fontSize: 14, fontWeight: '700' },
  date:  { color: DARK.textMuted, fontSize: 10 },
  wave:  { color: '#60a5fa', fontSize: 10 },
  dir:   { color: DARK.textSecondary, fontSize: 11, fontWeight: '600' },
  instr: { color: DARK.textMuted, fontSize: 10 },
  entry: { color: DARK.textSecondary, fontSize: 11 },
  outcomeBadge: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 1 },
  outcomeText:  { fontSize: 9, fontWeight: '700' },
  rValue:       { fontSize: 14, fontWeight: '700' },
  closeBtn:     { backgroundColor: '#1d4ed820', borderRadius: 3, paddingHorizontal: 8, paddingVertical: 2 },
  closeBtnText: { color: '#60a5fa', fontSize: 10, fontWeight: '600' },
});

// ── Analytics tab ─────────────────────────────────────────────────────────────

const CHART_W_ANALYTICS = 300;
const EQUITY_H          = 80;

function EquityCurve({ curve }: { curve: number[] }) {
  const path = useMemo(() => {
    if (curve.length < 2) return null;
    const maxV = Math.max(...curve, 0);
    const minV = Math.min(...curve, 0);
    const range = maxV - minV || 1;
    const stepX = CHART_W_ANALYTICS / (curve.length - 1);

    const p = Skia.Path.Make();
    curve.forEach((v, i) => {
      const x = i * stepX;
      const y = EQUITY_H * (1 - (v - minV) / range);
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    });
    return p;
  }, [curve]);

  if (!path) return <Text style={{ color: DARK.textMuted, fontSize: 11 }}>Not enough data</Text>;

  return (
    <Canvas style={{ width: CHART_W_ANALYTICS, height: EQUITY_H }}>
      <Path path={path} color="#22c55e" style="stroke" strokeWidth={1.5} />
    </Canvas>
  );
}

function AnalyticsPanel({ entries }: { entries: JournalEntry[] }) {
  const analytics = useMemo(() => computeAnalytics(entries), [entries]);
  const rColor    = analytics.avg_r >= 0 ? DARK.bullish : DARK.bearish;

  return (
    <ScrollView style={anStyles.scroll} showsVerticalScrollIndicator={false}>
      {/* Behavioral flags */}
      {analytics.cut_winners_early_flag && (
        <View style={anStyles.flagBox}>
          <Text style={anStyles.flagText}>⚠ Cutting Winners Early: avg win = {analytics.avg_r}R  Consider wider targets</Text>
        </View>
      )}
      {analytics.hold_losers_long_flag && (
        <View style={[anStyles.flagBox, { borderColor: DARK.bearish }]}>
          <Text style={[anStyles.flagText, { color: DARK.bearish }]}>⚠ Holding Losers Too Long: avg loss &gt; 1.5R  Review stop discipline</Text>
        </View>
      )}

      {/* Summary stats */}
      <View style={anStyles.statsGrid}>
        {[
          { l: 'Trades',    v: String(analytics.total_trades) },
          { l: 'Win Rate',  v: `${analytics.win_rate}%`,    c: analytics.win_rate >= 50 ? DARK.bullish : DARK.bearish },
          { l: 'Avg R',     v: `${analytics.avg_r >= 0 ? '+' : ''}${analytics.avg_r}R`, c: rColor },
          { l: 'Max DD',    v: `${analytics.max_drawdown}R`,c: DARK.bearish },
        ].map(({ l, v, c }) => (
          <View key={l} style={anStyles.statBox}>
            <Text style={anStyles.statLabel}>{l}</Text>
            <Text style={[anStyles.statValue, c ? { color: c } : {}]}>{v}</Text>
          </View>
        ))}
      </View>

      {/* Equity curve */}
      <View style={anStyles.section}>
        <Text style={anStyles.sectionTitle}>Equity Curve (R)</Text>
        <EquityCurve curve={analytics.equity_curve} />
      </View>

      {/* Monthly P&L */}
      {analytics.monthly_pnl.length > 0 && (
        <View style={anStyles.section}>
          <Text style={anStyles.sectionTitle}>Monthly P&L (R)</Text>
          {analytics.monthly_pnl.slice(-6).map(({ month, pnl }) => (
            <View key={month} style={anStyles.barRow}>
              <Text style={anStyles.barLabel}>{month}</Text>
              <View style={[anStyles.bar, { width: Math.min(Math.abs(pnl) * 20, 140), backgroundColor: pnl >= 0 ? DARK.bullish : DARK.bearish }]} />
              <Text style={[anStyles.barValue, { color: pnl >= 0 ? DARK.bullish : DARK.bearish }]}>
                {pnl >= 0 ? '+' : ''}{pnl}R
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Win rate by wave */}
      {Object.keys(analytics.win_rate_by_wave).length > 0 && (
        <View style={anStyles.section}>
          <Text style={anStyles.sectionTitle}>Win Rate by Wave</Text>
          {Object.entries(analytics.win_rate_by_wave).map(([wave, wr]) => (
            <View key={wave} style={anStyles.barRow}>
              <Text style={anStyles.barLabel}>{wave.replace('Wave ', 'W')}</Text>
              <View style={[anStyles.bar, { width: wr * 1.2, backgroundColor: wr >= 50 ? DARK.bullish : DARK.bearish }]} />
              <Text style={[anStyles.barValue, { color: wr >= 50 ? DARK.bullish : DARK.bearish }]}>{wr}%</Text>
            </View>
          ))}
        </View>
      )}

      {/* Win rate by regime */}
      {Object.keys(analytics.win_rate_by_regime).length > 0 && (
        <View style={anStyles.section}>
          <Text style={anStyles.sectionTitle}>Win Rate by Regime</Text>
          {Object.entries(analytics.win_rate_by_regime).map(([regime, wr]) => (
            <View key={regime} style={anStyles.barRow}>
              <Text style={[anStyles.barLabel, { fontSize: 9 }]}>{regime.replace('_', ' ')}</Text>
              <View style={[anStyles.bar, { width: wr * 1.2, backgroundColor: wr >= 50 ? DARK.bullish : DARK.bearish }]} />
              <Text style={[anStyles.barValue, { color: wr >= 50 ? DARK.bullish : DARK.bearish }]}>{wr}%</Text>
            </View>
          ))}
        </View>
      )}

      {/* Avg R by instrument */}
      {Object.keys(analytics.avg_r_by_instrument).length > 0 && (
        <View style={anStyles.section}>
          <Text style={anStyles.sectionTitle}>Avg R by Instrument</Text>
          {Object.entries(analytics.avg_r_by_instrument).map(([instr, r]) => (
            <View key={instr} style={anStyles.barRow}>
              <Text style={anStyles.barLabel}>{instr}</Text>
              <View style={[anStyles.bar, { width: Math.abs(r) * 30, backgroundColor: r >= 0 ? DARK.bullish : DARK.bearish }]} />
              <Text style={[anStyles.barValue, { color: r >= 0 ? DARK.bullish : DARK.bearish }]}>{r >= 0 ? '+' : ''}{r}R</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const anStyles = StyleSheet.create({
  scroll: { flex: 1, padding: 12 },
  flagBox: {
    borderWidth:     1,
    borderColor:     DARK.neutral,
    borderRadius:    6,
    padding:         10,
    marginBottom:    10,
    backgroundColor: '#78350f20',
  },
  flagText: { color: DARK.neutral, fontSize: 12 },
  statsGrid: {
    flexDirection: 'row',
    marginBottom:  12,
    gap:           8,
  },
  statBox:   { flex: 1, backgroundColor: DARK.surface, borderRadius: 6, padding: 8, alignItems: 'center', borderWidth: 1, borderColor: DARK.border },
  statLabel: { color: DARK.textMuted, fontSize: 9, marginBottom: 4 },
  statValue: { color: DARK.textPrimary, fontSize: 15, fontWeight: '700' },
  section:   { marginBottom: 16 },
  sectionTitle: { color: DARK.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 8 },
  barRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  barLabel:  { color: DARK.textMuted, fontSize: 10, width: 80 },
  bar:       { height: 10, borderRadius: 3, minWidth: 2 },
  barValue:  { fontSize: 10, fontWeight: '600' },
});

// ── Main screen ───────────────────────────────────────────────────────────────

type JournalTab = 'log' | 'history' | 'analytics';

export function JournalScreen() {
  const [tab, setTab] = useState<JournalTab>('log');
  const entries       = useJournalStore((s) => s.entries);
  const { closeEntry } = useJournalStore();

  const handleClose = useCallback((id: string) => {
    Alert.prompt(
      'Close Trade',
      'Enter exit price:',
      (exitPriceStr) => {
        const exitPrice = parseFloat(exitPriceStr ?? '');
        if (!exitPrice) return;
        closeEntry(id, exitPrice, new Date().toISOString(), '', 3);
      },
      'plain-text',
    );
  }, [closeEntry]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Trade Journal</Text>
        </View>

        {/* Tab row */}
        <View style={styles.tabRow}>
          {(['log', 'history', 'analytics'] as JournalTab[]).map((t) => (
            <Pressable
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Content */}
        <View style={styles.content}>
          {tab === 'log'       && <LogForm />}
          {tab === 'history'   && (
            <FlatList
              data={entries}
              keyExtractor={(e) => e.id}
              renderItem={({ item }) => (
                <HistoryRow entry={item} onClose={() => handleClose(item.id)} />
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No trades logged yet.</Text>
                </View>
              }
            />
          )}
          {tab === 'analytics' && <AnalyticsPanel entries={entries} />}
        </View>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: DARK.background },
  container: { flex: 1 },
  header:    { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  title:     { color: DARK.textPrimary, fontSize: 20, fontWeight: '700' },
  tabRow: {
    flexDirection:     'row',
    paddingHorizontal: 12,
    paddingVertical:   6,
    gap:               8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical:    5,
    borderRadius:       4,
    borderWidth:        1,
    borderColor:        DARK.border,
  },
  tabActive:    { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  tabText:      { color: DARK.textMuted,    fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  content: { flex: 1 },
  empty: { padding: 24, alignItems: 'center' },
  emptyText: { color: DARK.textMuted, fontSize: 13 },
});
