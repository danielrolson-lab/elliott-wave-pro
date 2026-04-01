/**
 * LayerTogglePanel.tsx
 * Collapsible layer toggle control panel for the chart screen.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useChartLayersStore } from '../../stores/chartLayers';
import type { ChartLayersState, EWMode } from '../../stores/chartLayers';
import { DARK } from '../../theme/colors';

type LayerKey = keyof Omit<ChartLayersState, 'toggle' | 'reset' | 'setEWMode' | 'ewMode'>;

interface PillDef { label: string; key: LayerKey; }

const ROW1: PillDef[] = [
  { label: 'MA20',         key: 'ma20' },
  { label: 'MA50',         key: 'ma50' },
  { label: 'MA200',        key: 'ma200' },
  { label: 'VWAP',         key: 'vwap' },
  { label: 'BB',           key: 'bb' },
  { label: 'EW Waves',     key: 'ewWaves' },
  { label: 'Fib Levels',   key: 'fibLevels' },
  { label: 'EW Channel',   key: 'ewChannel' },
  { label: 'Invalidation', key: 'invalidation' },
];

const ROW2: PillDef[] = [
  { label: 'RSI',     key: 'showRSI' },
  { label: 'MACD',    key: 'showMACD' },
  { label: 'Volume',  key: 'showVolume' },
  { label: 'CVD',     key: 'showCVD' },
  { label: 'GEX',     key: 'showGEX' },
];

const ROW3: PillDef[] = [
  { label: 'Dark Pool',     key: 'darkPool' },
  { label: 'Options Flow',  key: 'optionsFlow' },
  { label: 'Sentiment',     key: 'sentiment' },
  { label: 'Wave Labels',   key: 'waveLabels' },
  { label: 'Alt Count',     key: 'altCount' },
];

function PillRow({ pills }: { pills: PillDef[] }) {
  const store = useChartLayersStore();
  return (
    <View style={styles.pillRow}>
      {pills.map(({ label, key }) => {
        const active = store[key] as boolean;
        return (
          <Pressable
            key={key}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => store.toggle(key)}
            hitSlop={4}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const EW_MODE_OPTIONS: { label: string; value: EWMode; desc: string }[] = [
  { label: 'EW Now',       value: 'now',          desc: 'Best-fit for visible window' },
  { label: 'Multi-Degree', value: 'multi-degree', desc: 'HTF context + sub-degree' },
  { label: 'Wave History', value: 'history',      desc: 'All completed patterns' },
];

function EWModeSelector() {
  const ewMode    = useChartLayersStore((s) => s.ewMode);
  const setEWMode = useChartLayersStore((s) => s.setEWMode);
  return (
    <View style={styles.modeRow}>
      {EW_MODE_OPTIONS.map(({ label, value }) => {
        const selected = ewMode === value;
        return (
          <Pressable
            key={value}
            style={styles.radioItem}
            onPress={() => setEWMode(value)}
            hitSlop={4}
          >
            <View style={[styles.radioCircle, selected && styles.radioCircleSelected]}>
              {selected && <View style={styles.radioFill} />}
            </View>
            <Text style={[styles.radioLabel, selected && styles.radioLabelSelected]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function LayerTogglePanel() {
  const [expanded, setExpanded] = useState(false);
  const reset = useChartLayersStore((s) => s.reset);

  return (
    <View>
      <View style={styles.header}>
        <Pressable style={styles.toggleBtn} onPress={() => setExpanded((v) => !v)} hitSlop={8}>
          <Text style={styles.toggleBtnText}>{expanded ? '✕ Layers' : '⊕ Layers'}</Text>
        </Pressable>
        {expanded && (
          <Pressable style={styles.resetBtn} onPress={reset} hitSlop={8}>
            <Text style={styles.resetText}>Reset</Text>
          </Pressable>
        )}
      </View>
      {expanded && (
        <View style={styles.panel}>
          <Text style={styles.rowLabel}>ELLIOTT WAVE MODE</Text>
          <EWModeSelector />
          <Text style={styles.rowLabel}>PRICE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
            <PillRow pills={ROW1} />
          </ScrollView>
          <Text style={styles.rowLabel}>INDICATORS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
            <PillRow pills={ROW2} />
          </ScrollView>
          <Text style={styles.rowLabel}>DATA</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
            <PillRow pills={ROW3} />
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3 },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, backgroundColor: DARK.surface, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: DARK.border },
  toggleBtnText: { color: DARK.textSecondary, fontSize: 10, fontWeight: '600' },
  resetBtn: { marginLeft: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(239,83,80,0.15)', borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(239,83,80,0.4)' },
  resetText: { color: '#ef5350', fontSize: 10, fontWeight: '600' },
  panel: { backgroundColor: DARK.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: DARK.separator, paddingBottom: 4 },
  rowLabel: { color: DARK.textMuted, fontSize: 8, fontWeight: '700', letterSpacing: 0.8, paddingLeft: 8, paddingTop: 6, paddingBottom: 2 },
  scrollRow: { paddingHorizontal: 8 },
  pillRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: 6, paddingBottom: 4 },
  pill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: DARK.border },
  pillActive: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  pillText: { color: DARK.textMuted, fontSize: 10, fontWeight: '600' },
  pillTextActive: { color: '#ffffff' },
  modeRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 8, paddingVertical: 6 },
  radioItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  radioCircle: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: DARK.border, alignItems: 'center', justifyContent: 'center' },
  radioCircleSelected: { borderColor: '#3B82F6' },
  radioFill: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#3B82F6' },
  radioLabel: { color: DARK.textMuted, fontSize: 10, fontWeight: '600' },
  radioLabelSelected: { color: '#3B82F6' },
});
