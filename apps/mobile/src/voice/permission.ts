import type { AssistantReply } from '../assistant';

/**
 * Full permission: the user said, once, at setup, "do what I ask without
 * checking with me each time". It covers calling and messaging a contact.
 * It never covers money: a payment always waits for a spoken yes.
 */
const ACTS_AT_ONCE = new Set(['message', 'call']);

export function actsWithoutAsking(
  reply: Pick<AssistantReply, 'intent' | 'confirm' | 'inferred'>,
  fullPermission: boolean | undefined,
): boolean {
  // A command the language model worked out from loose wording is read back first:
  // full permission covers what the user said, not what was guessed.
  if (reply.inferred) return false;
  return Boolean(fullPermission) && Boolean(reply.confirm) && ACTS_AT_ONCE.has(reply.intent);
}

const ASKS_A_QUESTION = new Set(['contact_waiting', 'contact_edit_waiting', 'clarify', 'place_set']);

/** The assistant asked for a detail, so the next thing said is the answer and needs no wake word. */
export function expectsAnswer(reply: Pick<AssistantReply, 'intent'> | null | undefined): boolean {
  return Boolean(reply) && ASKS_A_QUESTION.has(reply!.intent);
}
