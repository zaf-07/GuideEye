type Classification = { label: string; confidence: number };
type ObjectLabelsModule = {
  classify(uri: string): Promise<Classification[]>;
};

let native: ObjectLabelsModule | null = null;
try {
  const { requireOptionalNativeModule } = require('expo') as typeof import('expo');
  native = requireOptionalNativeModule<ObjectLabelsModule>('GuideEyeObjectLabels');
} catch {
  // On web, Android and builds without the iOS module, keep the normal scan.
}

export const expandedLabelsAvailable = Boolean(native);

// Concrete objects outside COCO. Ignore scene categories, activities and
// broad labels such as "indoor", which are not useful as object names.
const EXTRA_OBJECTS: Readonly<Record<string, string>> = {
  footwear: 'shoes', shoes: 'shoes', sneaker: 'shoes', boot: 'boots',
  door: 'door', stairs: 'stairs', wallet: 'wallet', headphones: 'headphones',
  helmet: 'helmet', hat: 'hat', glasses: 'glasses', sunglasses: 'sunglasses',
  glove: 'glove', guitar: 'guitar', piano: 'piano', lamp: 'lamp',
  mirror: 'mirror', window: 'window', cabinet: 'cabinet', shelf: 'shelf',
  curtain: 'curtain', fireplace: 'fireplace', rug: 'rug', carpet: 'carpet',
  washing_machine: 'washing machine', dishwasher: 'dishwasher',
  vacuum_cleaner: 'vacuum cleaner', printer: 'printer', computer_monitor: 'monitor',
};

export async function classifyExtraObjects(uri: string): Promise<string[]> {
  if (!native) return [];
  const observations = await native.classify(uri);
  const labels = observations
    .filter(({ confidence }) => confidence >= 0.55)
    .map(({ label }) => Object.hasOwn(EXTRA_OBJECTS, label) ? EXTRA_OBJECTS[label] : undefined)
    .filter((label): label is string => Boolean(label));
  return [...new Set(labels)].slice(0, 3);
}
