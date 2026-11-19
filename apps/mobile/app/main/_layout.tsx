import { Tabs } from 'expo-router/js-tabs';
import { TabBar } from '../../src/components/TabBar';
import { colors } from '../../src/theme/tokens';

/**
 * The five surfaces of the app, one per tab, replacing the single scrolling
 * home. The bar itself is ours (see TabBar) because the stock one cannot host
 * a blur layer behind its items on both platforms.
 *
 * Full-screen experiences — camera, translate, bridge, assistant — stay
 * outside this group so they push over the bar rather than sit under it.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvasDeep },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="vision" options={{ title: 'Vision' }} />
      <Tabs.Screen name="hearing" options={{ title: 'Hearing' }} />
      <Tabs.Screen name="connect" options={{ title: 'Bridge' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
