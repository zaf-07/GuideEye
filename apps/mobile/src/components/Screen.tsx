import React from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme/tokens';

/**
 * Clearance for the floating tab bar: its 56pt targets plus the padding it
 * sits in. The safe-area inset is already handled by the SafeAreaView below,
 * and by the bar itself, so it is deliberately not counted twice.
 */
const TAB_BAR_CLEARANCE = 88;

interface Props {
  children: React.ReactNode;
  /** Pins content to the bottom of the viewport, as on the reference splash. */
  scroll?: boolean;
  footer?: React.ReactNode;
  style?: ViewStyle;
  /** Set on screens inside the tab group, so the bar cannot cover the last card. */
  underTabBar?: boolean;
}

export function Screen({ children, scroll = true, footer, style, underTabBar }: Props) {
  const Body = scroll ? ScrollView : View;
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.canvasTop, colors.canvas, colors.canvasDeep]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Body
          style={styles.body}
          contentContainerStyle={
            scroll
              ? [styles.content, underTabBar && { paddingBottom: TAB_BAR_CLEARANCE }, style]
              : undefined
          }
          showsVerticalScrollIndicator={false}
        >
          {children}
        </Body>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  safe: { flex: 1 },
  body: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
});
