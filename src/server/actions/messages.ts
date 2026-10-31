"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAnyRole, requireRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const sendMessageSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(2, "Subject must be at least 2 characters.")
    .max(200, "Subject cannot exceed 200 characters."),
  body: z
    .string()
    .trim()
    .min(5, "Message body must be at least 5 characters.")
    .max(5000, "Message body cannot exceed 5,000 characters."),
  sellerIds: z
    .array(z.string().uuid("Invalid seller ID format."))
    .min(1, "Please select at least one recipient seller."),
});

const messageActionSchema = z.object({
  messageId: z.string().uuid("Invalid message ID."),
});

/**
 * Sends a private message to one or more explicitly selected sellers.
 * Enforces administrative staff authorization (SUPER_ADMIN, ADMIN, FUNDRAISING_MANAGER).
 */
export async function sendAdminSellerMessage(formData: FormData) {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);

  const rawSubject = formData.get("subject");
  const rawBody = formData.get("body");
  const rawSellerIds = formData.getAll("sellerIds");

  // Fallback for single sellerId field or JSON array
  let sellerIdsList: string[] = [];
  if (rawSellerIds.length > 0) {
    sellerIdsList = rawSellerIds.map((v) => String(v).trim()).filter(Boolean);
  } else {
    const single = formData.get("sellerId");
    if (single) {
      try {
        const parsedJson = JSON.parse(String(single));
        if (Array.isArray(parsedJson)) {
          sellerIdsList = parsedJson;
        } else {
          sellerIdsList = [String(single)];
        }
      } catch {
        sellerIdsList = [String(single)];
      }
    }
  }

  const parsed = sendMessageSchema.safeParse({
    subject: rawSubject,
    body: rawBody,
    sellerIds: sellerIdsList,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Please check the message inputs.");
  }

  const admin = createSupabaseAdminClient();

  // 1. Verify recipient sellers exist and are active
  const { data: sellers, error: sellerErr } = await admin
    .from("sellers")
    .select("id, seller_code, display_name, is_active")
    .in("id", parsed.data.sellerIds);

  if (sellerErr) {
    console.error("[Messaging Diagnostic] Failed to lookup sellers:", {
      code: sellerErr.code,
      message: sellerErr.message,
    });
    throw new Error("Unable to verify recipient sellers at this time.");
  }

  if (!sellers || sellers.length === 0) {
    throw new Error("None of the specified recipient sellers could be found.");
  }

  const activeSellers = sellers.filter((s) => s.is_active);
  if (activeSellers.length === 0) {
    throw new Error("All selected recipient sellers are currently inactive.");
  }

  // 2. Insert message rows for each verified recipient seller
  const recordsToInsert = activeSellers.map((seller) => ({
    recipient_seller_id: seller.id,
    sender_profile_id: user.id,
    sender_role: "ADMIN",
    parent_message_id: null,
    subject: parsed.data.subject,
    body: parsed.data.body,
  }));

  const { data: inserted, error: insertErr } = await admin
    .from("seller_messages")
    .insert(recordsToInsert)
    .select("id");

  if (insertErr) {
    console.error("[Messaging Diagnostic] Message insert failed:", {
      code: insertErr.code,
      message: insertErr.message,
    });
    throw new Error("Failed to deliver message. Please try again.");
  }

  // 3. Write structured audit log without logging sensitive message body
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "SELLER_MESSAGE_SENT",
      entity_type: "seller_message",
      metadata: {
        recipient_count: activeSellers.length,
        recipient_seller_codes: activeSellers.map((s) => s.seller_code),
        subject: parsed.data.subject,
        message_count: inserted?.length ?? activeSellers.length,
      },
    });
  } catch (auditErr) {
    console.warn("[Messaging Diagnostic] Non-fatal audit log insertion failure:", auditErr);
  }

  revalidatePath("/admin/messages");
  revalidatePath("/seller/messages");
  revalidatePath("/seller");

  return {
    success: true,
    count: activeSellers.length,
    message: `Message successfully sent to ${activeSellers.length} seller${
      activeSellers.length > 1 ? "s" : ""
    }.`,
  };
}

/**
 * Marks a received private message as read by the authenticated seller.
 * Strictly verifies seller ownership and ensures only staff-sent messages are marked read by seller.
 */
