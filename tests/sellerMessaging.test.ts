import test from "node:test";
import assert from "node:assert/strict";
import {
  findRootMessageId,
  getConversationThread,
  getThreadReplyCount,
  type BaseMessageItem,
} from "../src/lib/messaging/threading.ts";

type Role = "SUPER_ADMIN" | "ADMIN" | "FUNDRAISING_MANAGER" | "SELLER" | "CUSTOMER";

type Seller = {
  id: string;
  seller_code: string;
  display_name: string;
  is_active: boolean;
};

type SellerMessage = {
  id: string;
  recipient_seller_id: string;
  sender_profile_id: string;
  subject: string;
  body: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
};

/**
 * Pure simulation of admin-to-seller message dispatch validation.
 */
function validateMessageDispatch(
  senderRole: Role,
  senderId: string,
  subject: string,
  body: string,
  recipientSellerIds: string[],
  availableSellers: Seller[]
): {
  allowed: boolean;
  error?: string;
  messagesToInsert?: Array<Omit<SellerMessage, "id" | "created_at" | "read_at" | "archived_at">>;
  auditMetadata?: Record<string, unknown>;
} {
  // 1. Staff role authorization
  const isStaff =
    senderRole === "SUPER_ADMIN" ||
    senderRole === "ADMIN" ||
    senderRole === "FUNDRAISING_MANAGER";

  if (!isStaff) {
    return {
      allowed: false,
      error: "Unauthorized: Only administrative staff may dispatch seller messages.",
    };
  }

  // 2. Subject validation
  const trimmedSub = subject.trim();
  if (trimmedSub.length < 2 || trimmedSub.length > 200) {
    return {
      allowed: false,
      error: "Subject must be between 2 and 200 characters.",
    };
  }

  // 3. Body validation
  const trimmedBody = body.trim();
  if (trimmedBody.length < 5 || trimmedBody.length > 5000) {
    return {
      allowed: false,
      error: "Message body must be between 5 and 5,000 characters.",
    };
  }

  // 4. Recipient selection check
  if (!recipientSellerIds || recipientSellerIds.length === 0) {
    return {
      allowed: false,
      error: "Please select at least one recipient seller.",
    };
  }

  const validActiveSellers = availableSellers.filter(
    (s) => recipientSellerIds.includes(s.id) && s.is_active
  );

  if (validActiveSellers.length === 0) {
    return {
      allowed: false,
      error: "No active recipient sellers found matching your selection.",
    };
  }

  // 5. Generate message records
  const messagesToInsert = validActiveSellers.map((seller) => ({
    recipient_seller_id: seller.id,
    sender_profile_id: senderId,
    subject: trimmedSub,
    body: trimmedBody,
  }));

  // 6. Audit metadata (never logging message body or PII)
  const auditMetadata = {
    recipient_count: validActiveSellers.length,
    recipient_seller_codes: validActiveSellers.map((s) => s.seller_code),
    subject: trimmedSub,
  };

  return { allowed: true, messagesToInsert, auditMetadata };
}

/**
 * Pure simulation of seller inbox access authorization guard.
 */
function evaluateSellerMessageAccess(
  authenticatedSellerId: string,
  message: SellerMessage
): { canRead: boolean; error?: string } {
  if (message.recipient_seller_id === authenticatedSellerId) {
    return { canRead: true };
  }
  return {
    canRead: false,
    error: "Access denied: You do not have permission to view messages addressed to other sellers.",
  };
}

/**
 * Pure simulation of message status update guard.
 */
function applySellerMessageUpdate(
  authenticatedSellerId: string,
  existingMessage: SellerMessage,
  updates: {
    read_at?: string | null;
    archived_at?: string | null;
    subject?: string;
    body?: string;
    recipient_seller_id?: string;
  }
): { success: boolean; updatedMessage?: SellerMessage; error?: string } {
  if (existingMessage.recipient_seller_id !== authenticatedSellerId) {
    return {
      success: false,
      error: "Unauthorized: Cannot update another seller's message.",
    };
  }

  // Enforce immutability of content and routing
  if (
    (updates.subject && updates.subject !== existingMessage.subject) ||
    (updates.body && updates.body !== existingMessage.body) ||
    (updates.recipient_seller_id &&
      updates.recipient_seller_id !== existingMessage.recipient_seller_id)
  ) {
    return {
      success: false,
      error: "Forbidden: Message subject, body, and recipient cannot be modified by sellers.",
    };
  }

  const updatedMessage: SellerMessage = {
    ...existingMessage,
    read_at: updates.read_at !== undefined ? updates.read_at : existingMessage.read_at,
    archived_at:
      updates.archived_at !== undefined ? updates.archived_at : existingMessage.archived_at,
  };

  return { success: true, updatedMessage };
}

