import React, { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { Display, GlassCard, GreetingBar, Screen, Text } from '../../components';
import { useProfile } from '../../state/ProfileContext';
import { hasLocalDetector } from '../../detector';
import { hasVisionTrack } from '../../state/profile';
import { colors, radius, shadow, spacing } from '../../theme/tokens';

const CONTENT = {
  en: {
    userName: (name: string) => (name && name !== 'there' && name !== 'Пользователь') ? name : 'there',
    aiStatusLive: 'On-Device YOLOv8 Active (Offline)',
    aiStatusReady: 'Camera Ready · Local Mode',
    headlineLead: 'GuideEye',
    headlineAccent: 'for everyone',
    headlineSub: 'Select your assistive experience below:',
    blindBadge: '🎧 AUDIO · CHEST POCKET MODE',
    blindTitle: 'Blind or Low Vision',
    blindDesc: 'Place your phone in your chest pocket facing forward. GuideEye announces obstacles, distances, and navigates turn-by-turn in real time.',
    blindBtn: 'Start Pocket Assistant',
    quickNav: 'Quick walking navigation:',
    navCampus: 'Campus',
    navStore: 'Store',
    navHome: 'Home',
    navVoice: 'Voice',
    deafBadge: '🔇 SILENT · VISUAL MODE',
    deafTitle: 'Deaf or Hard of Hearing',
    deafDesc: 'Choose how you prefer to experience incoming speech:',
    avatarBadge: 'L1 NATIVE',
    avatarTitle: '3D Sign Avatar',
    avatarDesc: 'For native signers from childhood: real-time speech translation into 3D ASL animation',
    avatarCta: 'Open Avatar',
    textBadge: 'TEXT',
    textTitle: 'Large Captions',
    textDesc: 'For late-deafened adults: high-contrast, real-time live captions',
    textCta: 'Captions',
    signCameraTitle: 'Read my signs via camera',
    signCameraDesc: 'Point camera at your hands — GuideEye speaks your signs aloud',
    bridgeBadge: '🤝 TWO-WAY DIALOGUE',
    bridgeTitle: 'Conversation Bridge',
    bridgeDesc: 'Deaf signs into camera → Blind hears spoken voice.\nBlind speaks aloud → Deaf sees 3D avatar & captions.',
    bridgeBtn: 'Start Conversation on this Device',
    alsTitle: 'Eye Tracking (ALS / Motor)',
    alsDesc: 'Hands-free eye navigation for motor impairments · In active development',
    alsBadge: 'SOON',
    welcomeVoice: 'Welcome to GuideEye. Select your mode: Blind or Low Vision, or Deaf or Hard of Hearing.',
    blindVoice: 'Starting pocket assistant. Camera is active. Place your phone in your chest pocket.',
  },
  ru: {
    userName: (name: string) => (name && name !== 'there') ? name : 'друг',
    aiStatusLive: 'Нативная нейросеть YOLOv8 активна (Автономно)',
    aiStatusReady: 'Камера готова · Локальный режим',
    headlineLead: 'GuideEye',
    headlineAccent: 'для каждого',
    headlineSub: 'Выберите свой режим взаимодействия ниже:',
    blindBadge: '🎧 АУДИО · РЕЖИМ В КАРМАНЕ',
    blindTitle: 'Я не вижу',
    blindDesc: 'Поместите телефон в нагрудный карман камерой вперед. GuideEye в реальном времени озвучивает препятствия, расстояние и ведет по маршруту.',
    blindBtn: 'Запустить ассистента в кармане',
    quickNav: 'Быстрая пешеходная навигация:',
    navCampus: 'В универ',
    navStore: 'В магазин',
    navHome: 'Домой',
    navVoice: 'Голос',
    deafBadge: '🔇 БЕЗ ЗВУКА · ВИЗУАЛЬНЫЙ',
    deafTitle: 'Я не слышу',
    deafDesc: 'Выберите удобный способ восприятия устной речи собеседника:',
    avatarBadge: 'L1 РОДНОЙ',
    avatarTitle: '3D-Аватар Жестов',
    avatarDesc: 'Для глухих с детства: мгновенный перевод речи в 3D анимацию жестового языка',
    avatarCta: 'Открыть аватар',
    textBadge: 'ТЕКСТ',
    textTitle: 'Крупный текст',
    textDesc: 'Для оглохших позже: высококонтрастные крупные субтитры в реальном времени',
    textCta: 'Субтитры',
    signCameraTitle: 'Чтение моих жестов камерой',
    signCameraDesc: 'Покажите жесты в камеру — приложение озвучит их вслух',
    bridgeBadge: '🤝 ДИАЛОГ ДВУХ МИРОВ',
    bridgeTitle: 'Мост общения',
    bridgeDesc: 'Слепой говорит голосом → глухой видит 3D-аватар и субтитры.\nГлухой показывает жесты → слепой слышит речь из динамика.',
    bridgeBtn: 'Диалог на этом экране',
    alsTitle: 'Управление глазами (БАС / ALS)',
    alsDesc: 'Для людей с нарушением моторики · В разработке',
    alsBadge: 'СКОРО',
    welcomeVoice: 'Добро пожаловать в GuideEye. Выберите режим: Я не вижу, или Я не слышу.',
    blindVoice: 'Запуск режима ассистента. Камера активна. Вы можете убрать телефон в нагрудный карман.',
  },
} as const;

/**
 * Which part of the old single-scroll home this render is responsible for.
 * The sections themselves are unchanged — the tab layout just asks for one at
 * a time instead of stacking all of them in a single scroll view.
 */
export type HomeSection = 'home' | 'vision' | 'hearing' | 'connect';

/** The accent word and the line under the headline, per tab. */
const SECTION_ACCENT: Record<HomeSection, string> = {
  home: 'for everyone',
  vision: 'for your eyes',
  hearing: 'for your ears',
  connect: 'between you both',
};
const SECTION_SUB: Record<HomeSection, string> = {
  home: 'Choose where you want to go:',
  vision: 'Pocket assistant and walking navigation.',
  hearing: 'Sign avatar, large captions and sign reading.',
  connect: 'One device, two people, both directions.',
};

/** The cards on the home tab, each a door to one of the other tabs. */
const OVERVIEW: {
  tab: '/main/vision' | '/main/hearing' | '/main/connect';
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title: string;
  desc: string;
}[] = [
  { tab: '/main/vision', icon: 'eye', tint: colors.lime, title: 'Blind or Low Vision', desc: 'Pocket assistant, obstacles and turn-by-turn walking' },
  { tab: '/main/hearing', icon: 'hand-left', tint: '#5BE1F0', title: 'Deaf or Hard of Hearing', desc: '3D sign avatar, large captions, read my signs' },
  { tab: '/main/connect', icon: 'swap-horizontal', tint: '#C9A7FF', title: 'Conversation Bridge', desc: 'Deaf signs in, blind hears it — and back again' },
];

// The welcome is said once per launch. Every tab renders this screen, so
// without the flag it was repeated on each tab the user opened.
let welcomed = false;

export function HomeScreen({ section = 'home' }: { section?: HomeSection } = {}) {
  const { profile, ready } = useProfile();
  const [detectorReady, setDetectorReady] = useState(false);
  const [lang, setLang] = useState<'en' | 'ru'>('en');

  const t = CONTENT[lang];

  useEffect(() => {
    setDetectorReady(hasLocalDetector());
    if (welcomed || !ready) return;
    welcomed = true;
    // With hands-free voice on, the voice assistant greets the user itself
    // ("GuideEye is listening…"); a second welcome only delays the microphone.
    if (Platform.OS !== 'web' && hasVisionTrack(profile) && profile.voiceControl !== false) return;
    Speech.speak(t.welcomeVoice, {
      language: lang === 'en' ? 'en-US' : 'ru-RU',
      rate: 0.95,
    });
  }, [lang, ready]);

  const toggleLanguage = () => {
    const nextLang = lang === 'en' ? 'ru' : 'en';
    setLang(nextLang);
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    Speech.stop();
    Speech.speak(nextLang === 'en' ? 'English language selected' : 'Выбран русский язык', {
      language: nextLang === 'en' ? 'en-US' : 'ru-RU',
      rate: 1.0,
    });
  };

  const triggerHaptic = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium) => {
    Haptics.impactAsync(style).catch(() => {});
  };

  const openBlindMode = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
    Speech.stop();
    Speech.speak(t.blindVoice, {
      language: lang === 'en' ? 'en-US' : 'ru-RU',
      rate: 0.95,
    });
    router.push('/camera?mode=scene&pocket=true');
  };

  const openSignAvatar = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/translate');
  };

  const openSubtitles = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/bridge?role=deaf&output=text');
  };

  const openSignReader = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/camera?initialMode=sign');
  };

  const openBridge = () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
    router.push('/bridge?role=both');
  };

  const openNavigation = (destination?: string) => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    if (destination) {
      router.push({ pathname: '/assistant', params: { prompt: `Take me to ${destination}` } });
    } else {
      router.push('/assistant');
    }
  };

  return (
    <Screen underTabBar>
      <GreetingBar
        name={t.userName(profile.displayName || '')}
        onSettings={() => router.navigate('/main/settings')}
      />

      {/* AI Status & Language Row */}
      <View style={styles.statusRowContainer}>
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, detectorReady && styles.statusDotLive]} />
          <Text variant="caption" style={styles.statusPillText}>
            {detectorReady ? t.aiStatusLive : t.aiStatusReady}
          </Text>
        </View>

        <Pressable
          onPress={toggleLanguage}
          style={styles.langPill}
          accessibilityLabel={`Language switch. Current language: ${lang.toUpperCase()}`}
        >
          <Ionicons name="globe-outline" size={13} color={colors.lime} />
          <Text style={styles.langPillText}>{lang === 'en' ? 'EN' : 'RU'}</Text>
        </Pressable>
      </View>

      <View style={styles.headerBlock}>
        <Display lead={t.headlineLead} accent={SECTION_ACCENT[section] ?? t.headlineAccent} />
        <Text variant="body" muted style={{ marginTop: 2 }}>
          {SECTION_SUB[section] ?? t.headlineSub}
        </Text>
      </View>

      {/* The home tab is a way in to the others, not a copy of them. */}
      {section === 'home' ? (
        <View style={styles.overviewGrid}>
          {OVERVIEW.map((entry) => (
            <Pressable
              key={entry.tab}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                router.navigate(entry.tab);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${entry.title}. ${entry.desc}`}
              style={({ pressed }) => [styles.overviewCard, pressed && styles.cardPressed]}
            >
              <View style={[styles.overviewIcon, { backgroundColor: entry.tint }]}>
                <Ionicons name={entry.icon} size={22} color={colors.onLight} />
              </View>
              <Text variant="section" color={colors.text} style={styles.overviewTitle}>
                {entry.title}
              </Text>
              <Text variant="caption" muted style={styles.overviewDesc}>
                {entry.desc}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* ========================================================================= */}
      {/* MODE 1: BLIND / LOW VISION (CHEST POCKET ASSISTANT)                       */}
      {/* ========================================================================= */}
      {section === 'vision' ? (
      <View style={styles.modeSection}>
        <Pressable
          onPress={openBlindMode}
          accessibilityRole="button"
          accessibilityLabel={`${t.blindTitle}. ${t.blindDesc}`}
          style={({ pressed }) => [styles.blindCard, shadow.card, pressed && styles.cardPressed]}
        >
          <View style={styles.cardHeaderRow}>
            <View style={styles.iconCircleLime}>
              <Ionicons name="eye" size={28} color={colors.onLight} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.badgeLime}>
                <Text style={styles.badgeTextLime}>{t.blindBadge}</Text>
              </View>
              <Text variant="title" color={colors.text} style={styles.cardTitle}>
                {t.blindTitle}
              </Text>
            </View>
          </View>

          <Text variant="body" muted style={styles.cardDescription}>
            {t.blindDesc}
          </Text>

          {/* Quick launch button inside card */}
          <View style={styles.limeActionButton}>
            <Ionicons name="scan-outline" size={20} color={colors.onLight} />
            <Text style={styles.limeActionButtonText}>{t.blindBtn}</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.onLight} />
          </View>

          {/* Walking Navigation Quick Destinations */}
          <View style={styles.navRow}>
            <Text variant="caption" faint style={{ width: '100%', marginBottom: 4 }}>
              {t.quickNav}
            </Text>
            <Pressable
              onPress={(e) => { e.stopPropagation(); openNavigation('university'); }}
              style={styles.navPill}
              accessibilityLabel={t.navCampus}
            >
              <Ionicons name="school-outline" size={14} color={colors.lime} />
              <Text style={styles.navPillText}>{t.navCampus}</Text>
            </Pressable>
            <Pressable
              onPress={(e) => { e.stopPropagation(); openNavigation('supermarket'); }}
              style={styles.navPill}
              accessibilityLabel={t.navStore}
            >
              <Ionicons name="cart-outline" size={14} color={colors.lime} />
              <Text style={styles.navPillText}>{t.navStore}</Text>
            </Pressable>
            <Pressable
              onPress={(e) => { e.stopPropagation(); openNavigation('home'); }}
              style={styles.navPill}
              accessibilityLabel={t.navHome}
            >
              <Ionicons name="home-outline" size={14} color={colors.lime} />
              <Text style={styles.navPillText}>{t.navHome}</Text>
            </Pressable>
            <Pressable
              onPress={(e) => { e.stopPropagation(); openNavigation(); }}
              style={[styles.navPill, styles.navPillMic]}
              accessibilityLabel={t.navVoice}
            >
              <Ionicons name="mic" size={14} color={colors.onLight} />
              <Text style={[styles.navPillText, { color: colors.onLight }]}>{t.navVoice}</Text>
            </Pressable>
          </View>
        </Pressable>
      </View>
      ) : null}

      {/* ========================================================================= */}
      {/* MODE 2: DEAF & HARD OF HEARING (3D AVATAR OR SUBTITLES)                   */}
      {/* ========================================================================= */}
      {section === 'hearing' ? (
      <View style={[styles.modeSection, { marginTop: spacing.lg }]}>
        <View style={styles.deafCard}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.iconCircleCyan}>
              <MaterialCommunityIcons name="hand-wave" size={28} color="#07110F" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.badgeCyan}>
                <Text style={styles.badgeTextCyan}>{t.deafBadge}</Text>
              </View>
              <Text variant="title" color={colors.text} style={styles.cardTitle}>
                {t.deafTitle}
              </Text>
            </View>
          </View>

          <Text variant="body" muted style={styles.cardDescription}>
            {t.deafDesc}
          </Text>

          {/* TWO PRIMARY OUTPUT CHOICES */}
          <View style={styles.outputChoiceGrid}>
            {/* Choice A: 3D Sign Avatar (L1) */}
            <Pressable
              onPress={openSignAvatar}
              accessibilityRole="button"
              accessibilityLabel={`${t.avatarTitle}. ${t.avatarDesc}`}
              style={({ pressed }) => [styles.choiceCardA, pressed && styles.cardPressed]}
            >
              <View style={styles.choiceHeaderRow}>
                <Ionicons name="person" size={20} color={colors.lime} />
                <View style={styles.miniBadgeGreen}>
                  <Text style={styles.miniBadgeText}>{t.avatarBadge}</Text>
                </View>
              </View>
              <Text style={styles.choiceTitle}>{t.avatarTitle}</Text>
              <Text style={styles.choiceSub}>
                {t.avatarDesc}
              </Text>
              <View style={styles.choiceCtaRow}>
                <Text style={styles.choiceCtaText}>{t.avatarCta}</Text>
                <Ionicons name="arrow-forward" size={14} color={colors.lime} />
              </View>
            </Pressable>

            {/* Choice B: Giant Subtitles */}
            <Pressable
              onPress={openSubtitles}
              accessibilityRole="button"
              accessibilityLabel={`${t.textTitle}. ${t.textDesc}`}
              style={({ pressed }) => [styles.choiceCardB, pressed && styles.cardPressed]}
            >
              <View style={styles.choiceHeaderRow}>
                <Ionicons name="document-text" size={20} color="#00E5FF" />
                <View style={styles.miniBadgeCyan}>
                  <Text style={styles.miniBadgeTextCyan}>{t.textBadge}</Text>
                </View>
              </View>
              <Text style={styles.choiceTitle}>{t.textTitle}</Text>
              <Text style={styles.choiceSub}>
                {t.textDesc}
              </Text>
              <View style={styles.choiceCtaRow}>
                <Text style={[styles.choiceCtaText, { color: '#00E5FF' }]}>{t.textCta}</Text>
                <Ionicons name="arrow-forward" size={14} color="#00E5FF" />
              </View>
            </Pressable>
          </View>

          {/* Read My Signs Camera Button */}
          <Pressable
            onPress={openSignReader}
            accessibilityRole="button"
            accessibilityLabel={`${t.signCameraTitle}. ${t.signCameraDesc}`}
            style={({ pressed }) => [styles.signCameraRow, pressed && styles.cardPressed]}
          >
            <Ionicons name="videocam" size={20} color={colors.lime} />
            <View style={{ flex: 1 }}>
              <Text style={styles.signCameraTitle}>{t.signCameraTitle}</Text>
              <Text style={styles.signCameraSub}>{t.signCameraDesc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        </View>
      </View>
      ) : null}

      {/* ========================================================================= */}
      {/* BRIDGE: BLIND <-> DEAF CONVERSATION (ONE DEVICE OR P2P)                   */}
      {/* ========================================================================= */}
      {section === 'connect' ? (
      <View style={[styles.modeSection, { marginTop: spacing.lg }]}>
        <Pressable
          onPress={openBridge}
          accessibilityRole="button"
          accessibilityLabel={`${t.bridgeTitle}. ${t.bridgeDesc}`}
          style={({ pressed }) => [styles.bridgeCard, shadow.card, pressed && styles.cardPressed]}
        >
          <View style={styles.bridgeHeaderRow}>
            <View style={styles.bridgeIconBox}>
              <Ionicons name="swap-horizontal" size={26} color="#B7FF56" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.badgeBridge}>
                <Text style={styles.badgeTextBridge}>{t.bridgeBadge}</Text>
              </View>
              <Text variant="title" color={colors.text} style={styles.cardTitle}>
                {t.bridgeTitle}
              </Text>
            </View>
          </View>

          <Text variant="body" muted style={styles.cardDescription}>
            {t.bridgeDesc}
          </Text>

          <View style={styles.bridgeActionsRow}>
            <View style={styles.bridgeButtonPrimary}>
              <Ionicons name="people" size={18} color="#07110F" />
              <Text style={styles.bridgeButtonText}>{t.bridgeBtn}</Text>
            </View>
          </View>
        </Pressable>
      </View>
      ) : null}

      {/* ========================================================================= */}
      {/* ALS / MOTOR PREVIEW BADGE                                                 */}
      {/* ========================================================================= */}
      {section === 'home' ? (
      <View style={styles.alsContainer}>
        <GlassCard style={styles.alsCard}>
          <View style={styles.alsRow}>
            <Ionicons name="eye-outline" size={20} color={colors.textFaint} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alsTitle}>{t.alsTitle}</Text>
              <Text style={styles.alsSub}>{t.alsDesc}</Text>
            </View>
            <View style={styles.alsPill}>
              <Text style={styles.alsPillText}>{t.alsBadge}</Text>
            </View>
          </View>
        </GlassCard>
      </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  overviewGrid: { gap: spacing.sm, marginTop: spacing.xs },
  overviewCard: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 6,
  },
  overviewIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  overviewTitle: { marginTop: 2 },
  overviewDesc: { lineHeight: 18 },
  statusRowContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  langPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(183, 255, 86, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  langPillText: {
    color: colors.lime,
    fontSize: 12,
    fontWeight: '800',
  },
  headerBlock: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    marginBottom: spacing.xs,
    gap: 7,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#8E9B8D',
  },
  statusDotLive: {
    backgroundColor: colors.lime,
  },
  statusPillText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  modeSection: {
    marginTop: spacing.xs,
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
  },
  cardDescription: {
    lineHeight: 20,
    marginVertical: spacing.xs,
  },

  // Blind Mode Card
  blindCard: {
    backgroundColor: '#11221B',
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: 'rgba(183, 255, 86, 0.45)',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircleLime: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.lime,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeLime: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(183, 255, 86, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeTextLime: {
    color: colors.lime,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  limeActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lime,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: spacing.sm,
    gap: 8,
  },
  limeActionButtonText: {
    color: colors.onLight,
    fontSize: 15,
    fontWeight: '800',
  },
  navRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  navPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 5,
  },
  navPillMic: {
    backgroundColor: colors.lime,
  },
  navPillText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },

  // Deaf Mode Card
  deafCard: {
    backgroundColor: '#0F1D24',
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 229, 255, 0.35)',
  },
  iconCircleCyan: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#00E5FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeCyan: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 229, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeTextCyan: {
    color: '#00E5FF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  outputChoiceGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: spacing.xs,
  },
  choiceCardA: {
    flex: 1,
    backgroundColor: 'rgba(183, 255, 86, 0.08)',
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(183, 255, 86, 0.3)',
    justifyContent: 'space-between',
  },
  choiceCardB: {
    flex: 1,
    backgroundColor: 'rgba(0, 229, 255, 0.08)',
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.3)',
    justifyContent: 'space-between',
  },
  choiceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  miniBadgeGreen: {
    backgroundColor: 'rgba(183, 255, 86, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  miniBadgeCyan: {
    backgroundColor: 'rgba(0, 229, 255, 0.2)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  miniBadgeText: {
    color: colors.lime,
    fontSize: 9,
    fontWeight: '800',
  },
  miniBadgeTextCyan: {
    color: '#00E5FF',
    fontSize: 9,
    fontWeight: '800',
  },
  choiceTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  choiceSub: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  choiceCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  choiceCtaText: {
    color: colors.lime,
    fontSize: 11,
    fontWeight: '800',
  },
  signCameraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.md,
    padding: 10,
    marginTop: 10,
    gap: 10,
  },
  signCameraTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  signCameraSub: {
    color: colors.textFaint,
    fontSize: 11,
  },

  // Bridge Card
  bridgeCard: {
    backgroundColor: '#191526',
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: 'rgba(199, 137, 255, 0.4)',
  },
  bridgeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bridgeIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(199, 137, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeBridge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(199, 137, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeTextBridge: {
    color: '#E0B6FF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  bridgeActionsRow: {
    marginTop: spacing.xs,
  },
  bridgeButtonPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B7FF56',
    borderRadius: radius.md,
    paddingVertical: 12,
    gap: 8,
  },
  bridgeButtonText: {
    color: '#07110F',
    fontSize: 14,
    fontWeight: '800',
  },

  // ALS
  alsContainer: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  alsCard: {
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  alsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  alsTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  alsSub: {
    color: colors.textFaint,
    fontSize: 11,
  },
  alsPill: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  alsPillText: {
    color: colors.textFaint,
    fontSize: 9,
    fontWeight: '800',
  },
});
