import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Button, ChoiceCard, Display, Progress, Screen, Text } from '../../components';
import { useDraft, TOTAL_STEPS } from './draft';
import { ImpairmentId } from '../../state/profile';
import { colors, spacing } from '../../theme/tokens';

/**
 * The fork in the road. Everything after this — onboarding steps, home
 * screen, even which features exist — is decided here.
 */
export function ImpairmentScreen() {
  const { draft, set } = useDraft();
  const current: ImpairmentId | undefined = draft.impairments[0];

  const choose = (id: ImpairmentId) => set({ impairments: [id] });

  const next = () => {
    if (!current) return;
    router.push(current === 'vision' ? '/onboarding/vision' : '/onboarding/hearing');
  };

  return (
    <Screen
      footer={
        <Button
          label="Continue"
          onPress={next}
          disabled={!current}
          hint="Moves to the next setup step."
        />
      }
    >
      <Progress step={1} total={TOTAL_STEPS} />
      <Display lead="How will you" accent="use GuideEye?" />
      <Text variant="body" muted style={{ marginBottom: spacing.md }}>
        Choose the experience you want first. You can switch modes later without
        losing your settings.
      </Text>

      <View style={{ gap: spacing.sm }}>
        <ChoiceCard
          title="Blind or low vision"
          subtitle="Voice-first surroundings, reading and walking guidance"
          selected={current === 'vision'}
          onPress={() => choose('vision')}
          hint="Sets up the camera guidance features."
          icon={<Ionicons name="eye-outline" size={28} color={current === 'vision' ? colors.onLight : colors.lime} />}
        />
        <ChoiceCard
          title="Deaf or hard of hearing"
          subtitle="Signing, large captions and visual sound alerts"
          selected={current === 'hearing'}
          onPress={() => choose('hearing')}
          hint="Sets up the sign language bridge."
          icon={<MaterialCommunityIcons name="hand-wave-outline" size={28} color={current === 'hearing' ? colors.onLight : colors.lime} />}
        />
        <ChoiceCard
          title="Communicate with someone"
          subtitle="Translate between speech, text and supported signs"
          selected={current === 'communicator'}
          onPress={() => choose('communicator')}
          hint="Sets up conversation tools for a hearing person."
          icon={<MaterialCommunityIcons name="account-voice" size={28} color={current === 'communicator' ? colors.onLight : colors.lime} />}
        />
      </View>

      <Text variant="caption" faint style={{ marginTop: spacing.md }}>
        Not sure? Choose the closest one. Nothing here is locked in.
      </Text>
    </Screen>
  );
}
