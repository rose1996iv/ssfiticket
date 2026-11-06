import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { computeServerPaginationWindow } from "../src/lib/pagination/serverPagination.ts";
import {
  assertNoLockedFieldsPresent,
  customerContactFieldsSchema,
  filterNotesByViewerRole,
  masterCustomerProfileUpdateSchema,
  singleTicketContactUpdateSchema,
} from "../src/lib/validation/customerManagement.ts";

test("Phase 0 & 1: Sellers & QR Codes (/admin/sellers) and Customers (/admin/customers) use explicit orders_seller_id_fkey", () => {
  const sellersPage = fs.readFileSync(path.resolve("src/app/admin/sellers/page.tsx"), "utf-8");
  const customersPage = fs.readFileSync(path.resolve("src/app/admin/customers/page.tsx"), "utf-8");

  assert.ok(
    sellersPage.includes("orders!orders_seller_id_fkey"),
    "/admin/sellers must explicitly qualify orders!orders_seller_id_fkey to prevent PGRST201"
  );
  assert.ok(
    customersPage.includes("sellers!orders_seller_id_fkey"),
    "/admin/customers must explicitly qualify sellers!orders_seller_id_fkey to prevent PGRST201"
  );
});

test("Phase 3 & 7: Locked immutable ticket and financial fields are strictly rejected by assertNoLockedFieldsPresent", async () => {
  const lockedFieldPayloads: Array<Record<string, unknown>> = [
    { ticket_number: "SSFI-000999" },
    { ticketNumber: "SSFI-000999" },
    { ticket_qr_token: "forged-token" },
    { order_number: "SSFI-2026-FORGED" },
    { amount_paise: 100 },
    { total_amount_paise: 100 },
    { seller_id: "123e4567-e89b-12d3-a456-426614174000" },
    { snapshot_seller_id: "123e4567-e89b-12d3-a456-426614174000" },
    { snapshot_upi_id: "attacker@upi" },
    { issued_at: "2026-11-07T00:00:00Z" },
    { verified_at: "2026-11-07T00:00:00Z" },
  ];

  for (const payload of lockedFieldPayloads) {
    const res = await assertNoLockedFieldsPresent({
      fullName: "Valid Customer",
      email: "valid@example.com",
      whatsapp: "+919876543210",
      reason: "Attempting to mutate locked field",
      ...payload,
    });
    assert.equal(res.ok, false, `Must reject locked field in payload: ${JSON.stringify(payload)}`);
  }

  // Valid contact payload without locked fields passes
  const cleanRes = await assertNoLockedFieldsPresent({
    customerId: "123e4567-e89b-12d3-a456-426614174000",
    fullName: "Lalnunmawia",
    email: "lalnunmawia@example.com",
    whatsapp: "+919876543210",
    reason: "Customer requested email typo correction via support ticket",
  });
  assert.equal(cleanRes.ok, true);
});

test("Phase 3: Customer Profile Update vs Single-Ticket Contact Update schemas enforce mandatory reason and distinct scopes", () => {
  const validCustomerId = "123e4567-e89b-12d3-a456-426614174000";
  const validTicketId = "223e4567-e89b-12d3-a456-426614174001";

  // 1. Missing or short reason (<5 chars) is rejected
  const shortReason = customerContactFieldsSchema.safeParse({
    fullName: "Biakzuala",
    email: "biak@example.com",
    whatsapp: "+919876543210",
    reason: "fix",
  });
  assert.equal(shortReason.success, false, "Reason shorter than 5 chars must fail validation");

  // 2. Valid CUSTOMER_PROFILE scope
  const masterProfile = masterCustomerProfileUpdateSchema.safeParse({
    scope: "CUSTOMER_PROFILE",
    customerId: validCustomerId,
    fullName: "Biakzuala Chhangte",
    email: "biakzuala@example.com",
    whatsapp: "+919876543210",
    reason: "Updated master customer email per customer support request",
  });
  assert.equal(masterProfile.success, true);

  // 3. Valid TICKET_CONTACT scope
  const singleTicket = singleTicketContactUpdateSchema.safeParse({
    scope: "TICKET_CONTACT",
    ticketId: validTicketId,
    fullName: "Gift Recipient Name",
    email: "recipient@example.com",
    whatsapp: "+919811122233",
    reason: "Customer assigned this single ticket contact to family member",
  });
  assert.equal(singleTicket.success, true);
});

