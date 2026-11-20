import { Profile, hasVisionTrack } from '../../state/profile';

/**
 * What the home tab shows, decided by who is using the app.
 *
 * The first screen used to be the same list of three modes for everyone, so a
 * blind user was two screens away from the one thing they open the app for.
 * Now the user's own mode is the first and largest control, the things they
 * use next sit under it, and the other modes are a short list at the end.
 */
export type HomeAction = {
  key: string;
  title: string;
  blurb: string;
  /** A few words for the small tiles, where the full sentence does not fit. */
  short: string;
  icon: string;
  href: string;
  /** Sent to the assistant when the action is a spoken request. */
  prompt?: string;
};

export type HomeMode = 'vision' | 'hearing' | 'communicator';

export type HomePlan = {
  mode: HomeMode;
  /** One line under the greeting, or empty. */
  status: string;
  primary: HomeAction;
  actions: HomeAction[];
  more: HomeAction[];
};

const ACTIONS = {
  pocket: {
    key: 'pocket',
    title: 'Start pocket assistant',
    blurb: 'Put the phone in your chest pocket, camera facing out. GuideEye tells you what is around you.',
    short: 'Hear what is around you.',
    icon: 'eye',
    href: '/camera?mode=scene&pocket=true',
  },
  ask: { key: 'ask', title: 'Ask GuideEye', blurb: 'Directions, reading, messages and timers.', short: 'Directions, reading, messages.', icon: 'mic', href: '/assistant' },
  home: { key: 'home', title: 'Take me home', blurb: 'Walking directions to your home.', short: 'Walking directions.', icon: 'home', href: '/assistant', prompt: 'Take me home' },
  family: { key: 'family', title: 'Family', blurb: 'Call someone or share where you are.', short: 'Call or share location.', icon: 'people', href: '/family' },
  memory: { key: 'memory', title: 'Memory', blurb: 'What GuideEye remembers for you.', short: 'What GuideEye remembers.', icon: 'albums', href: '/memory' },
  captions: {
    key: 'captions',
    title: 'Live captions',
    blurb: 'What people say, as large text you can read at a glance.',
    short: 'Speech as large text.',
    icon: 'chatbox-ellipses',
    href: '/bridge?role=deaf&output=text',
  },
  avatar: {
    key: 'avatar',
    title: 'Sign avatar',
    blurb: 'Speech and text shown as ASL signs.',
    short: 'Speech shown as signs.',
    icon: 'hand-left',
    href: '/translate',
  },
  signs: { key: 'signs', title: 'Read my signs', blurb: 'The camera reads your signing aloud.', short: 'Signing read aloud.', icon: 'videocam', href: '/camera?initialMode=sign' },
  bridge: {
    key: 'bridge',
    title: 'Start a conversation',
    blurb: 'One person signs, the other speaks. GuideEye carries it both ways.',
    short: 'Signing and speech, both ways.',
    icon: 'swap-horizontal',
    href: '/bridge?role=both',
  },
} satisfies Record<string, HomeAction>;

export function homeMode(profile: Pick<Profile, 'impairments'>): HomeMode {
  if (hasVisionTrack(profile as Profile)) return 'vision';
  if (profile.impairments.includes('hearing')) return 'hearing';
  return 'communicator';
}

export function homePlan(profile: Profile): HomePlan {
  const mode = homeMode(profile);
  if (mode === 'vision') {
    return {
      mode,
      status: profile.voiceControl !== false ? 'Voice is on. Say “Guide”, then what you need.' : '',
      primary: ACTIONS.pocket,
      actions: [ACTIONS.ask, ACTIONS.home, ACTIONS.family, ACTIONS.memory],
      more: [{ ...ACTIONS.bridge, title: 'Talk with a deaf person' }, ACTIONS.captions],
    };
  }
  if (mode === 'hearing') {
    // Someone who chose the sign avatar for replies reads signs first; everyone else reads text first.
    const signFirst = profile.replyFormat === 'avatar';
    return {
      mode,
      status: '',
      primary: signFirst ? ACTIONS.avatar : ACTIONS.captions,
      actions: [signFirst ? ACTIONS.captions : ACTIONS.avatar, ACTIONS.signs, { ...ACTIONS.bridge, title: 'Talk with a blind person' }, ACTIONS.memory],
      more: [ACTIONS.pocket],
    };
  }
  return {
    mode,
    status: '',
    primary: ACTIONS.bridge,
    actions: [ACTIONS.captions, ACTIONS.avatar, ACTIONS.signs, ACTIONS.pocket],
    more: [ACTIONS.family, ACTIONS.memory],
  };
}

/** Tabs that are not this user's mode are left out of the bar; the home tab still links to them. */
export function hiddenTab(profile: Pick<Profile, 'impairments'>): 'vision' | 'hearing' | null {
  const mode = homeMode(profile);
  if (mode === 'vision') return 'hearing';
  if (mode === 'hearing') return 'vision';
  return null;
}
