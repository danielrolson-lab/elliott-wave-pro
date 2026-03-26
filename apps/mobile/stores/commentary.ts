/**
 * stores/commentary.ts
 *
 * Stores AI-generated commentary text per wave count ID.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface CommentaryState {
  /** commentary text keyed by wave count ID */
  texts:   Record<string, string>;
  /** loading state keyed by wave count ID */
  loading: Record<string, boolean>;
  /** error keyed by wave count ID */
  errors:  Record<string, string | null>;

  setCommentary: (countId: string, text: string) => void;
  setLoading:    (countId: string, loading: boolean) => void;
  setError:      (countId: string, error: string | null) => void;
}

export const useCommentaryStore = create<CommentaryState>()(
  immer((set) => ({
    texts:   {},
    loading: {},
    errors:  {},

    setCommentary: (countId, text) => set((s) => {
      s.texts[countId]   = text;
      s.loading[countId] = false;
      s.errors[countId]  = null;
    }),

    setLoading: (countId, loading) => set((s) => {
      s.loading[countId] = loading;
    }),

    setError: (countId, error) => set((s) => {
      s.errors[countId]  = error;
      s.loading[countId] = false;
    }),
  })),
);
