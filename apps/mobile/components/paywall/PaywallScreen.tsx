/**
 * components/paywall/PaywallScreen.tsx
 *
 * Paywall component using RevenueCat Paywalls SDK.
 * Falls back to a custom paywall if RevenueCat Paywalls not configured.
 *
 * Products:
 *   Pro     $24.99/mo  · $199/yr (save 34%)
 *   Elite   $59.99/mo  · $499/yr (save 31%)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import { useRevenueCat }        from '../../hooks/useRevenueCat';
import { useSubscriptionStore } from '../../stores/subscription';
import { DARK } from '../../theme/colors';

interface PlanConfig {
  tier:        'pro' | 'elite';
  monthlyId:   string;
  annualId:    string;
  monthlyPrice: string;
  annualPrice:  string;
  features:    string[];
  color:       string;
}

const PLANS: PlanConfig[] = [
  {
    tier:         'pro',
    monthlyId:    'com.elliottwave.pro.pro_monthly',
    annualId:     'com.elliottwave.pro.pro_annual',
    monthlyPrice: '$24.99/mo',
    annualPrice:  '$199/yr',
    features: [
      'Unlimited watchlist tickers',
      'All 4 wave count scenarios',
      'Wave scanner + historical analogs',
      'Trade journal with analytics',
      'Market internals dashboard',
      'Dark pool feed',
      'Wave summary grid',
      'Earnings volatility tool',
      'Correlation matrix',
    ],
    color: '#1d6fe8',
  },
  {
    tier:         'elite',
    monthlyId:    'com.elliottwave.pro.elite_monthly',
    annualId:     'com.elliottwave.pro.elite_annual',
    monthlyPrice: '$59.99/mo',
    annualPrice:  '$499/yr',
    features: [
      'Everything in Pro',
      'Setup replay mode',
      'Quant API access (50K calls/day)',
      'WebSocket wave signal stream',
      'API key vault (Supabase)',
      'Priority support',
    ],
    color: '#d97706',
  },
];

interface Props {
  requiredTier?: 'pro' | 'elite';
  onDismiss?:    () => void;
}

export function PaywallScreen({ requiredTier, onDismiss }: Props) {
  const [packages,     setPackages]     = useState<PurchasesPackage[]>([]);
  const [loadingPkgs,  setLoadingPkgs]  = useState(true);
  const [purchasing,   setPurchasing]   = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');

  const { purchasePackage, restorePurchases } = useRevenueCat();
  const tier = useSubscriptionStore((s) => s.tier);

  useEffect(() => {
    Purchases.getOfferings()
      .then((offerings: import('react-native-purchases').Offerings) => {
        const pkgs = offerings.current?.availablePackages ?? [];
        setPackages(pkgs);
      })
      .catch(() => {})
      .finally(() => setLoadingPkgs(false));
  }, []);

  const handlePurchase = useCallback(async (plan: PlanConfig) => {
    const targetId = billingCycle === 'monthly' ? plan.monthlyId : plan.annualId;
    const pkg      = packages.find((p) => p.product.identifier === targetId);

    if (!pkg) {
      Alert.alert('Not Available', 'This product is not available in your region.');
      return;
    }

    setPurchasing(targetId);
    const result = await purchasePackage(pkg);
    setPurchasing(null);

    if (result.success) {
      Alert.alert('Welcome to ' + plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1) + '!', 'Your subscription is now active.');
      onDismiss?.();
    } else if (!result.cancelled) {
      Alert.alert('Purchase failed', 'Please try again.');
    }
  }, [billingCycle, packages, purchasePackage, onDismiss]);

  const handleRestore = useCallback(async () => {
    const result = await restorePurchases();
    if (result.success) {
      Alert.alert('Restored', 'Your purchases have been restored.');
      onDismiss?.();
    } else {
      Alert.alert('No purchases found', 'Could not find prior purchases on this Apple ID.');
    }
  }, [restorePurchases, onDismiss]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          {onDismiss && (
            <Pressable style={styles.closeBtn} onPress={onDismiss}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          )}
          <Text style={styles.headline}>Elliott Wave Pro</Text>
          <Text style={styles.subheadline}>
            {requiredTier
              ? `This feature requires ${requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1)}.`
              : 'Unlock the full institutional-grade trading terminal.'}
          </Text>
        </View>

        {/* Billing toggle */}
        <View style={styles.billingToggle}>
          {(['monthly', 'annual'] as const).map((cycle) => (
            <Pressable
              key={cycle}
              style={[styles.billingPill, billingCycle === cycle && styles.billingPillActive]}
              onPress={() => setBillingCycle(cycle)}
            >
              <Text style={[styles.billingText, billingCycle === cycle && styles.billingTextActive]}>
                {cycle.charAt(0).toUpperCase() + cycle.slice(1)}
                {cycle === 'annual' && ' (save ~33%)'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Plan cards */}
        {loadingPkgs ? (
          <ActivityIndicator color={DARK.accent} style={{ margin: 24 }} />
        ) : (
          PLANS
            .filter((p) => !requiredTier || p.tier === requiredTier || p.tier === 'elite')
            .map((plan) => (
              <View key={plan.tier} style={[styles.planCard, { borderColor: plan.color }]}>
                <View style={styles.planHeader}>
                  <View>
                    <Text style={[styles.planName, { color: plan.color }]}>
                      {plan.tier.toUpperCase()}
                    </Text>
                    <Text style={styles.planPrice}>
                      {billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice}
                    </Text>
                  </View>
                  {tier === plan.tier && (
                    <View style={styles.activeBadge}>
                      <Text style={styles.activeBadgeText}>CURRENT</Text>
                    </View>
                  )}
                </View>

                {plan.features.map((f) => (
                  <View key={f} style={styles.featureRow}>
                    <Text style={[styles.checkmark, { color: plan.color }]}>✓</Text>
                    <Text style={styles.featureText}>{f}</Text>
                  </View>
                ))}

                {tier !== plan.tier && (
                  <Pressable
                    style={[styles.subscribeBtn, { backgroundColor: plan.color }]}
                    onPress={() => { void handlePurchase(plan); }}
                    disabled={purchasing !== null}
                  >
                    {purchasing === (billingCycle === 'monthly' ? plan.monthlyId : plan.annualId) ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.subscribeBtnText}>
                        Subscribe — {billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice}
                      </Text>
                    )}
                  </Pressable>
                )}
              </View>
            ))
        )}

        {/* Free tier comparison */}
        <View style={styles.freeCard}>
          <Text style={styles.freeName}>FREE</Text>
          <Text style={styles.freeDesc}>
            3 watchlist tickers · Top 2 scenarios only · Basic chart
          </Text>
        </View>

        {/* Restore */}
        <Pressable style={styles.restoreBtn} onPress={() => { void handleRestore(); }}>
          <Text style={styles.restoreBtnText}>Restore Purchases</Text>
        </Pressable>

        {/* Legal */}
        <Text style={styles.legal}>
          Subscriptions auto-renew. Cancel anytime in App Store settings.
          By subscribing you agree to our Terms of Service and Privacy Policy.
        </Text>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: DARK.background },

  header: {
    padding:     24,
    alignItems:  'center',
    position:    'relative',
  },
  closeBtn:     { position: 'absolute', top: 12, right: 16, padding: 6 },
  closeBtnText: { color: DARK.textMuted, fontSize: 18 },
  headline: {
    color:      DARK.textPrimary,
    fontSize:   26,
    fontWeight: '900',
    textAlign:  'center',
    marginBottom: 8,
  },
  subheadline: {
    color:     DARK.textSecondary,
    fontSize:  14,
    textAlign: 'center',
    lineHeight: 20,
  },

  billingToggle: {
    flexDirection:  'row',
    marginHorizontal: 16,
    marginBottom:   16,
    backgroundColor: DARK.surface,
    borderRadius:   8,
    padding:        4,
    gap:            4,
  },
  billingPill: {
    flex:          1,
    paddingVertical: 8,
    borderRadius:  6,
    alignItems:    'center',
  },
  billingPillActive: { backgroundColor: '#1d4ed8' },
  billingText:       { color: DARK.textMuted, fontSize: 12, fontWeight: '600' },
  billingTextActive: { color: '#fff' },

  planCard: {
    marginHorizontal: 16,
    marginBottom:     16,
    padding:          16,
    backgroundColor:  DARK.surface,
    borderRadius:     12,
    borderWidth:      1.5,
  },
  planHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  planName:      { fontSize: 13, fontWeight: '900', letterSpacing: 1, marginBottom: 2 },
  planPrice:     { color: DARK.textPrimary, fontSize: 22, fontWeight: '900' },
  activeBadge:   { backgroundColor: '#14532d', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  activeBadgeText:{ color: '#4ade80', fontSize: 10, fontWeight: '700' },

  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  checkmark:  { fontSize: 13, fontWeight: '700', marginTop: 1 },
  featureText:{ color: DARK.textSecondary, fontSize: 13, flex: 1 },

  subscribeBtn:     { marginTop: 12, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  subscribeBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  freeCard: {
    marginHorizontal: 16,
    marginBottom:     16,
    padding:          12,
    backgroundColor:  DARK.surface,
    borderRadius:     8,
    borderWidth:      1,
    borderColor:      DARK.border,
  },
  freeName: { color: DARK.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  freeDesc: { color: DARK.textMuted, fontSize: 12 },

  restoreBtn:     { marginHorizontal: 16, marginBottom: 8, paddingVertical: 10, alignItems: 'center' },
  restoreBtnText: { color: DARK.accent, fontSize: 13, fontWeight: '600' },

  legal: {
    paddingHorizontal: 16,
    color:             DARK.textMuted,
    fontSize:          10,
    textAlign:         'center',
    lineHeight:        14,
  },
});
