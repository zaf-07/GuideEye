import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';

/** Segmented rule across the top of onboarding, as in the reference design. */
export function Progress({ step, total }: { step: number; total: number }) {
  return (
    <View
      style={styles.row}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of ${total}`}
      accessibilityValue={{ min: 1, max: total, now: step }}
    >
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.seg, i < step && styles.segOn]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md },
  seg: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  segOn: { backgroundColor: colors.text },
});
