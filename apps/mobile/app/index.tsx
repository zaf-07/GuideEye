import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { HomeScreen } from '../src/screens/home/HomeScreen';
import { useProfile } from '../src/state/ProfileContext';
import { colors } from '../src/theme/tokens';

/**
 * The gate. There is no account wall: first launch opens onboarding, then the
 * tailored app. Because the home screen reads the profile, finishing or
 * re-running onboarding rebuilds this surface around the new answers.
 */
export default function Index() {
  const { ready, onboarded } = useProfile();

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.lime} size="large" />
      </View>
    );
  }

  if (!onboarded) return <Redirect href="/onboarding/welcome" />;

  return <HomeScreen />;
}
