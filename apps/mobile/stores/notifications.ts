/**
 * stores/notifications.ts
 *
 * Persists notification preferences. Currently: wave-completion alert toggle.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface NotificationState {
  waveAlertsEnabled: boolean;
  setWaveAlertsEnabled: (v: boolean) => void;
}

export const useNotificationStore = create<NotificationState>()(
  immer((set) => ({
    waveAlertsEnabled: false,

    setWaveAlertsEnabled: (v) =>
      set((state) => {
        state.waveAlertsEnabled = v;
      }),
  })),
);
