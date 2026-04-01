/**
 * SkiaErrorBoundary.tsx
 *
 * Error boundary that catches "Text nodes are not supported yet" from Skia.
 * Wraps Canvas components — if one crashes, renders a fallback View and
 * logs the Canvas name so we can identify which one is the source.
 */

import React from 'react';
import { View } from 'react-native';

interface Props {
  name: string;
  height?: number;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMsg: string;
}

export class SkiaErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMsg: msg };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    const name = this.props.name;
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[SkiaErrorBoundary] ${name} crashed: ${msg}`);
    console.error(`[SkiaErrorBoundary] ${name} component tree:`, info.componentStack?.slice(0, 500));
  }

  render() {
    if (this.state.hasError) {
      return (
        <View
          style={{
            height: this.props.height ?? 80,
            backgroundColor: '#1a0000',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        />
      );
    }
    return this.props.children;
  }
}
