/**
 * Decides what scene assist says out loud, and when.
 *
 * The detector produces a result a couple of times a second. Speaking each one
 * turned pocket mode into a stutter: every new result cut the previous
 * sentence off, a box that wobbled by ten centimetres counted as a new scene,
 * and the assistant's own answer was interrupted by "chair ahead". The rules
 * here are the opposite of that:
 *
 *  - say something only when which-things-are-where has changed, and has
 *    stayed changed for a moment (one flickering frame is not a change);
 *  - never talk over the assistant, and never repeat the same thing within a
 *    short while;
 *  - a full-sentence description of the scene is rarer than a hazard phrase;
 *  - "nothing recognised" is never volunteered: silence already says it, and
 *    it must not sound like "the way is clear".
 *
 * Pure logic with the clock passed in, so it can be tested without a phone.
 */

export type NarrationKind = 'objects' | 'blocked' | 'empty' | 'description';

export type NarrationCandidate = {
  /** Identity of what would be said: equal keys mean "nothing new". */
  key: string;
  text: string;
  kind: NarrationKind;
  /** Skip the settle delay (something is coming closer). */
  urgent?: boolean;
};

export type NarratorOptions = {
  /** A change must persist this long before it is spoken. */
  settleMs: number;
  /** Shortest pause between two spoken phrases. */
  minGapMs: number;
  /** The same phrase is not repeated within this window. */
  repeatMs: number;
  /** "The camera can't see" is repeated this often while it stays true. */
  blockedRepeatMs: number;
  /** Shortest pause between two full descriptions. */
  descriptionGapMs: number;
};

export const DEFAULT_NARRATION: NarratorOptions = {
  settleMs: 600,
  minGapMs: 2500,
  repeatMs: 15000,
  blockedRepeatMs: 30000,
  descriptionGapMs: 15000,
};

function words(text: string) {
  return new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
}

/** How alike two sentences are, 0 to 1, by the longer words they share. */
export function similarity(left: string, right: string) {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export class Narrator {
  private readonly options: NarratorOptions;
  private pendingKey = '';
  private pendingSince = 0;
  private lastSpokenAt = 0;
  private lastHazardKey = '';
  private lastDescription = '';
  private lastDescriptionAt = 0;
  private readonly spokenAt = new Map<string, number>();

  constructor(options: Partial<NarratorOptions> = {}) {
    this.options = { ...DEFAULT_NARRATION, ...options };
  }

  reset() {
    this.pendingKey = '';
    this.pendingSince = 0;
    this.lastSpokenAt = 0;
    this.lastHazardKey = '';
    this.lastDescription = '';
    this.lastDescriptionAt = 0;
    this.spokenAt.clear();
  }

  /** The sentence most recently spoken as a full description. */
  get description() {
    return this.lastDescription;
  }

  /**
   * Offer the newest result. Returns the text to speak now, or null.
   * `busy` is true while the assistant is speaking or working: nothing is
   * said then, and a change that is still true afterwards is spoken later.
   */
  offer(candidate: NarrationCandidate | null, now: number, busy = false): string | null {
    if (!candidate || !candidate.text.trim() || candidate.kind === 'empty') {
      if (candidate?.kind === 'empty') {
        // The scene emptied: the next object is news again, even the same one.
        this.pendingKey = '';
        this.lastHazardKey = '';
      }
      return null;
    }
    if (candidate.kind === 'description') return this.offerDescription(candidate, now, busy);

    if (candidate.key !== this.pendingKey) {
      this.pendingKey = candidate.key;
      this.pendingSince = now;
    }
    if (busy) return null;
    if (candidate.key === this.lastHazardKey) {
      // Still the same scene. Only "can't see" is worth repeating.
      if (candidate.kind !== 'blocked') return null;
      if (now - (this.spokenAt.get(candidate.key) ?? 0) < this.options.blockedRepeatMs) return null;
    }
    if (!candidate.urgent && now - this.pendingSince < this.options.settleMs) return null;
    if (now - this.lastSpokenAt < (candidate.urgent ? 1200 : this.options.minGapMs)) return null;
    const repeat = candidate.kind === 'blocked' ? this.options.blockedRepeatMs : this.options.repeatMs;
    const previous = this.spokenAt.get(candidate.key);
    if (previous !== undefined && now - previous < repeat) {
      // Said recently (the scene flipped away and back). Accept it as current
      // without saying it again.
      this.lastHazardKey = candidate.key;
      return null;
    }
    this.lastHazardKey = candidate.key;
    return this.spoke(candidate.key, now, candidate.text);
  }

  private offerDescription(candidate: NarrationCandidate, now: number, busy: boolean): string | null {
    if (busy) return null;
    if (candidate.text === this.lastDescription) return null;
    if (this.lastDescription && now - this.lastDescriptionAt < this.options.descriptionGapMs) return null;
    if (now - this.lastSpokenAt < this.options.minGapMs) return null;
    // The model rewords the same scene every time; that is not news.
    if (this.lastDescription && similarity(candidate.text, this.lastDescription) >= 0.5) return null;
    this.lastDescription = candidate.text;
    this.lastDescriptionAt = now;
    return this.spoke(`description:${candidate.key}`, now, candidate.text);
  }

  private spoke(key: string, now: number, text: string) {
    this.lastSpokenAt = now;
    this.spokenAt.set(key, now);
    if (this.spokenAt.size > 64) {
      const oldest = [...this.spokenAt.entries()].sort((a, b) => a[1] - b[1])[0];
      if (oldest) this.spokenAt.delete(oldest[0]);
    }
    return text;
  }
}