/**
 * Pure simulation of unread count calculator.
 */
function computeUnreadCount(messages: SellerMessage[], sellerId: string): number {
  return messages.filter(
    (m) => m.recipient_seller_id === sellerId && !m.read_at && !m.archived_at
  ).length;
}

test("Admin can send an in-app message to a single active seller", () => {
  const sellers: Seller[] = [
    { id: "s-1", seller_code: "SELLER-001", display_name: "Ramesh Kumar", is_active: true },
    { id: "s-2", seller_code: "SELLER-002", display_name: "Priya Sharma", is_active: true },
  ];

  const res = validateMessageDispatch(
    "ADMIN",
    "admin-profile-1",
    "Lucky Draw Opening Update",
    "Please review your assigned referral links and prepare buyer receipts.",
    ["s-1"],
    sellers
  );

  assert.equal(res.allowed, true);
  assert.equal(res.messagesToInsert?.length, 1);
  assert.equal(res.messagesToInsert?.[0].recipient_seller_id, "s-1");
  assert.equal(res.messagesToInsert?.[0].subject, "Lucky Draw Opening Update");
  assert.equal(res.auditMetadata?.recipient_count, 1);
});

test("Admin can send an in-app message to explicitly selected multiple sellers", () => {
  const sellers: Seller[] = [
    { id: "s-1", seller_code: "SELLER-001", display_name: "Ramesh Kumar", is_active: true },
    { id: "s-2", seller_code: "SELLER-002", display_name: "Priya Sharma", is_active: true },
    { id: "s-3", seller_code: "SELLER-003", display_name: "Anil Das", is_active: false },
  ];

  const res = validateMessageDispatch(
    "SUPER_ADMIN",
    "superadmin-profile-1",
    "Urgent Verification Requirement",
    "Ensure all buyer payment references include the 12-digit UPI UTR number.",
    ["s-1", "s-2", "s-3"],
    sellers
  );

  assert.equal(res.allowed, true);
  // s-3 is inactive, so message is delivered strictly to the 2 active sellers
  assert.equal(res.messagesToInsert?.length, 2);
  assert.deepEqual(res.auditMetadata?.recipient_seller_codes, ["SELLER-001", "SELLER-002"]);
});

test("Unauthorized users (sellers, customers) cannot send messages", () => {
  const sellers: Seller[] = [
    { id: "s-1", seller_code: "SELLER-001", display_name: "Ramesh Kumar", is_active: true },
  ];

  const sellerAttempt = validateMessageDispatch(
    "SELLER",
    "seller-profile-1",
    "Test Subject",
    "Test message body content.",
    ["s-1"],
    sellers
  );
  assert.equal(sellerAttempt.allowed, false);
  assert.ok(sellerAttempt.error?.includes("Unauthorized"));

  const customerAttempt = validateMessageDispatch(
    "CUSTOMER",
    "cust-profile-1",
    "Test Subject",
    "Test message body content.",
    ["s-1"],
    sellers
  );
  assert.equal(customerAttempt.allowed, false);
});

test("Seller isolation: A seller cannot read another seller's private messages", () => {
  const message: SellerMessage = {
    id: "msg-101",
    recipient_seller_id: "s-1",
    sender_profile_id: "admin-1",
    subject: "Private Warning",
    body: "Confidential sales review.",
    created_at: new Date().toISOString(),
    read_at: null,
    archived_at: null,
  };

  // Authenticated seller s-1 accesses own message -> ALLOWED
  const ownAccess = evaluateSellerMessageAccess("s-1", message);
  assert.equal(ownAccess.canRead, true);

  // Authenticated seller s-2 attempts to access s-1's message -> BLOCKED
  const crossAccess = evaluateSellerMessageAccess("s-2", message);
  assert.equal(crossAccess.canRead, false);
  assert.ok(crossAccess.error?.includes("Access denied"));
});

test("Seller immutability: A seller cannot modify message subject, body, or recipient", () => {
  const message: SellerMessage = {
    id: "msg-101",
    recipient_seller_id: "s-1",
    sender_profile_id: "admin-1",
    subject: "Official Notice",
    body: "Original text.",
    created_at: new Date().toISOString(),
    read_at: null,
    archived_at: null,
  };

  // Attempting to tamper with subject or body is blocked
  const tamperAttempt = applySellerMessageUpdate("s-1", message, {
    subject: "Forged Notice",
    body: "Tampered content.",
  });
  assert.equal(tamperAttempt.success, false);
  assert.ok(tamperAttempt.error?.includes("Forbidden"));

  // Attempting to route message to a different recipient is blocked
  const rerouteAttempt = applySellerMessageUpdate("s-1", message, {
    recipient_seller_id: "s-2",
  });
  assert.equal(rerouteAttempt.success, false);
});