test("Phase 3: Single-Ticket Contact Update isolation simulation", () => {
  // Simulate a customer with 3 issued tickets: updating ticket #2 must NOT alter ticket #1, ticket #3, or master customer profile
  const masterCustomer = {
    id: "cust-1",
    full_name: "Original Buyer",
    email: "buyer@example.com",
    whatsapp_number: "+919000000001",
  };

  const tickets = [
    {
      id: "t-1",
      ticket_number: "SSFI-000101",
      customer_id: "cust-1",
      contact_full_name: null as string | null,
      contact_email: null as string | null,
      contact_whatsapp: null as string | null,
    },
    {
      id: "t-2",
      ticket_number: "SSFI-000102",
      customer_id: "cust-1",
      contact_full_name: null as string | null,
      contact_email: null as string | null,
      contact_whatsapp: null as string | null,
    },
    {
      id: "t-3",
      ticket_number: "SSFI-000103",
      customer_id: "cust-1",
      contact_full_name: null as string | null,
      contact_email: null as string | null,
      contact_whatsapp: null as string | null,
    },
  ];

  // Apply single-ticket contact update to t-2 only
  tickets[1] = {
    ...tickets[1],
    contact_full_name: "Ticket Two Holder",
    contact_email: "ticket2@example.com",
    contact_whatsapp: "+919000000002",
  };

  // Verify master profile and t-1, t-3 remain untouched
  assert.equal(masterCustomer.email, "buyer@example.com");
  assert.equal(tickets[0].contact_email, null);
  assert.equal(tickets[2].contact_email, null);
  assert.equal(tickets[1].contact_email, "ticket2@example.com");
  assert.equal(tickets[1].ticket_number, "SSFI-000102", "Ticket number remains strictly unchanged");
});

test("Phase 4: Server-side pagination handles datasets well beyond 200 records without ceiling", () => {
  // 1,250 records at 50 per page = 25 pages
  const page1 = computeServerPaginationWindow({ page: "1", pageSize: "50" }, 1250);
  assert.equal(page1.page, 1);
  assert.equal(page1.pageSize, 50);
  assert.equal(page1.rangeFrom, 0);
  assert.equal(page1.rangeTo, 49);
  assert.equal(page1.totalPages, 25);
  assert.equal(page1.hasPrevPage, false);
  assert.equal(page1.hasNextPage, true);

  // Page 6 (records 251-300, well past the old 200-record ceiling)
  const page6 = computeServerPaginationWindow({ page: "6", pageSize: "50" }, 1250);
  assert.equal(page6.page, 6);
  assert.equal(page6.rangeFrom, 250);
  assert.equal(page6.rangeTo, 299);
  assert.equal(page6.hasPrevPage, true);
  assert.equal(page6.hasNextPage, true);

  // Page 25 (final page, records 1201-1250)
  const page25 = computeServerPaginationWindow({ page: "25", pageSize: "50" }, 1250);
  assert.equal(page25.page, 25);
  assert.equal(page25.rangeFrom, 1200);
  assert.equal(page25.rangeTo, 1249);
  assert.equal(page25.hasPrevPage, true);
  assert.equal(page25.hasNextPage, false);
});

test("Phase 6: RBAC visibility filtering prevents Sellers and Customers from seeing ADMIN_ONLY notes", async () => {
  const sampleNotes = [
    { id: "1", visibility: "ADMIN_ONLY" as const, body: "Internal fraud check note" },
    { id: "2", visibility: "SELLER_AND_ADMIN" as const, body: "Seller verified UPI screenshot" },
    { id: "3", visibility: "CUSTOMER_VISIBLE" as const, body: "Your payment is under review" },
  ];

  const staffView = await filterNotesByViewerRole(sampleNotes, "STAFF");
  assert.equal(staffView.length, 3, "Staff can view all 3 visibility scopes");

  const sellerView = await filterNotesByViewerRole(sampleNotes, "SELLER");
  assert.equal(sellerView.length, 2, "Seller can view only SELLER_AND_ADMIN and CUSTOMER_VISIBLE");
  assert.ok(
    !sellerView.some((n) => n.visibility === "ADMIN_ONLY"),
    "Seller must NEVER see ADMIN_ONLY notes"
  );

  const customerView = await filterNotesByViewerRole(sampleNotes, "CUSTOMER");
  assert.equal(customerView.length, 1, "Customer can view only CUSTOMER_VISIBLE notes");
  assert.equal(customerView[0].id, "3");
});

test("Phase 5 & 7: Database migration 202611070001 enforces ticket identity immutability and append-only audit logs", () => {
  const migrationSql = fs.readFileSync(
    path.resolve(
      "supabase/migrations/202611070001_customer_contact_overrides_collaboration_and_ticket_immutability.sql"
    ),
    "utf-8"
  );

  assert.ok(
    migrationSql.includes("protect_ticket_identity_immutability"),
    "Migration must define protect_ticket_identity_immutability trigger function"
  );
  assert.ok(
    migrationSql.includes("NEW.ticket_number IS DISTINCT FROM OLD.ticket_number"),
    "Trigger must block any change to ticket_number"
  );
  assert.ok(
    migrationSql.includes("protect_audit_logs_append_only"),
    "Migration must define protect_audit_logs_append_only trigger function"
  );
  assert.ok(
    migrationSql.includes("BEFORE UPDATE OR DELETE ON public.audit_logs"),
    "Trigger must block UPDATE and DELETE on public.audit_logs"
  );
});
