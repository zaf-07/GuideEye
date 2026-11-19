import React from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme/tokens';

interface Props {
  children: React.ReactNode;
  /** Pins content to the bottom of the viewport, as on the reference splash. */
  scroll?: boolean;
  footer?: React.ReactNode;
  style?: ViewStyle;
}

export function Screen({ children, scroll = true, footer, style }: Props) {
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
          contentContainerStyle={scroll ? [styles.content, style] : undefined}
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