test("Read status update succeeds only for the authenticated recipient", () => {
  const message: SellerMessage = {
    id: "msg-101",
    recipient_seller_id: "s-1",
    sender_profile_id: "admin-1",
    subject: "Official Notice",
    body: "Original text.",
    created_at: new Date().toISOString(),
    read_at: null,
    archived_at: null,
  };

  const readTimestamp = new Date().toISOString();
  const updateRes = applySellerMessageUpdate("s-1", message, {
    read_at: readTimestamp,
  });

  assert.equal(updateRes.success, true);
  assert.equal(updateRes.updatedMessage?.read_at, readTimestamp);

  // Different seller cannot mark as read
  const unauthorizedUpdate = applySellerMessageUpdate("s-2", message, {
    read_at: readTimestamp,
  });
  assert.equal(unauthorizedUpdate.success, false);
});

test("Unread counts are calculated accurately across active and archived messages", () => {
  const messages: SellerMessage[] = [
    {
      id: "m-1",
      recipient_seller_id: "s-1",
      sender_profile_id: "admin-1",
      subject: "Unread 1",
      body: "Text 1",
      created_at: "2026-10-29T00:00:00Z",
      read_at: null,
      archived_at: null,
    },
    {
      id: "m-2",
      recipient_seller_id: "s-1",
      sender_profile_id: "admin-1",
      subject: "Unread 2",
      body: "Text 2",
      created_at: "2026-10-29T01:00:00Z",
      read_at: null,
      archived_at: null,
    },
    {
      id: "m-3",
      recipient_seller_id: "s-1",
      sender_profile_id: "admin-1",
      subject: "Read Message",
      body: "Text 3",
      created_at: "2026-10-29T02:00:00Z",
      read_at: "2026-10-29T02:30:00Z",
      archived_at: null,
    },
    {
      id: "m-4",
      recipient_seller_id: "s-1",
      sender_profile_id: "admin-1",
      subject: "Archived Unread",
      body: "Text 4",
      created_at: "2026-10-29T03:00:00Z",
      read_at: null,
      archived_at: "2026-10-29T03:30:00Z",
    },
    {
      id: "m-5",
      recipient_seller_id: "s-2", // Different seller
      sender_profile_id: "admin-1",
      subject: "Other Seller Unread",
      body: "Text 5",
      created_at: "2026-10-29T04:00:00Z",
      read_at: null,
      archived_at: null,
    },
  ];

  // For seller s-1: m-1 and m-2 are active unread. (m-3 is read, m-4 is archived) -> count is 2
  assert.equal(computeUnreadCount(messages, "s-1"), 2);

  // For seller s-2: m-5 is active unread -> count is 1
  assert.equal(computeUnreadCount(messages, "s-2"), 1);

  // For seller s-3: no messages -> count is 0
  assert.equal(computeUnreadCount(messages, "s-3"), 0);
});

test("Audit logs record message dispatch without leaking message bodies or sensitive credentials", () => {
  const sellers: Seller[] = [
    { id: "s-1", seller_code: "SELLER-001", display_name: "Ramesh Kumar", is_active: true },
  ];

  const res = validateMessageDispatch(
    "ADMIN",
    "admin-profile-1",
    "Confidential Security Advisory",
    "Do not reveal your secret credentials: sk_live_123456789.",
    ["s-1"],
    sellers
  );

  assert.equal(res.allowed, true);
  const auditString = JSON.stringify(res.auditMetadata);

  // Audit metadata must NOT contain secret keys, credentials, or the raw message body
  assert.ok(!auditString.includes("sk_live"));
  assert.ok(!auditString.includes("secret credentials"));
  assert.equal(res.auditMetadata?.subject, "Confidential Security Advisory");
  assert.equal(res.auditMetadata?.recipient_count, 1);
});

test("Thread Resolution: findRootMessageId correctly traverses single and chained reply hierarchies", () => {
  const messages: BaseMessageItem[] = [
    {
      id: "root-1",
      subject: "Ticket Allotment",
      body: "Initial staff notice",
      created_at: "2026-10-30T00:00:00Z",
      read_at: null,
      archived_at: null,
      sender_role: "ADMIN",
      parent_message_id: null,
    },
    {
      id: "reply-1",
      subject: "Re: Ticket Allotment",
      body: "Seller question",
      created_at: "2026-10-30T00:05:00Z",
      read_at: null,
      archived_at: null,
      sender_role: "SELLER",
      parent_message_id: "root-1",
    },
    {
      id: "reply-2",
      subject: "Re: Ticket Allotment",
      body: "Staff answer",
      created_at: "2026-10-30T00:10:00Z",
      read_at: null,
      archived_at: null,
      sender_role: "ADMIN",
      parent_message_id: "reply-1", // Chained to reply-1
    },
  ];

  // Root message resolves to itself
  assert.equal(findRootMessageId(messages[0], messages), "root-1");
  // Direct reply resolves to root
  assert.equal(findRootMessageId(messages[1], messages), "root-1");
  // Chained reply resolves to root
  assert.equal(findRootMessageId(messages[2], messages), "root-1");
});