export async function markSellerMessageAsRead(formData: FormData) {
  const user = await requireRole("SELLER");

  const parsed = messageActionSchema.safeParse({
    messageId: formData.get("messageId"),
  });

  if (!parsed.success) {
    throw new Error("Invalid message identifier.");
  }

  const admin = createSupabaseAdminClient();

  // Look up authenticated seller profile
  const { data: seller, error: sellerErr } = await admin
    .from("sellers")
    .select("id, is_active")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (sellerErr || !seller) {
    throw new Error("Your seller account is unavailable.");
  }

  if (!seller.is_active) {
    throw new Error("Your seller account is currently inactive.");
  }

  // Atomically update read_at only if message belongs to this seller and was sent by staff
  const { error: updateErr } = await admin
    .from("seller_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data.messageId)
    .eq("recipient_seller_id", seller.id)
    .neq("sender_role", "SELLER")
    .is("read_at", null);

  if (updateErr) {
    console.error("[Messaging Diagnostic] Failed to mark message read:", {
      code: updateErr.code,
      message: updateErr.message,
    });
    throw new Error("Unable to update message status.");
  }

  revalidatePath("/seller/messages");
  revalidatePath("/seller");

  return { success: true };
}

/**
 * Marks an incoming seller inquiry as read by administrative staff.
 * Authorized for SUPER_ADMIN, ADMIN, FUNDRAISING_MANAGER.
 */
export async function markAdminMessageAsRead(formData: FormData) {
  await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);

  const parsed = messageActionSchema.safeParse({
    messageId: formData.get("messageId"),
  });

  if (!parsed.success) {
    throw new Error("Invalid message identifier.");
  }

  const admin = createSupabaseAdminClient();

  // Atomically update read_at for incoming seller inquiry
  const { error: updateErr } = await admin
    .from("seller_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data.messageId)
    .eq("sender_role", "SELLER")
    .is("read_at", null);

  if (updateErr) {
    console.error("[Messaging Diagnostic] Failed to mark inquiry read by admin:", {
      code: updateErr.code,
      message: updateErr.message,
    });
    throw new Error("Unable to update inquiry status.");
  }

  revalidatePath("/admin/messages");

  return { success: true };
}

const sellerToAdminSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(2, "Subject must be at least 2 characters.")
    .max(200, "Subject cannot exceed 200 characters."),
  body: z
    .string()
    .trim()
    .min(5, "Message body must be at least 5 characters.")
    .max(5000, "Message body cannot exceed 5,000 characters."),
  parentMessageId: z.string().uuid("Invalid parent message format.").optional().nullable(),
});

/**
 * Sends a message or inquiry from an authenticated active seller to the SSFI Admin team.
 */
export async function sendSellerToAdminMessage(formData: FormData) {
  const user = await requireRole("SELLER");

  const rawParent = formData.get("parentMessageId");
  const sanitizedParent =
    typeof rawParent === "string" &&
    rawParent.trim() &&
    rawParent !== "null" &&
    rawParent !== "undefined"
      ? rawParent.trim()
      : null;

  const parsed = sellerToAdminSchema.safeParse({
    subject: formData.get("subject"),
    body: formData.get("body"),
    parentMessageId: sanitizedParent,
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please check your message inputs.",
    };
  }

  const admin = createSupabaseAdminClient();

  // Look up authenticated seller profile
  const { data: seller, error: sellerErr } = await admin
    .from("sellers")
    .select("id, is_active, seller_code, display_name")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (sellerErr || !seller) {
    return { success: false, error: "Your seller account is unavailable." };
  }

  if (!seller.is_active) {
    return { success: false, error: "Your seller account is currently inactive." };
  }

  // Insert message row
  const { data: inserted, error: insertErr } = await admin
    .from("seller_messages")
    .insert({
      recipient_seller_id: seller.id,
      sender_profile_id: user.id,
      sender_role: "SELLER",
      parent_message_id: parsed.data.parentMessageId || null,
      subject: parsed.data.subject,
      body: parsed.data.body,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.error("[Messaging Diagnostic] Seller message to Admin failed:", {
      code: insertErr?.code,
      message: insertErr?.message,
    });
    return { success: false, error: "Failed to send message. Please try again." };
  }

  // Record audit log
  try {
    await admin.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "SELLER_MESSAGE_SENT",
      entity_type: "seller_message",
      entity_id: inserted.id,
      metadata: {
        seller_code: seller.seller_code,
        subject: parsed.data.subject,
        is_reply: Boolean(parsed.data.parentMessageId),
      },
    });
  } catch (auditErr) {
    console.warn("[Messaging Diagnostic] Audit log insertion failed:", auditErr);
  }

  revalidatePath("/seller/messages");
  revalidatePath("/seller");
  revalidatePath("/admin/messages");

  return {
    success: true,
    message: "Your message has been delivered to the SSFI Admin team.",
    messageId: inserted.id,
  };
}

