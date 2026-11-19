import * as React from 'react';
import type { ViewStyle } from 'react-native';

/**
 * Real-time hand landmarks from Apple's Vision framework.
 *
 * The native half is optional in exactly the way every other native module in
 * this app is: in Expo Go, on web, or in a build where it is not linked, the
 * require throws and callers fall back to the server-based sign reader rather
 * than crashing the screen.
 */

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
  confidence: number;
}

export interface TrackedHand {
  /** Which hand Vision believes this is. */
  chirality: 'left' | 'right' | 'unknown';
  /** Mean joint confidence across the 21 landmarks. */
  confidence: number;
  /** 21 points in MediaPipe order, normalized to 0..1 with a top-left origin. */
  landmarks: HandLandmark[];
}

export interface HandsEvent {
  hands: TrackedHand[];
  count: number;
  timestamp: number;
}

export interface HandStatusEvent {
  state: 'running' | 'denied' | 'error';
  detail?: string;
  facing?: 'front' | 'back';
}

export interface HandTrackerProps {
  style?: ViewStyle | ViewStyle[];
  /** Start or stop the camera. Stop it whenever the screen is not visible. */
  active?: boolean;
  facing?: 'front' | 'back';
  maxHands?: number;
  /** Landmark frames per second. 20 is smooth and leaves headroom. */
  frameRate?: number;
  onHands?: (event: { nativeEvent: HandsEvent }) => void;
  onStatus?: (event: { nativeEvent: HandStatusEvent }) => void;
}

type NativeModuleShape = { isSupported: () => boolean };

let nativeModule: NativeModuleShape | null = null;
let NativeHandTracker: React.ComponentType<HandTrackerProps> | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const core = require('expo-modules-core') as {
    requireNativeModule: (name: string) => NativeModuleShape;
    requireNativeView: (name: string) => React.ComponentType<HandTrackerProps>;
  };
  nativeModule = core.requireNativeModule('GuideEyeHands');
  NativeHandTracker = core.requireNativeView('GuideEyeHands');
} catch {
  nativeModule = null;
  NativeHandTracker = null;
}

/** True when this build can track hands on-device, in real time. */
export function hasNativeHandTracking(): boolean {
  if (!nativeModule || !NativeHandTracker) return false;
  try {
    return nativeModule.isSupported();
  } catch {
    return false;
  }
}

export const HandTracker: React.ComponentType<HandTrackerProps> = (props) => {
  if (!NativeHandTracker) return null;
  return React.createElement(NativeHandTracker, props);
};
