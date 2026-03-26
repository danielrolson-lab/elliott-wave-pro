/**
 * hooks/useRevenueCat.ts
 *
 * RevenueCat SDK integration.
 * Initializes Purchases, syncs CustomerInfo to subscription store,
 * and provides purchase helpers.
 *
 * Products (configured in RevenueCat dashboard):
 *   Entitlements:
 *     pro   → pro_monthly, pro_annual
 *     elite → elite_monthly, elite_annual
 */

import { useEffect, useCallback } from 'react';
import Purchases, {
  type CustomerInfo,
  type PurchasesPackage,
  PURCHASES_ERROR_CODE,
} from 'react-native-purchases';
import { useSubscriptionStore, type SubscriptionTier } from '../stores/subscription';
import { useAuthStore } from '../stores/auth';
import { supabase }     from '../utils/supabase';

const REVENUECAT_API_KEY_IOS     = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY     ?? '';
const REVENUECAT_API_KEY_ANDROID = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';

function tierFromCustomerInfo(info: CustomerInfo): SubscriptionTier {
  if (info.entitlements.active['elite']) return 'elite';
  if (info.entitlements.active['pro'])   return 'pro';
  return 'free';
}

export function useRevenueCat() {
  const { setSubscription, setLoading } = useSubscriptionStore();
  const session = useAuthStore((s) => s.session);

  const syncCustomerInfo = useCallback(async (info: CustomerInfo) => {
    const tier        = tierFromCustomerInfo(info);
    const proEntitlement   = info.entitlements.active['pro'];
    const eliteEntitlement = info.entitlements.active['elite'];
    const activeEntitlement = eliteEntitlement ?? proEntitlement;

    setSubscription({
      tier,
      isLoading:            false,
      expiresAt:            activeEntitlement?.expirationDate ?? null,
      productId:            activeEntitlement?.productIdentifier ?? null,
      originalPurchaseDate: info.originalPurchaseDate,
    });

    // Mirror tier to Supabase for API-key rate limiting
    if (session?.user?.id) {
      void supabase
        .from('profiles')
        .upsert({ id: session.user.id, subscription_tier: tier, updated_at: new Date().toISOString() });
    }
  }, [setSubscription, session]);

  useEffect(() => {
    const { Platform } = require('react-native') as typeof import('react-native');
    const apiKey = Platform.OS === 'ios' ? REVENUECAT_API_KEY_IOS : REVENUECAT_API_KEY_ANDROID;
    if (!apiKey) { setLoading(false); return; }

    Purchases.configure({ apiKey });

    // Set user ID for Supabase cross-reference
    if (session?.user?.id) {
      void Purchases.logIn(session.user.id);
    }

    // Initial sync
    Purchases.getCustomerInfo()
      .then(syncCustomerInfo)
      .catch(() => setLoading(false));

    // Subscribe to updates
    Purchases.addCustomerInfoUpdateListener(syncCustomerInfo);

    return () => {
      Purchases.removeCustomerInfoUpdateListener(syncCustomerInfo);
    };
  }, [session, syncCustomerInfo, setLoading]);

  const purchasePackage = useCallback(async (pkg: PurchasesPackage) => {
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      await syncCustomerInfo(customerInfo);
      return { success: true };
    } catch (err: unknown) {
      if (
        typeof err === 'object' && err !== null &&
        'code' in err &&
        (err as { code: unknown }).code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR
      ) {
        return { success: false, cancelled: true };
      }
      return { success: false, error: err };
    }
  }, [syncCustomerInfo]);

  const restorePurchases = useCallback(async () => {
    try {
      const info = await Purchases.restorePurchases();
      await syncCustomerInfo(info);
      return { success: true };
    } catch (err) {
      return { success: false, error: err };
    }
  }, [syncCustomerInfo]);

  return { purchasePackage, restorePurchases };
}
