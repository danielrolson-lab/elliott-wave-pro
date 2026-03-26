/**
 * stores/subscription.ts
 *
 * Subscription tier state, backed by RevenueCat CustomerInfo.
 * Tier is also stored in Supabase profiles.subscription_tier for API access.
 *
 * Tiers:
 *   free  — 3 watchlist tickers, top-2 scenarios only
 *   pro   — everything through Phase 2 + wave scanner + journal + internals
 *   elite — everything + quant API access + replay mode
 *
 * Products:
 *   com.elliottwave.pro.pro_monthly   $24.99/mo
 *   com.elliottwave.pro.pro_annual    $199/yr
 *   com.elliottwave.pro.elite_monthly $59.99/mo
 *   com.elliottwave.pro.elite_annual  $499/yr
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type SubscriptionTier = 'free' | 'pro' | 'elite';

export interface SubscriptionState {
  tier:          SubscriptionTier;
  isLoading:     boolean;
  expiresAt:     string | null;    // ISO
  productId:     string | null;
  originalPurchaseDate: string | null;

  setTier:         (tier: SubscriptionTier) => void;
  setLoading:      (loading: boolean) => void;
  setSubscription: (info: Partial<SubscriptionState>) => void;
}

export const useSubscriptionStore = create<SubscriptionState>()(
  immer((set) => ({
    tier:                 'free',
    isLoading:            true,
    expiresAt:            null,
    productId:            null,
    originalPurchaseDate: null,

    setTier:    (tier)    => set((s) => { s.tier = tier; }),
    setLoading: (loading) => set((s) => { s.isLoading = loading; }),
    setSubscription: (info) =>
      set((s) => { Object.assign(s, info); }),
  })),
);

// ── Feature gates ─────────────────────────────────────────────────────────────

export const FEATURE_GATES = {
  // Free tier limits
  maxWatchlistTickers: (tier: SubscriptionTier) => tier === 'free' ? 3 : Infinity,
  maxScenariosShown:   (tier: SubscriptionTier) => tier === 'free' ? 2 : 4,

  // Pro features
  canUseWaveScanner:   (tier: SubscriptionTier) => tier !== 'free',
  canUseJournal:       (tier: SubscriptionTier) => tier !== 'free',
  canUseInternals:     (tier: SubscriptionTier) => tier !== 'free',
  canUseWaveGrid:      (tier: SubscriptionTier) => tier !== 'free',
  canUseDarkPool:      (tier: SubscriptionTier) => tier !== 'free',
  canUseEarnings:      (tier: SubscriptionTier) => tier !== 'free',
  canUseCorrelation:   (tier: SubscriptionTier) => tier !== 'free',

  // Elite-only features
  canUseReplay:        (tier: SubscriptionTier) => tier === 'elite',
  canUseQuantAPI:      (tier: SubscriptionTier) => tier === 'elite',
  canUseCustomAlerts:  (tier: SubscriptionTier) => tier !== 'free',
} as const;
