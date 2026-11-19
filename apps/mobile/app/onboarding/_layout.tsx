import { Stack } from 'expo-router';
import { DraftProvider } from '../../src/screens/onboarding/draft';
import { useProfile } from '../../src/state/ProfileContext';
import { colors } from '../../src/theme/tokens';

/**
 * Answers live in the draft until the last step commits them, so a user who
 * backs out of onboarding does not half-change the app around themselves.
 */
export default function OnboardingLayout() {
  const { profile } = useProfile();
  return (
    <DraftProvider initial={profile}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.canvasDeep },
          animation: 'slide_from_right',
        }}
      />
    </DraftProvider>
  );
}
