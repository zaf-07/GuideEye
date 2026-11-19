import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { LiquidGlass } from './LiquidGlass';
import { Text } from './Text';
import { colors, radius, shadow, spacing } from '../theme/tokens';

/** The icon and spoken label for each tab, keyed by route name. */
const TABS: Record<string, { icon: keyof typeof Ionicons.glyphMap; label: string; hint: string }> = {
  index: { icon: 'home', label: 'Home', hint: 'Your modes and status at a glance' },
  vision: { icon: 'eye', label: 'Vision', hint: 'Scene description and walking navigation' },
  hearing: { icon: 'hand-left', label: 'Hearing', hint: 'Sign avatar, captions and sign reading' },
  connect: { icon: 'swap-horizontal', label: 'Bridge', hint: 'Two-way conversation between deaf and blind' },
  settings: { icon: 'settings-sharp', label: 'Settings', hint: 'Profile, voice and permissions' },
};

/**
 * A floating liquid-glass bar. It replaces the stock tab bar rather than
 * styling it, because the stock one cannot host a blur layer behind the items
 * on both platforms.
 *
 * Targets are 56pt and carry their label at all times: this app is used by
 * people with low vision, so an icon alone is not enough and neither is a
 * label that only appears when selected.
 */
export function TabBar({ state, navigateToTab, emitter }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // Lift clear of the home indicator, but keep a floor so the bar still floats
  // on devices that report no bottom inset.
  const bottom = Math.max(insets.bottom, spacing.md);

  return (
    <View style={[styles.wrap, { paddingBottom: bottom }]} pointerEvents="box-none">
      <LiquidGlass intensity={60} radius={radius.xl} style={[styles.bar, shadow.card]}>
        <View style={styles.row} accessibilityRole="tablist">
          {state.routes.map((route, index) => {
            const tab = TABS[route.name];
            if (!tab) return null;
            const focused = state.index === index;

            const onPress = () => {
              // This router version hands the bar an emitter and a key-based
              // navigate, not a navigation prop; honour tabPress so a screen
              // can still veto the move (a recording in progress, say).
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (focused || event.defaultPrevented) return;
              Haptics.selectionAsync().catch(() => {});
              navigateToTab(route.key);
            };

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={tab.label}
                accessibilityHint={tab.hint}
                style={styles.item}
                hitSlop={6}
              >
                <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
                  <Ionicons
                    name={tab.icon}
                    size={focused ? 21 : 20}
                    color={focused ? colors.onLight : colors.textMuted}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  style={focused ? [styles.label, styles.labelActive] : styles.label}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </LiquidGlass>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
  },
  bar: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  item: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 4,
  },
  iconWrap: {
    width: 40,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The selected tab is the one lit object on the bar.
  iconWrapActive: {
    backgroundColor: colors.lime,
    ...Platform.select({
      ios: { shadowColor: colors.lime, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
      default: {},
    }),
  },
  label: { fontSize: 10.5, letterSpacing: 0.2, color: colors.textFaint },
  labelActive: { color: colors.text, fontWeight: '600' },
});