/**
 * Administrative staff replies to an existing seller conversation or inquiry.
 */
export async function replyAdminToSellerMessage(formData: FormData) {
  const user = await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);

  const replySchema = z.object({
    recipientSellerId: z.string().uuid("Invalid seller ID format."),
    parentMessageId: z.string().uuid("Invalid parent message ID."),
    subject: z.string().trim().min(2, "Subject must be at least 2 characters.").max(200),
    body: z.string().trim().min(5, "Reply body must be at least 5 characters.").max(5000),
  });

  const parsed = replySchema.safeParse({
    recipientSellerId: formData.get("recipientSellerId"),
    parentMessageId: formData.get("parentMessageId"),
    subject: formData.get("subject"),
    body: formData.get("body"),
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Please check the reply inputs.",
    };
  }

  const admin = createSupabaseAdminClient();

  // Verify recipient seller exists and is active
  const { data: recipientSeller, error: sellerCheckErr } = await admin
    .from("sellers")
    .select("id, is_active, seller_code")
    .eq("id", parsed.data.recipientSellerId)
    .maybeSingle();

  if (sellerCheckErr || !recipientSeller) {
    return { success: false, error: "Recipient seller could not be verified." };
  }

  if (!recipientSeller.is_active) {
    return { success: false, error: "Cannot reply: recipient seller is currently inactive." };
  }

  const { data: inserted, error: insertErr } = await admin
    .from("seller_messages")
    .insert({
      recipient_seller_id: parsed.data.recipientSellerId,
      sender_profile_id: user.id,
      sender_role: "ADMIN",
      parent_message_id: parsed.data.parentMessageId,
      subject: parsed.data.subject,
      body: parsed.data.body,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.error("[Messaging Diagnostic] Admin reply insert failed:", {
      code: insertErr?.code,
      message: insertErr?.message,
    });
    return { success: false, error: "Failed to send reply. Please try again." };
  }

  try {
    await admin.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "STAFF_MESSAGE_REPLIED",
      entity_type: "seller_message",
      entity_id: inserted.id,
      metadata: {
        parent_message_id: parsed.data.parentMessageId,
        recipient_seller_id: parsed.data.recipientSellerId,
        recipient_seller_code: recipientSeller.seller_code,
      },
    });
  } catch (auditErr) {
    console.warn("[Messaging Diagnostic] Non-fatal audit log insertion failure:", auditErr);
  }

  revalidatePath("/admin/messages");
  revalidatePath("/seller/messages");
  revalidatePath("/seller");

  return {
    success: true,
    message: "Reply sent successfully.",
    messageId: inserted.id,
  };
}

/**
 * Archives a message in the seller's inbox.
 */
export async function archiveSellerMessage(formData: FormData) {
  const user = await requireRole("SELLER");

  const parsed = messageActionSchema.safeParse({
    messageId: formData.get("messageId"),
  });

  if (!parsed.success) {
    throw new Error("Invalid message identifier.");
  }

  const admin = createSupabaseAdminClient();

  const { data: seller } = await admin
    .from("sellers")
    .select("id, is_active")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!seller || !seller.is_active) {
    throw new Error("Your seller account is unavailable.");
  }

  const { error: updateErr } = await admin
    .from("seller_messages")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsed.data.messageId)
    .eq("recipient_seller_id", seller.id);

  if (updateErr) {
    throw new Error("Unable to archive message.");
  }

  revalidatePath("/seller/messages");
  revalidatePath("/seller");

  return { success: true };
}
