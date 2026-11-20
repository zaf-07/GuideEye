import type { AssistantReply } from '../assistant';

/**
 * Full permission: the user said, once, at setup, "do what I ask without
 * checking with me each time". It covers calling and messaging a contact.
 * It never covers money: a payment always waits for a spoken yes.
 */
const ACTS_AT_ONCE = new Set(['message', 'call']);

export function actsWithoutAsking(reply: Pick<AssistantReply, 'intent' | 'confirm'>, fullPermission: boolean | undefined): boolean {
  return Boolean(fullPermission) && Boolean(reply.confirm) && ACTS_AT_ONCE.has(reply.intent);
}
