/**
 * stores/auth.ts
 *
 * Zustand slice for Supabase auth session state.
 * Populated by AppNavigator on startup via onAuthStateChange.
 */

import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';

export interface AuthState {
  session:    Session | null;
  loading:    boolean;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  session:    null,
  loading:    true,

  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),
}));
