/**
 * types/expo-av.d.ts
 *
 * Minimal type stubs for expo-av so TypeScript passes before native linking.
 * Install full types with: pnpm add expo-av
 */

declare module 'expo-av' {
  export namespace Audio {
    interface PermissionResponse { status: string }
    interface AudioMode {
      allowsRecordingIOS?: boolean;
      playsInSilentModeIOS?: boolean;
      [key: string]: unknown;
    }
    function requestPermissionsAsync(): Promise<PermissionResponse>;
    function setAudioModeAsync(mode: AudioMode): Promise<void>;

    interface RecordingStatus { isDoneRecording: boolean; durationMillis: number }
    interface RecordingOptions { android: Record<string, unknown>; ios: Record<string, unknown> }

    const RecordingOptionsPresets: {
      HIGH_QUALITY: RecordingOptions;
      LOW_QUALITY:  RecordingOptions;
    };

    class Recording {
      static createAsync(options: RecordingOptions): Promise<{ recording: Recording }>;
      getURI(): string | null;
      stopAndUnloadAsync(): Promise<RecordingStatus>;
      getStatusAsync(): Promise<RecordingStatus>;
    }

    interface Sound {
      playAsync(): Promise<void>;
      stopAsync(): Promise<void>;
      unloadAsync(): Promise<void>;
    }
    function createSoundObjectAsync(
      source: { uri: string } | number,
    ): Promise<{ sound: Sound }>;
  }
}
