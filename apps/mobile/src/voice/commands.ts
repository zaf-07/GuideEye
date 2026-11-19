export type Heard =
  | { kind: 'wake' }
  | { kind: 'command'; text: string };

export type LocalCommand =
  | { type: 'quiet' }
  | { type: 'repeat' }
  | { type: 'back' }
  | { type: 'help' }
  | { type: 'cancel_scheduled' }
  | { type: 'route'; href: string; say: string };

export type Delayed = { seconds: number; command: string };

const WAKE = /\b(?:hey |okay |ok |hi )?(?:guide ?eye|guides?)\b[\s,.!?:;-]*/i;
const CONFIRM = /^\W*(yes|yeah|yep|yup|sure|confirm|go ahead|do it|send it|send|okay|ok|no|nope|cancel|stop|not now|never mind|don't|do not)\b[\w\s,.!']{0,22}$/i;

export const HELP_TEXT =
  'Say Guide, then what you need. For example: take me to the nearest pharmacy. Take me home. ' +
  'Text Tom I am on my way. Call Tim. Where am I. Which way. Set a timer for ten minutes. ' +
  'In fifteen minutes take me home. What is in front of me. Open settings. Go back. Stop talking.';

export function extractCommand(
  transcript: string,
  options: { awaitingConfirm?: boolean; followUp?: boolean; wakeRequired?: boolean } = {},
): Heard | null {
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const wake = WAKE.exec(text);
  if (wake) {
    const command = text.slice(wake.index + wake[0].length).trim();
    return command ? { kind: 'command', text: command } : { kind: 'wake' };
  }
  if (options.awaitingConfirm && CONFIRM.test(text)) return { kind: 'command', text };
  if (options.followUp || options.wakeRequired === false) return { kind: 'command', text };
  return null;
}

const SCREENS: Record<string, { href: string; say: string }> = {
  camera: { href: '/camera?mode=scene&pocket=true', say: 'Opening the camera. Point the phone forward.' },
  settings: { href: '/main/settings', say: 'Opening settings.' },
  bridge: { href: '/bridge', say: 'Opening the bridge. Voice commands pause on this screen.' },
  memory: { href: '/memory', say: 'Opening memory.' },
  memories: { href: '/memory', say: 'Opening memory.' },
  family: { href: '/family', say: 'Opening family contacts.' },
  contacts: { href: '/family', say: 'Opening family contacts.' },
  assistant: { href: '/assistant', say: 'Opening the assistant.' },
  vision: { href: '/main/vision', say: 'Opening vision.' },
  hearing: { href: '/main/hearing', say: 'Opening hearing.' },
};

const OPEN_SCREEN = new RegExp(
  `^(?:please )?(?:open|show|go to|launch|start)\\s+(?:the\\s+|my\\s+)?(${Object.keys(SCREENS).join('|')})\\b`,
  'i',
);
const LOOK = /\bwhat(?:'s| is) (?:in front of me|ahead of me|ahead)\b|\bwhat (?:do|can) you see\b|\bdescribe (?:the |my |this )?(?:scene|surroundings|room|view)\b|\blook around\b|\bstart (?:the )?pocket\b/i;
const QUIET = /^(?:please )?(?:stop talking|be quiet|quiet|silence|shut up|hush)\b/i;
const REPEAT = /^(?:please )?(?:repeat(?: that| it)?|say (?:that|it) again|what did you say)[\s.!?]*$/i;
const BACK = /^(?:please )?(?:go back|back|close(?: this| it)?)[\s.!?]*$/i;
const HOME_SCREEN = /\b(?:home screen|main (?:menu|screen))\b/i;
const HELP = /^(?:help|what can i say|voice commands|what are the commands)[\s.!?]*$/i;
const CANCEL_SCHEDULED = /^cancel (?:the |my |that )?(?:scheduled|delayed|later)\b/i;

export function localCommand(text: string): LocalCommand | null {
  const value = text.trim();
  if (QUIET.test(value)) return { type: 'quiet' };
  if (REPEAT.test(value)) return { type: 'repeat' };
  if (BACK.test(value)) return { type: 'back' };
  if (HELP.test(value)) return { type: 'help' };
  if (CANCEL_SCHEDULED.test(value)) return { type: 'cancel_scheduled' };
  if (HOME_SCREEN.test(value)) return { type: 'route', href: '/main', say: 'Home screen.' };
  const screen = OPEN_SCREEN.exec(value);
  if (screen) return { type: 'route', ...SCREENS[screen[1].toLowerCase()] };
  if (LOOK.test(value)) return { type: 'route', ...SCREENS.camera };
  return null;
}

const UNITS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

export function parseNumber(value: string): number | null {
  const text = value.trim().toLowerCase().replace(/-/g, ' ');
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (text === 'half a' || text === 'half an') return 0.5;
  let total = 0;
  let seen = false;
  for (const word of text.split(/\s+/)) {
    if (word === 'and') continue;
    if (word in TENS) total += TENS[word];
    else if (word in UNITS) total += UNITS[word];
    else return null;
    seen = true;
  }
  return seen ? total : null;
}

const UNIT_SECONDS: Record<string, number> = { second: 1, minute: 60, hour: 3600 };
const AMOUNT = "((?:\\d+(?:\\.\\d+)?|half an?|[a-z]+(?:[ -][a-z]+)?))\\s+(second|minute|hour)s?";
const DELAY_PREFIX = new RegExp(`^(?:in|after)\\s+${AMOUNT}[\\s,]+(?:please\\s+)?(.+)$`, 'i');
const DELAY_SUFFIX = new RegExp(`^(.+?)[\\s,]+(?:in|after)\\s+${AMOUNT}[\\s.!?]*$`, 'i');
const TIMER_WORDS = /\b(remind|reminder|timer|alarm)\b/i;
const MOVE = /^(?:please )?(?:(?:take|guide|walk|navigate|lead|bring|get) me\b|(?:go|head|navigate)\s+(?:to|home)\b|let'?s go\b|we(?:'re| are) going\b)/i;
const MAX_DELAY_SECONDS = 12 * 3600;

function delayed(amount: string, unit: string, command: string): Delayed | null {
  const count = parseNumber(amount);
  const rest = command.trim().replace(/[\s.!?]+$/, '');
  if (count === null || count <= 0 || !rest) return null;
  const seconds = Math.round(count * UNIT_SECONDS[unit.toLowerCase()]);
  if (seconds < 1 || seconds > MAX_DELAY_SECONDS) return null;
  return { seconds, command: rest };
}

export function parseDelay(text: string): Delayed | null {
  const value = text.trim();
  if (TIMER_WORDS.test(value)) return null;
  const prefix = DELAY_PREFIX.exec(value);
  if (prefix) return delayed(prefix[1], prefix[2], prefix[3]);
  const suffix = DELAY_SUFFIX.exec(value);
  if (suffix && MOVE.test(suffix[1])) return delayed(suffix[2], suffix[3], suffix[1]);
  return null;
}

export function spokenDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = Math.round((seconds / 3600) * 10) / 10;
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}
