export type BaseMessageItem = {
  id: string;
  subject: string;
  body: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
  sender_role?: "ADMIN" | "SELLER";
  parent_message_id?: string | null;
  recipient_seller_id?: string | null;
  recipient_seller_code?: string | null;
  recipient_display_name?: string | null;
  sellers?: { seller_code: string; display_name: string } | null;
  profiles?: { full_name: string; email: string } | null;
};

/**
 * Given any message and the available pool of messages, resolves the root message ID of the thread.
 * Traverses up `parent_message_id` pointers in a cycle-safe manner.
 */
export function findRootMessageId<T extends BaseMessageItem>(
  target: T,
  allMessages: readonly T[]
): string {
  let rootId = target.id;
  let current: T | undefined = target;
  const visited = new Set<string>([target.id]);

  while (current?.parent_message_id && !visited.has(current.parent_message_id)) {
    visited.add(current.parent_message_id);
    const parent = allMessages.find((m) => m.id === current?.parent_message_id);
    if (parent) {
      rootId = parent.id;
      current = parent;
    } else {
      rootId = current.parent_message_id;
      break;
    }
  }

  return rootId;
}

/**
 * Returns all messages belonging to the conversation thread containing `target`,
 * ordered chronologically from oldest (initiating message) to newest.
 */
export function getConversationThread<T extends BaseMessageItem>(
  target: T,
  allMessages: readonly T[]
): T[] {
  const rootId = findRootMessageId(target, allMessages);
  const threadIds = new Set<string>([rootId]);

  let added = true;
  while (added) {
    added = false;
    for (const msg of allMessages) {
      if (
        !threadIds.has(msg.id) &&
        msg.parent_message_id &&
        threadIds.has(msg.parent_message_id)
      ) {
        threadIds.add(msg.id);
        added = true;
      }
    }
  }

  return allMessages
    .filter((m) => threadIds.has(m.id))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

/**
 * Counts the number of replies in the conversation containing `target`.
 */
export function getThreadReplyCount<T extends BaseMessageItem>(
  target: T,
  allMessages: readonly T[]
): number {
  const thread = getConversationThread(target, allMessages);
  return Math.max(0, thread.length - 1);
}

