import { useCallback, useMemo, useRef, useState } from 'react';
import { ASLGestureEngine, type ASLSessionState } from './aslClassifier';
import { HandSignReader, type HandPoint, type HandSignState } from './handSigns';
import type { HandsEvent, TrackedHand } from '../modules/guideeye-hands';

/**
 * Turns the native landmark stream into the same state the browser pipeline
 * produces, so the sign screens do not care which platform found the hands.
 *
 * The classifiers are deliberately kept in refs: they are temporal, carrying
 * hold-to-commit counters and a motion trail across frames, and rebuilding
 * them on a re-render would reset a letter the user is halfway through.
 */

export interface NativeHandsState {
  /** How many hands are in frame right now. */
  handCount: number;
  /** Fingerspelling: the letter being held and the text spelled so far. */
  asl: ASLSessionState | null;
  /** Isolated-sign reader: whole words from handshape and motion. */
  sign: HandSignState | null;
  /** Mean landmark confidence of the strongest hand, 0..1. */
  confidence: number;
  /** Wall-clock time of the last frame that contained a hand. */
  lastSeen: number;
}

const EMPTY: NativeHandsState = {
  handCount: 0,
  asl: null,
  sign: null,
  confidence: 0,
  lastSeen: 0,
};

/** Vision reports the anatomical hand; the classifiers want the signing hand. */
function handedness(hand: TrackedHand): string {
  return hand.chirality === 'left' ? 'Left' : 'Right';
}

function toPoints(hand: TrackedHand): HandPoint[] {
  return hand.landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z }));
}

export function useNativeHands(options: { onWord?: (word: string) => void } = {}) {
  const [state, setState] = useState<NativeHandsState>(EMPTY);
  const onWord = options.onWord;

  const engine = useRef<ASLGestureEngine | null>(null);
  const reader = useRef<HandSignReader | null>(null);
  const lastWord = useRef('');

  if (!engine.current) engine.current = new ASLGestureEngine();
  if (!reader.current) reader.current = new HandSignReader();

  const onHands = useCallback(
    (event: { nativeEvent: HandsEvent }) => {
      const hands = event.nativeEvent?.hands ?? [];
      const now = Date.now();

      if (!hands.length) {
        // Still drive the engines: an absent hand is what ends a letter and
        // inserts a space, so skipping empty frames would stall the sentence.
        const asl = engine.current?.processFrame(undefined) ?? null;
        const sign = reader.current?.feed(null, now) ?? null;
        setState((current) => ({ ...current, handCount: 0, asl, sign, confidence: 0 }));
        return;
      }

      const primary = hands.reduce((best, hand) => (hand.confidence > best.confidence ? hand : best), hands[0]);
      const points = toPoints(primary);
      const asl = engine.current?.processFrame(points, handedness(primary)) ?? null;
      const sign = reader.current?.feed(points, now) ?? null;

      if (sign?.word && sign.word !== lastWord.current) {
        lastWord.current = sign.word;
        onWord?.(sign.word);
      }
      if (!sign?.word) lastWord.current = '';

      setState({
        handCount: hands.length,
        asl,
        sign,
        confidence: primary.confidence,
        lastSeen: now,
      });
    },
    [onWord],
  );

  const reset = useCallback(() => {
    reader.current?.reset();
    engine.current = new ASLGestureEngine();
    lastWord.current = '';
    setState(EMPTY);
  }, []);

  return useMemo(() => ({ ...state, onHands, reset }), [state, onHands, reset]);
}
