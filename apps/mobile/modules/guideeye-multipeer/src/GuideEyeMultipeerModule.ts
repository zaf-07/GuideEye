import { NativeModule, requireOptionalNativeModule } from 'expo';

import { GuideEyeMultipeerModuleEvents } from './GuideEyeMultipeer.types';

declare class GuideEyeMultipeerModule extends NativeModule<GuideEyeMultipeerModuleEvents> {
  start(name: string): boolean;
  stop(): void;
  invite(id: string): boolean;
  send(text: string): boolean;
  disconnect(): void;
  connectedPeers(): string[];
}

export default requireOptionalNativeModule<GuideEyeMultipeerModule>('GuideEyeMultipeer');
