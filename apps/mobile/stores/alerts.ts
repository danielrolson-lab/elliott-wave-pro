import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type AlertConditionType =
  | 'price_cross'
  | 'price_above'
  | 'price_below'
  | 'wave_scenario_probability'
  | 'wave_label_reached'
  | 'iv_rank_above'
  | 'iv_rank_below'
  | 'volume_spike'
  | 'regime_change';

export type AlertStatus = 'active' | 'triggered' | 'dismissed' | 'expired';

export type AlertOutputChannel = 'push' | 'webhook' | 'in_app';

export interface AlertCondition {
  type: AlertConditionType;
  ticker: string;
  // Threshold value (price, probability 0–1, IV rank, etc.)
  value: number;
  // For wave scenario alerts: the wave count id to watch
  waveCountId?: string;
  // For regime change: target regime
  targetRegime?: string;
  // Compound condition: all conditions must be true
  additionalConditions?: Omit<AlertCondition, 'additionalConditions'>[];
}

export interface AlertDelivery {
  channels: AlertOutputChannel[];
  webhookUrl?: string;
  webhookPayloadTemplate?: string;
}

export interface Alert {
  id: string;
  label: string;
  conditions: AlertCondition[];
  delivery: AlertDelivery;
  status: AlertStatus;
  createdAt: number;
  triggeredAt: number | null;
  expiresAt: number | null;
}

export interface AlertsState {
  alerts: Alert[];
  // Unread trigger count for badge
  unreadCount: number;

  // Actions
  addAlert: (alert: Alert) => void;
  removeAlert: (id: string) => void;
  updateAlert: (id: string, patch: Partial<Alert>) => void;
  markTriggered: (id: string) => void;
  dismissAlert: (id: string) => void;
  clearTriggered: () => void;
  markAllRead: () => void;
}

export const useAlertsStore = create<AlertsState>()(
  immer((set) => ({
    alerts: [],
    unreadCount: 0,

    addAlert: (alert) =>
      set((state) => {
        state.alerts.push(alert);
      }),

    removeAlert: (id) =>
      set((state) => {
        state.alerts = state.alerts.filter((a) => a.id !== id);
      }),

    updateAlert: (id, patch) =>
      set((state) => {
        const alert = state.alerts.find((a) => a.id === id);
        if (alert) {
          Object.assign(alert, patch);
        }
      }),

    markTriggered: (id) =>
      set((state) => {
        const alert = state.alerts.find((a) => a.id === id);
        if (alert) {
          alert.status = 'triggered';
          alert.triggeredAt = Date.now();
          state.unreadCount += 1;
        }
      }),

    dismissAlert: (id) =>
      set((state) => {
        const alert = state.alerts.find((a) => a.id === id);
        if (alert) {
          alert.status = 'dismissed';
        }
      }),

    clearTriggered: () =>
      set((state) => {
        state.alerts = state.alerts.filter((a) => a.status !== 'triggered');
      }),

    markAllRead: () =>
      set((state) => {
        state.unreadCount = 0;
      }),
  })),
);
