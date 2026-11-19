import { useEffect, useRef } from 'react';
import { Profile } from '../state/profile';
import { remember } from './index';
import { Episode, EpisodeEntity } from './types';

/**
 * The bridge between live features and the memory graph.
 *
 * Two rules shape everything here. Capture must never block or slow what the
 * user is doing — a memory write is not worth a dropped frame while someone
 * is crossing a road. And capture must be sparse: the detector fires several
 * times a second, but a memory is only worth recording when the scene has
 * actually changed.
 */

/** Don't record the same set of labels more than once in this window. */
export const SCENE_REPEAT_MS = 30_000;

/** Objects below this confidence are noise, not memories. */
export const MIN_CONFIDENCE = 0.45;

export interface SceneObservation {
  label: string;
  confidence?: number;
  distance_m?: number | null;
}

/** Stable identity for a scene: which things, not how many frames. */
export function sceneKey(objects: SceneObservation[]): string {
  return Array.from(new Set(objects.map((o) => o.label.toLowerCase().trim())))
    .filter(Boolean)
    .sort()
    .join('|');
}

export function toEntities(objects: SceneObservation[], hazard = false): EpisodeEntity[] {
  const seen = new Set<string>();
  const out: EpisodeEntity[] = [];
  for (const object of objects) {
    const label = object.label?.trim();
    if (!label) continue;
    if ((object.confidence ?? 1) < MIN_CONFIDENCE) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: hazard ? 'hazard' : 'object',
      label,
      metadata: {
        ...(object.confidence != null ? { confidence: Number(object.confidence.toFixed(2)) } : {}),
        ...(object.distance_m != null ? { distance_m: object.distance_m } : {}),
      },
    });
  }
  return out;
}

/**
 * Records a scene once it settles, and not again until it changes.
 *
 * Deliberately keyed on the *set* of labels rather than their positions: a
 * user turning their head should not write a new memory, but walking into a
 * different room should.
 */
export function useSceneMemory(
  profile: Profile,
  input: { place?: string; objects: SceneObservation[]; enabled?: boolean },
) {
  const lastKey = useRef('');
  const lastAt = useRef(0);

  useEffect(() => {
    if (input.enabled === false) return;
    const entities = toEntities(input.objects);
    if (!entities.length) return;

    const key = sceneKey(input.objects);
    const now = Date.now();
    if (key === lastKey.current && now - lastAt.current < SCENE_REPEAT_MS) return;
    lastKey.current = key;
    lastAt.current = now;

    const episode: Episode = {
      entities,
      place: input.place,
      at: now,
      summary: `Saw ${entities.map((e) => e.label).join(', ')}${input.place ? ` at ${input.place}` : ''}.`,
    };
    // Fire and forget: capture must never delay narration.
    remember(profile, episode).catch(() => {});
  }, [profile, input.place, sceneKey(input.objects), input.enabled]);
}

/**
 * Records one turn of a Bridge conversation. Conversation turns are linked to
 * their speaker, so later recall can answer "what did Maria ask me about?"
 * rather than only matching loose words.
 */
export function rememberConversationTurn(
  profile: Profile,
  turn: { text: string; speaker?: string; place?: string; signed?: boolean },
) {
  const text = turn.text?.trim();
  if (!text) return;
  const entities: EpisodeEntity[] = [
    {
      kind: 'conversation',
      label: text.length > 64 ? `${text.slice(0, 61)}…` : text,
      detail: text,
      metadata: { signed: Boolean(turn.signed) },
    },
  ];
  remember(profile, {
    entities,
    speaker: turn.speaker,
    place: turn.place,
    at: Date.now(),
    summary: turn.speaker ? `${turn.speaker} said: ${text}` : text,
  }).catch(() => {});
}

/** Records a hazard the user confirmed, which outranks ordinary objects. */
export function rememberHazard(profile: Profile, label: string, place?: string) {
  if (!label?.trim()) return;
  remember(profile, {
    entities: [{ kind: 'hazard', label: label.trim() }],
    place,
    at: Date.now(),
    summary: `Hazard: ${label}${place ? ` at ${place}` : ''}.`,
  }).catch(() => {});
}
