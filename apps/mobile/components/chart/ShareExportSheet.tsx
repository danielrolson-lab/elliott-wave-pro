/**
 * ShareExportSheet.tsx
 * Bottom-sheet modal for chart share and export options.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { DARK } from '../../theme/colors';
import type { ExportContext } from '../../services/exportService';
import { shareChartImage, exportPDF, exportExcel, copyChartSummary } from '../../services/exportService';

interface Props {
  visible:   boolean;
  onClose:   () => void;
  exportCtx: ExportContext | null;
}

type ExportOption = 'image' | 'pdf' | 'excel' | 'text';

export function ShareExportSheet({ visible, onClose, exportCtx }: Props) {
  const [loading, setLoading] = useState<ExportOption | null>(null);

  async function runExport(type: ExportOption) {
    if (!exportCtx || loading) return;
    setLoading(type);
    try {
      switch (type) {
        case 'image': await shareChartImage(exportCtx); break;
        case 'pdf':   await exportPDF(exportCtx);        break;
        case 'excel': await exportExcel(exportCtx);      break;
        case 'text':  await copyChartSummary(exportCtx); Alert.alert('Copied', 'Summary copied to clipboard'); break;
      }
      onClose();
    } catch (e) {
      Alert.alert('Export Failed', String(e));
    } finally {
      setLoading(null);
    }
  }

  const options: Array<{ type: ExportOption; icon: string; title: string; sub: string }> = [
    { type: 'image', icon: '📷', title: 'Share Chart Image',        sub: 'PNG with watermark via share sheet' },
    { type: 'pdf',   icon: '📄', title: 'Export Full Report (PDF)', sub: 'Chart + wave analysis + candle data' },
    { type: 'excel', icon: '📊', title: 'Export Data (Excel)',      sub: 'OHLCV + wave scenarios as .xlsx' },
    { type: 'text',  icon: '📋', title: 'Copy Summary Text',        sub: 'Paste-ready wave analysis text' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Share & Export</Text>

        {options.map(({ type, icon, title, sub }) => (
          <Pressable
            key={type}
            style={({ pressed }) => [styles.optRow, pressed && styles.optRowPressed]}
            onPress={() => runExport(type)}
            disabled={loading !== null}
          >
            <Text style={styles.optIcon}>{icon}</Text>
            <View style={styles.optText}>
              <Text style={styles.optTitle}>{title}</Text>
              <Text style={styles.optSub}>{sub}</Text>
            </View>
            {loading === type && <ActivityIndicator size="small" color={DARK.textSecondary} />}
          </Pressable>
        ))}

        <Pressable style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: DARK.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 36 },
  handle: { width: 40, height: 4, backgroundColor: DARK.separator, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  title: { color: DARK.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 16 },
  optRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: DARK.separator },
  optRowPressed: { opacity: 0.6 },
  optIcon: { fontSize: 24, marginRight: 14 },
  optText: { flex: 1 },
  optTitle: { color: DARK.textPrimary, fontSize: 15, fontWeight: '600' },
  optSub: { color: DARK.textMuted, fontSize: 12, marginTop: 2 },
  cancelBtn: { marginTop: 16, backgroundColor: DARK.background, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  cancelText: { color: DARK.textSecondary, fontSize: 15, fontWeight: '600' },
});
