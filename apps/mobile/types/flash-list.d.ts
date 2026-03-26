/**
 * types/flash-list.d.ts
 *
 * Type stubs for @shopify/flash-list.
 * Install with: pnpm add @shopify/flash-list
 * Full types included in the package.
 */

declare module '@shopify/flash-list' {
  import type { FlatListProps, ViewStyle } from 'react-native';

  export interface FlashListProps<T> extends Omit<FlatListProps<T>, 'ref'> {
    estimatedItemSize: number;
    overrideItemLayout?: (
      layout: { span?: number; size?: number },
      item: T,
      index: number,
      maxColumns: number,
      extraData?: unknown,
    ) => void;
    contentContainerStyle?: { paddingHorizontal?: number; paddingVertical?: number; paddingBottom?: number };
  }

  export class FlashList<T> extends React.Component<FlashListProps<T>> {}
}
