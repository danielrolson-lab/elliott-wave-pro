/**
 * Minimal type declarations for react-native-purchases.
 * Full types are installed with the package via npm.
 * These stubs ensure tsc passes before the native module is linked.
 */

declare module 'react-native-purchases' {
  export const PURCHASES_ERROR_CODE: {
    PURCHASE_CANCELLED_ERROR: string;
    [key: string]: string;
  };

  export interface PurchasesPackage {
    product: {
      identifier: string;
      priceString: string;
      title:       string;
    };
  }

  export interface EntitlementInfo {
    isActive:           boolean;
    expirationDate:     string | null;
    productIdentifier:  string;
  }

  export interface CustomerInfo {
    entitlements: {
      active: Record<string, EntitlementInfo>;
      all:    Record<string, EntitlementInfo>;
    };
    originalPurchaseDate: string;
    activeSubscriptions:  string[];
  }

  export interface Offerings {
    current: {
      availablePackages: PurchasesPackage[];
    } | null;
  }

  const Purchases: {
    configure(options: { apiKey: string }): void;
    logIn(userId: string): Promise<{ customerInfo: CustomerInfo }>;
    getCustomerInfo(): Promise<CustomerInfo>;
    getOfferings(): Promise<Offerings>;
    purchasePackage(pkg: PurchasesPackage): Promise<{ customerInfo: CustomerInfo }>;
    restorePurchases(): Promise<CustomerInfo>;
    addCustomerInfoUpdateListener(listener: (info: CustomerInfo) => void): void;
    removeCustomerInfoUpdateListener(listener: (info: CustomerInfo) => void): void;
  };

  export default Purchases;
}
