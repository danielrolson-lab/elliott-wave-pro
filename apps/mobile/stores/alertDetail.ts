/**
 * stores/alertDetail.ts
 *
 * Stores context snapshots captured at the moment each alert fires.
 * Used by the AlertDetailScreen to show the full scenario context.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface AlertDetailRecord {
  alertId:       string;
  label:         string;
  ticker:        string;
  interpretation: string;
  triggeredAt:   number;   // unix ms
  triggerPrice:  number;
  waveLabel:     string | null;
  regime:        string | null;
  probability:   number | null;
}

interface AlertDetailState {
  details: AlertDetailRecord[];
  addDetail: (detail: AlertDetailRecord) => void;
  clearDetail: (alertId: string) => void;
}

export const useAlertDetailStore = create<AlertDetailState>()(
  immer((set) => ({
    details: [],

    addDetail: (detail) => set((s) => {
      // Keep last 50 triggered alert snapshots
      s.details.unshift(detail);
      if (s.details.length > 50) s.details.splice(50);
    }),

    clearDetail: (alertId) => set((s) => {
      s.details = s.details.filter((d) => d.alertId !== alertId);
    }),
  })),
);