test("Thread Resolution: getConversationThread groups and orders full conversation chronologically", () => {
  const messages: BaseMessageItem[] = [
    {
      id: "reply-2",
      subject: "Re: Verification",
      body: "Staff follow-up: Approved!",
      created_at: "2026-10-30T00:15:00Z",
      read_at: null,
      archived_at: null,
      sender_role: "ADMIN",
      parent_message_id: "root-10",
    },
    {
      id: "root-10",
      subject: "Verification",
      body: "Please upload your counterfoil",
      created_at: "2026-10-30T00:00:00Z",
      read_at: null,
      archived_at: null,
      sender_role: "ADMIN",
      parent_message_id: null,
    },
    {
      id: "reply-1",
      subject: "Re: Verification",
      body: "Seller: Uploaded receipt #12345",
      created_at: "2026-10-30T00:10:00Z",
      read_at: null,
      archived_at: null,
      sender_role: "SELLER",
      parent_message_id: "root-10",
    },
    {
      id: "other-root",
      subject: "Unrelated topic",
      body: "Different seller or conversation",
      created_at: "2026-10-30T00:05:00Z",
      read_at: null,
      archived_at: null,
      sender_role: "ADMIN",
      parent_message_id: null,
    },
  ];

  // Request thread from reply-1
  const thread = getConversationThread(messages[2], messages);

  // Must isolate root-10 thread and ignore other-root
  assert.equal(thread.length, 3);
  assert.equal(thread[0].id, "root-10"); // Oldest first
  assert.equal(thread[1].id, "reply-1"); // Middle
  assert.equal(thread[2].id, "reply-2"); // Latest

  // Reply count check
  assert.equal(getThreadReplyCount(messages[0], messages), 2);
  assert.equal(getThreadReplyCount(messages[3], messages), 0);
});

test("Thread Resolution: Handles cycle safety and missing parents gracefully", () => {
  const cyclicMessage: BaseMessageItem = {
    id: "cycle-1",
    subject: "Self-referential",
    body: "Corrupted parent pointing to self",
    created_at: "2026-10-30T00:00:00Z",
    read_at: null,
    archived_at: null,
    parent_message_id: "cycle-1",
  };

  // Must not infinite loop
  const rootId = findRootMessageId(cyclicMessage, [cyclicMessage]);
  assert.equal(rootId, "cycle-1");

  const orphanMessage: BaseMessageItem = {
    id: "orphan-1",
    subject: "Orphaned reply",
    body: "Parent deleted or pruned",
    created_at: "2026-10-30T00:00:00Z",
    read_at: null,
    archived_at: null,
    parent_message_id: "non-existent-uuid",
  };

  const orphanRoot = findRootMessageId(orphanMessage, [orphanMessage]);
  assert.equal(orphanRoot, "non-existent-uuid");
});

test("Seller Inbox Unread Count: Excludes unread messages sent by seller themselves", () => {
  const sellerId = "seller-uuid-1";
  const messages = [
    {
      id: "m-staff-1",
      recipient_seller_id: sellerId,
      sender_role: "ADMIN",
      read_at: null,
      archived_at: null,
    },
    {
      id: "m-staff-2",
      recipient_seller_id: sellerId,
      sender_role: "ADMIN",
      read_at: "2026-10-30T00:01:00Z",
      archived_at: null,
    },
    {
      id: "m-seller-inquiry",
      recipient_seller_id: sellerId,
      sender_role: "SELLER", // Sent by seller to admin
      read_at: null, // Admin has not read it yet
      archived_at: null,
    },
  ];

  // For seller inbox: only m-staff-1 should count as unread for the seller
  const sellerUnread = messages.filter(
    (m) => m.recipient_seller_id === sellerId && !m.read_at && !m.archived_at && m.sender_role !== "SELLER"
  ).length;

  assert.equal(sellerUnread, 1);

  // For admin inbox: m-seller-inquiry should count as unread inquiry for admin
  const adminUnread = messages.filter(
    (m) => m.sender_role === "SELLER" && !m.read_at
  ).length;

  assert.equal(adminUnread, 1);
});

