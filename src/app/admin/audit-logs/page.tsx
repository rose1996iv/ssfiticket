import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Calendar,
  ExternalLink,
  Filter,
  Lock,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { requireAnyRole } from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatIstDateTime } from "@/lib/date/timezone";
import {
  AUDIT_CATEGORY_LABELS,
  type AuditActionCategory,
  extractAuditSummaryFields,
  getActionsForCategory,
  getAuditActionInfo,
  sanitizeAuditMetadata,
} from "@/lib/audit/center";
import {
  AuditLogDetailModal,
  type AuditLogViewEntry,
} from "@/components/admin/AuditLogDetailModal";
import { AdminPaginationFooter } from "@/components/admin/AdminFilterAndPaginationBar";
import { computeServerPaginationWindow } from "@/lib/pagination/serverPagination";

export const dynamic = "force-dynamic";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TONE_BADGE_CLASSES: Record<AuditLogViewEntry["tone"], string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  rose: "border-rose-200 bg-rose-50 text-rose-800",
  purple: "border-purple-200 bg-purple-50 text-purple-800",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
};

const ROLE_BADGE_CLASSES: Record<string, string> = {
  SUPER_ADMIN: "border-purple-200 bg-purple-50 text-purple-800",
  ADMIN: "border-indigo-200 bg-indigo-50 text-indigo-800",
  FUNDRAISING_MANAGER: "border-blue-200 bg-blue-50 text-blue-800",
  STAFF: "border-indigo-200 bg-indigo-50 text-indigo-800",
  SELLER: "border-amber-200 bg-amber-50 text-amber-900",
  SYSTEM: "border-slate-200 bg-slate-100 text-slate-700",
};

type SearchParams = {
  q?: string;
  actor?: string;
  role?: string;
  category?: string;
  entityType?: string;
  order?: string;
  ticket?: string;
  seller?: string;
  from?: string;
  to?: string;
  page?: string;
  pageSize?: string;
};

export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAnyRole(["SUPER_ADMIN", "ADMIN", "FUNDRAISING_MANAGER"]);

  const resolvedParams = await searchParams;
  const searchQuery = (resolvedParams.q || "").trim();
  const actorFilter = (resolvedParams.actor || "").trim();
  const roleFilter = (resolvedParams.role || "").trim().toUpperCase();
  const categoryFilter = (resolvedParams.category || "").trim().toUpperCase();
  const entityTypeFilter = (resolvedParams.entityType || "").trim().toLowerCase();
  const orderFilter = (resolvedParams.order || "").trim();
  const ticketFilter = (resolvedParams.ticket || "").trim();
  const sellerFilter = (resolvedParams.seller || "").trim();
  const fromFilter = (resolvedParams.from || "").trim();
  const toFilter = (resolvedParams.to || "").trim();

  const paginationRequest = computeServerPaginationWindow({
    page: resolvedParams.page,
    pageSize: resolvedParams.pageSize || 25,
  });

  const admin = createSupabaseAdminClient();

  // 1. Fetch active sellers & staff/seller profiles for filter dropdowns and actor resolution
  const [{ data: allSellers }, { data: allRoleAssignments }] = await Promise.all([
    admin
      .from("sellers")
      .select("id, profile_id, seller_code, display_name, is_active")
      .order("seller_code", { ascending: true }),
    admin
      .from("profile_roles")
      .select("profile_id, roles(name)"),
  ]);

  const roleMapByProfileId = new Map<string, string>();
  const profileIdsByRole = new Map<string, Set<string>>();

  for (const pr of allRoleAssignments || []) {
    const pId = pr.profile_id as string;
    const roleObj = pr.roles as unknown as { name: string } | { name: string }[] | null;
    const roleName = Array.isArray(roleObj) ? roleObj[0]?.name : roleObj?.name;
    if (pId && roleName) {
      const upper = roleName.toUpperCase();
      // Prioritize highest privilege role per profile
      const current = roleMapByProfileId.get(pId);
      if (
        !current ||
        upper === "SUPER_ADMIN" ||
        (upper === "ADMIN" && current !== "SUPER_ADMIN")
      ) {
        roleMapByProfileId.set(pId, upper);
      }
      if (!profileIdsByRole.has(upper)) {
        profileIdsByRole.set(upper, new Set());
      }
      profileIdsByRole.get(upper)!.add(pId);
    }
  }

  for (const seller of allSellers || []) {
    if (seller.profile_id && !roleMapByProfileId.has(seller.profile_id)) {
      roleMapByProfileId.set(seller.profile_id, "SELLER");
    }
    if (seller.profile_id) {
      if (!profileIdsByRole.has("SELLER")) {
        profileIdsByRole.set("SELLER", new Set());
      }
      profileIdsByRole.get("SELLER")!.add(seller.profile_id);
    }
  }

  // 2. Resolve pre-filter lookups for Actor, Order, Ticket, Seller
  let forcedZeroResults = false;
  let matchingActorIds: string[] | null = null;

  if (actorFilter) {
    if (UUID_REGEX.test(actorFilter)) {
      matchingActorIds = [actorFilter];
    } else {
      const cleanActor = actorFilter.replace(/[,%()]/g, " ").trim();
      const { data: matchedProfiles } = await admin
        .from("profiles")
        .select("id")
        .or(`full_name.ilike.%${cleanActor}%,email.ilike.%${cleanActor}%`)
        .limit(100);
      matchingActorIds = (matchedProfiles || []).map((p) => p.id);
      if (matchingActorIds.length === 0) {
        forcedZeroResults = true;
      }
    }
  }

  // Resolve Order filter (Order UUID or Order Number e.g. SSFI-2026-XXXX)
  let resolvedOrderId: string | null = null;
  let resolvedOrderPaymentIds: string[] = [];
  if (orderFilter) {
    if (UUID_REGEX.test(orderFilter)) {
      resolvedOrderId = orderFilter;
    } else {
      const { data: orderRow } = await admin
        .from("orders")
        .select("id")
        .ilike("order_number", `%${orderFilter.replace(/[,%()]/g, "").trim()}%`)
        .limit(1)
        .maybeSingle();
      if (orderRow?.id) {
        resolvedOrderId = orderRow.id;
      } else {
        forcedZeroResults = true;
      }
    }

    if (resolvedOrderId) {
      const { data: orderPayments } = await admin
        .from("payments")
        .select("id")
        .eq("order_id", resolvedOrderId)
        .limit(20);
      resolvedOrderPaymentIds = (orderPayments || []).map((p) => p.id);
    }
  }

  // Resolve Ticket filter (Ticket UUID or Ticket Number e.g. SSFI-XXXX)
  let resolvedTicketId: string | null = null;
  let resolvedTicketOrderId: string | null = null;
  const cleanTicketTerm = ticketFilter.replace(/[,%()]/g, "").trim();
  if (cleanTicketTerm) {
    if (UUID_REGEX.test(cleanTicketTerm)) {
      resolvedTicketId = cleanTicketTerm;
    } else {
      const { data: ticketRow } = await admin
        .from("tickets")
        .select("id, order_id, ticket_number")
        .ilike("ticket_number", `%${cleanTicketTerm}%`)
        .limit(1)
        .maybeSingle();
      if (ticketRow) {
        resolvedTicketId = ticketRow.id;
        resolvedTicketOrderId = ticketRow.order_id;
      }
    }
  }

  // Resolve Seller filter (Seller UUID)
  let selectedSellerProfileId: string | null = null;
  let selectedSellerCode: string | null = null;
  if (sellerFilter && UUID_REGEX.test(sellerFilter)) {
    const matchedSeller = (allSellers || []).find((s) => s.id === sellerFilter);
    if (matchedSeller) {
      selectedSellerProfileId = matchedSeller.profile_id;
      selectedSellerCode = matchedSeller.seller_code;
    }
  }

  // 3. Build server-side paginated query on public.audit_logs
  let auditQuery = admin
    .from("audit_logs")
    .select(
      "id, actor_user_id, action, entity_type, entity_id, metadata, created_at",
      { count: "exact" }
    );

  if (forcedZeroResults) {
    auditQuery = auditQuery.eq("id", "00000000-0000-0000-0000-000000000000");
  } else {
    if (matchingActorIds && matchingActorIds.length > 0) {
      auditQuery = auditQuery.in("actor_user_id", matchingActorIds);
    }

    if (roleFilter) {
      if (roleFilter === "SYSTEM") {
        auditQuery = auditQuery.is("actor_user_id", null);
      } else if (
        roleFilter === "SELLER" ||
        roleFilter === "SUPER_ADMIN" ||
        roleFilter === "ADMIN" ||
        roleFilter === "FUNDRAISING_MANAGER"
      ) {
        const roleActorIds = Array.from(profileIdsByRole.get(roleFilter) || []);
        if (roleActorIds.length > 0) {
          auditQuery = auditQuery.or(
            `actor_user_id.in.(${roleActorIds.join(",")}),metadata->>actor_role.eq.${roleFilter}`
          );
        } else {
          auditQuery = auditQuery.eq("metadata->>actor_role", roleFilter);
        }
      }
    }

    if (categoryFilter) {
      const actions = getActionsForCategory(categoryFilter);
      if (actions.length > 0) {
        auditQuery = auditQuery.in("action", actions);
      }
    }

    if (entityTypeFilter) {
      auditQuery = auditQuery.eq("entity_type", entityTypeFilter);
    }

    if (resolvedOrderId) {
      const orClauses = [
        `entity_id.eq.${resolvedOrderId}`,
        `metadata->>order_id.eq.${resolvedOrderId}`,
      ];
      if (resolvedOrderPaymentIds.length > 0) {
        orClauses.push(`entity_id.in.(${resolvedOrderPaymentIds.join(",")})`);
      }
      auditQuery = auditQuery.or(orClauses.join(","));
    }

    if (cleanTicketTerm) {
      const ticketClauses: string[] = [
        `metadata->>ticket_number.ilike.%${cleanTicketTerm}%`,
        `metadata->>new_ticket_number.ilike.%${cleanTicketTerm}%`,
        `metadata->>original_ticket_number.ilike.%${cleanTicketTerm}%`,
      ];
      if (resolvedTicketId) {
        ticketClauses.push(`entity_id.eq.${resolvedTicketId}`);
        ticketClauses.push(`metadata->>ticket_id.eq.${resolvedTicketId}`);
      }
      if (resolvedTicketOrderId) {
        ticketClauses.push(`metadata->>order_id.eq.${resolvedTicketOrderId}`);
      }
      auditQuery = auditQuery.or(ticketClauses.join(","));
    }

    if (sellerFilter && UUID_REGEX.test(sellerFilter)) {
      const sellerClauses = [
        `entity_id.eq.${sellerFilter}`,
        `metadata->>seller_id.eq.${sellerFilter}`,
      ];
      if (selectedSellerProfileId) {
        sellerClauses.push(`actor_user_id.eq.${selectedSellerProfileId}`);
      }
      if (selectedSellerCode) {
        sellerClauses.push(`metadata->>seller_code.eq.${selectedSellerCode}`);
      }
      auditQuery = auditQuery.or(sellerClauses.join(","));
    }

    if (fromFilter) {
      const fromDate = new Date(`${fromFilter}T00:00:00+05:30`);
      if (!Number.isNaN(fromDate.getTime())) {
        auditQuery = auditQuery.gte("created_at", fromDate.toISOString());
      }
    }

    if (toFilter) {
      const toDate = new Date(`${toFilter}T23:59:59.999+05:30`);
      if (!Number.isNaN(toDate.getTime())) {
        auditQuery = auditQuery.lte("created_at", toDate.toISOString());
      }
    }

    if (searchQuery) {
      const cleanQ = searchQuery.replace(/[,%()]/g, " ").trim();
      if (UUID_REGEX.test(cleanQ)) {
        auditQuery = auditQuery.or(
          `id.eq.${cleanQ},entity_id.eq.${cleanQ},actor_user_id.eq.${cleanQ},metadata->>order_id.eq.${cleanQ},metadata->>payment_id.eq.${cleanQ},metadata->>customer_id.eq.${cleanQ},metadata->>seller_id.eq.${cleanQ}`
        );
      } else if (cleanQ.length > 0) {
        auditQuery = auditQuery.or(
          `action.ilike.%${cleanQ}%,entity_type.ilike.%${cleanQ}%,metadata->>reason.ilike.%${cleanQ}%,metadata->>order_number.ilike.%${cleanQ}%,metadata->>ticket_number.ilike.%${cleanQ}%,metadata->>seller_code.ilike.%${cleanQ}%,metadata->>rejection_reason.ilike.%${cleanQ}%`
        );
      }
    }
  }

  const {
    data: rawLogs,
    count: filteredCount,
    error: queryError,
  } = await auditQuery
    .order("created_at", { ascending: false })
    .range(paginationRequest.rangeFrom, paginationRequest.rangeTo);

  const pagination = computeServerPaginationWindow(
    {
      page: resolvedParams.page,
      pageSize: resolvedParams.pageSize || 25,
    },
    filteredCount ?? 0
  );

  // 4. Resolve Actor Profiles & Order Numbers for the current page only
  const pageLogs = rawLogs || [];
  const actorIdsToLookup = Array.from(
    new Set(
      pageLogs
        .map((l) => l.actor_user_id as string | null)
        .filter((id): id is string => Boolean(id))
    )
  );

  const actorProfileMap = new Map<
    string,
    { full_name: string | null; email: string | null }
  >();
  if (actorIdsToLookup.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", actorIdsToLookup);
    for (const p of profiles || []) {
      actorProfileMap.set(p.id, { full_name: p.full_name, email: p.email });
    }
  }

  // Enrich missing order_numbers for orders referenced on this page
  const orderIdsToLookup = new Set<string>();
  for (const row of pageLogs) {
    const meta = (row.metadata as Record<string, unknown>) || {};
    const oId =
      (row.entity_type === "order" ? (row.entity_id as string | null) : null) ||
      (typeof meta.order_id === "string" ? meta.order_id : null);
    if (oId && UUID_REGEX.test(oId) && typeof meta.order_number !== "string") {
      orderIdsToLookup.add(oId);
    }
  }

  const orderNumberMap = new Map<string, string>();
  if (orderIdsToLookup.size > 0) {
    const { data: orders } = await admin
      .from("orders")
      .select("id, order_number")
      .in("id", Array.from(orderIdsToLookup));
    for (const o of orders || []) {
      if (o.order_number) {
        orderNumberMap.set(o.id, o.order_number);
      }
    }
  }

  // 5. Fetch high-level summary metrics (server-side count only)
  const [
    { count: totalAuditEvents },
    { count: screenshotEventsCount },
    { count: customerEditEventsCount },
    { count: paymentDecisionEventsCount },
  ] = await Promise.all([
    admin.from("audit_logs").select("id", { count: "exact", head: true }),
    admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .in("action", [
        "PAYMENT_SCREENSHOT_VIEWED",
        "PAYMENT_SCREENSHOT_DOWNLOADED",
        "PAYMENT_SCREENSHOT_UPLOADED",
        "PAYMENT_SCREENSHOT_REPLACED",
      ]),
    admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .in("action", ["CUSTOMER_PROFILE_UPDATED", "TICKET_CONTACT_UPDATED"]),
    admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .in("action", [
        "PAYMENT_VERIFIED",
        "PAYMENT_REJECTED",
        "SELLER_PAYMENT_REVIEWED",
      ]),
  ]);

  // 6. Map page rows into AuditLogViewEntry
  const entries: AuditLogViewEntry[] = pageLogs.map((row) => {
    const actionInfo = getAuditActionInfo(row.action);
    const actorUserId = (row.actor_user_id as string | null) || null;
    const actorProfile = actorUserId ? actorProfileMap.get(actorUserId) : null;
    const inferredRole = actorUserId
      ? roleMapByProfileId.get(actorUserId) || null
      : "SYSTEM";

    const extracted = extractAuditSummaryFields({
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      actor_user_id: actorUserId,
      metadata: row.metadata,
      inferredActorRole: inferredRole,
    });

    const resolvedOrderNum =
      extracted.orderNumber ||
      (extracted.orderId ? orderNumberMap.get(extracted.orderId) || null : null);

    const actorName = actorUserId
      ? actorProfile?.full_name ||
        actorProfile?.email ||
        `User ${actorUserId.slice(0, 8)}…`
      : "System Automation";

    return {
      id: row.id,
      action: row.action,
      actionLabel: actionInfo.label,
      category: actionInfo.category,
      categoryLabel: actionInfo.categoryLabel,
      tone: actionInfo.tone,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorUserId,
      actorName,
      actorEmail: actorProfile?.email || null,
      actorRole: extracted.actorRole,
      reason: extracted.reason,
      oldValue: extracted.oldValue,
      newValue: extracted.newValue,
      orderId: extracted.orderId,
      orderNumber: resolvedOrderNum,
      paymentId: extracted.paymentId,
      ticketId: extracted.ticketId,
      ticketNumber: extracted.ticketNumber,
      customerId: extracted.customerId,
      sellerId: extracted.sellerId,
      sellerCode: extracted.sellerCode,
      createdAtIso: row.created_at,
      createdAtIst: formatIstDateTime(row.created_at),
      sanitizedMetadata: sanitizeAuditMetadata(row.metadata),
    };
  });

  const hasActiveFilters = Boolean(
    searchQuery ||
      actorFilter ||
      roleFilter ||
      categoryFilter ||
      entityTypeFilter ||
      orderFilter ||
      ticketFilter ||
      sellerFilter ||
      fromFilter ||
      toFilter
  );

  const preservedQueryParams: Record<string, string | undefined> = {
    q: searchQuery || undefined,
    actor: actorFilter || undefined,
    role: roleFilter || undefined,
    category: categoryFilter || undefined,
    entityType: entityTypeFilter || undefined,
    order: orderFilter || undefined,
    ticket: ticketFilter || undefined,
    seller: sellerFilter || undefined,
    from: fromFilter || undefined,
    to: toFilter || undefined,
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-xs font-bold text-emerald-800">
              <Lock className="h-3 w-3" />
              Append-Only Protected Ledger
            </span>
            <span className="text-xs font-medium text-slate-500">
              PostgreSQL Trigger Enforced
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            Centralized Admin Audit Center
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Complete chronological activity feed across Admin operations, Seller actions, payment verifications, ticket issuance, customer overrides, screenshot access, and email delivery.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/admin/orders"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
          >
            Orders Directory
          </Link>
          <Link
            href="/admin/payments"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
          >
            Pending Payments
          </Link>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
              Total Audit Events
            </span>
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {(totalAuditEvents ?? 0).toLocaleString("en-IN")}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Immutable records in <code className="font-mono">public.audit_logs</code>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
              Payment Reviews & Decisions
            </span>
            <Activity className="h-4 w-4 text-blue-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {(paymentDecisionEventsCount ?? 0).toLocaleString("en-IN")}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Admin verifications, rejections & seller reviews
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
              Customer & Ticket Edits
            </span>
            <UserCheck className="h-4 w-4 text-purple-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {(customerEditEventsCount ?? 0).toLocaleString("en-IN")}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Before/after contact overrides with mandatory reason
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
              Screenshot Access & Proofs
            </span>
            <Users className="h-4 w-4 text-indigo-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {(screenshotEventsCount ?? 0).toLocaleString("en-IN")}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Signed URL views, downloads, uploads & replacements
          </p>
        </div>
      </div>

      {/* Multi-Facet Server-Side Filter Form */}
      <form
        method="GET"
        action="/admin/audit-logs"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-slate-700 uppercase">
            <Filter className="h-3.5 w-3.5 text-amber-700" />
            Server-Side Forensic Filters
          </div>
          {hasActiveFilters && (
            <Link
              href="/admin/audit-logs"
              className="text-xs font-semibold text-rose-600 hover:text-rose-700"
            >
              Reset All Filters
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* General Keyword / Action / UUID Search */}
          <div className="lg:col-span-2">
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">
              Search Action, Reason, UUID, or Entity
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                name="q"
                defaultValue={searchQuery}
                placeholder="e.g. PAYMENT_VERIFIED, reason text, or UUID…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2 pr-3 pl-9 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-hidden"
              />
            </div>
          </div>

          {/* Action Category */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">
              Action Category
            </label>
            <select
              name="category"
              defaultValue={categoryFilter}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs font-medium text-slate-800 focus:border-amber-500 focus:bg-white focus:outline-hidden"
            >
              <option value="">All Categories</option>
              {(Object.keys(AUDIT_CATEGORY_LABELS) as AuditActionCategory[]).map(
                (cat) => (
                  <option key={cat} value={cat}>
                    {AUDIT_CATEGORY_LABELS[cat]}
                  </option>
                )
              )}
            </select>
          </div>

          {/* Actor Role */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">
              Actor Role
            </label>
            <select
              name="role"
              defaultValue={roleFilter}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs font-medium text-slate-800 focus:border-amber-500 focus:bg-white focus:outline-hidden"
            >
              <option value="">All Roles</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN</option>
              <option value="ADMIN">ADMIN</option>
              <option value="FUNDRAISING_MANAGER">FUNDRAISING_MANAGER</option>
              <option value="SELLER">SELLER</option>
              <option value="SYSTEM">SYSTEM</option>
            </select>
          </div>

          {/* Entity Type */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">
              Entity Type
            </label>
            <select
              name="entityType"
              defaultValue={entityTypeFilter}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs font-medium text-slate-800 focus:border-amber-500 focus:bg-white focus:outline-hidden"
            >
              <option value="">All Entities</option>
              <option value="order">order</option>
              <option value="payment">payment</option>
              <option value="ticket">ticket</option>
              <option value="customer">customer</option>
              <option value="seller">seller</option>
              <option value="campaign">campaign</option>
              <option value="customer_email_outbox">customer_email_outbox</option>
              <option value="system_settings">system_settings</option>
            </select>
          </div>

          {/* Actor Name / Email / UUID */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">
              Actor (Name, Email, or User ID)
            </label>
            <input
              type="text"
              name="actor"
              defaultValue={actorFilter}
              placeholder="Admin/Seller name or email…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-hidden"
            />
          </div>

          {/* Order ID / Order Number */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">
              Order ID / Order Number
            </label>
            <input
              type="text"
              name="order"
              defaultValue={orderFilter}
              placeholder="SSFI-2026-... or Order UUID"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-hidden"
            />
          </div>

          {/* Ticket Number */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">
              Ticket Number
            </label>
            <input
              type="text"
              name="ticket"
              defaultValue={ticketFilter}
              placeholder="e.g. SSFI-00123"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-hidden"
            />
          </div>

          {/* Seller Dropdown */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">
              Seller Attribution / Actor
            </label>
            <select
              name="seller"
              defaultValue={sellerFilter}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs font-medium text-slate-800 focus:border-amber-500 focus:bg-white focus:outline-hidden"
            >
              <option value="">All Sellers</option>
              {(allSellers || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.seller_code} — {s.display_name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range From / To */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                From (IST)
              </label>
              <input
                type="date"
                name="from"
                defaultValue={fromFilter}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-2.5 py-2 text-xs text-slate-800 focus:border-amber-500 focus:bg-white focus:outline-hidden"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                To (IST)
              </label>
              <input
                type="date"
                name="to"
                defaultValue={toFilter}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-2.5 py-2 text-xs text-slate-800 focus:border-amber-500 focus:bg-white focus:outline-hidden"
              />
            </div>
          </div>
        </div>

        {/* Filter Submit Row */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <span>
              Showing{" "}
              <strong className="font-semibold text-slate-800">
                {(filteredCount ?? 0).toLocaleString("en-IN")}
              </strong>{" "}
              matching audit events
            </span>
          </div>

          <div className="flex items-center gap-2">
            <select
              name="pageSize"
              defaultValue={String(pagination.pageSize)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700"
            >
              <option value="25">25 / page</option>
              <option value="50">50 / page</option>
              <option value="100">100 / page</option>
            </select>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-slate-800"
            >
              <Search className="h-3.5 w-3.5" />
              Apply Audit Filters
            </button>
          </div>
        </div>
      </form>

      {/* Error Alert if any */}
      {queryError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800">
          Unable to query audit logs: {queryError.message}
        </div>
      )}

      {/* Chronological Activity Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                <th className="px-4 py-3.5">Timestamp (IST)</th>
                <th className="px-4 py-3.5">Actor & Role</th>
                <th className="px-4 py-3.5">Action & Category</th>
                <th className="px-4 py-3.5">Target Entity & Links</th>
                <th className="px-4 py-3.5">Reason & Before / After</th>
                <th className="px-4 py-3.5 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-sm text-slate-500"
                  >
                    No audit log entries match the selected filters.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => {
                  const diffKeys = Array.from(
                    new Set([
                      ...Object.keys(entry.oldValue || {}),
                      ...Object.keys(entry.newValue || {}),
                    ])
                  ).filter(
                    (k) =>
                      JSON.stringify(entry.oldValue?.[k] ?? null) !==
                      JSON.stringify(entry.newValue?.[k] ?? null)
                  );

                  const roleClass =
                    ROLE_BADGE_CLASSES[entry.actorRole] ||
                    ROLE_BADGE_CLASSES.SYSTEM;

                  return (
                    <tr
                      key={entry.id}
                      className="align-top transition hover:bg-slate-50/70"
                    >
                      {/* Timestamp */}
                      <td className="whitespace-nowrap px-4 py-3.5">
                        <div className="font-semibold text-slate-900">
                          {entry.createdAtIst}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                          #{entry.id.slice(0, 8)}
                        </div>
                      </td>

                      {/* Actor & Role */}
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-slate-900">
                            {entry.actorName}
                          </span>
                          <span
                            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${roleClass}`}
                          >
                            {entry.actorRole}
                          </span>
                        </div>
                        {entry.actorEmail && (
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {entry.actorEmail}
                          </div>
                        )}
                        <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                          {entry.actorUserId
                            ? `ID: ${entry.actorUserId.slice(0, 8)}…`
                            : "Automated System"}
                        </div>
                      </td>

                      {/* Action & Category */}
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${TONE_BADGE_CLASSES[entry.tone]}`}
                          >
                            {entry.actionLabel}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[10px] font-semibold text-slate-500">
                            {entry.action}
                          </span>
                          <span className="text-slate-300">•</span>
                          <span className="text-[11px] font-medium text-slate-500">
                            {entry.categoryLabel}
                          </span>
                        </div>
                      </td>

                      {/* Target Entity & Cross-Links */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 uppercase">
                            {entry.entityType}
                          </span>
                          {entry.entityId && (
                            <span className="font-mono text-[11px] text-slate-500">
                              {entry.entityId.slice(0, 8)}…
                            </span>
                          )}
                        </div>

                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {entry.orderId && (
                            <Link
                              href={`/admin/orders/${entry.orderId}`}
                              className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50/80 px-2 py-0.5 text-[11px] font-semibold text-blue-800 hover:bg-blue-100"
                            >
                              {entry.orderNumber || `Order ${entry.orderId.slice(0, 6)}…`}
                              <ExternalLink className="h-2.5 w-2.5" />
                            </Link>
                          )}
                          {entry.paymentId && (
                            <Link
                              href={`/admin/payments/${entry.paymentId}`}
                              className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50/80 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                            >
                              Payment {entry.paymentId.slice(0, 6)}…
                              <ExternalLink className="h-2.5 w-2.5" />
                            </Link>
                          )}
                          {entry.ticketNumber && (
                            <Link
                              href={`/admin/tickets?q=${encodeURIComponent(
                                entry.ticketNumber.split(" ")[0]
                              )}`}
                              className="inline-flex items-center gap-1 rounded border border-purple-200 bg-purple-50/80 px-2 py-0.5 text-[11px] font-semibold text-purple-800 hover:bg-purple-100"
                            >
                              {entry.ticketNumber}
                              <ExternalLink className="h-2.5 w-2.5" />
                            </Link>
                          )}
                          {entry.sellerCode && (
                            <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50/70 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-900">
                              {entry.sellerCode}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Reason & Before/After Preview */}
                      <td className="max-w-md px-4 py-3.5">
                        {entry.reason ? (
                          <p className="line-clamp-2 text-xs font-medium text-slate-800">
                            {entry.reason}
                          </p>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">
                            No explicit reason note recorded
                          </span>
                        )}

                        {diffKeys.length > 0 && (
                          <div className="mt-1.5 space-y-1 rounded-lg border border-slate-200 bg-slate-50/80 p-2">
                            {diffKeys.slice(0, 3).map((key) => (
                              <div
                                key={key}
                                className="flex flex-wrap items-center gap-1 text-[11px]"
                              >
                                <span className="font-mono font-semibold text-slate-600">
                                  {key}:
                                </span>
                                <span className="max-w-[140px] truncate rounded bg-rose-50 px-1 font-mono text-rose-700">
                                  {String(entry.oldValue?.[key] ?? "—")}
                                </span>
                                <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" />
                                <span className="max-w-[140px] truncate rounded bg-emerald-50 px-1 font-mono font-semibold text-emerald-800">
                                  {String(entry.newValue?.[key] ?? "—")}
                                </span>
                              </div>
                            ))}
                            {diffKeys.length > 3 && (
                              <div className="text-[10px] font-medium text-slate-500">
                                +{diffKeys.length - 3} more modified fields
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Inspect Modal Trigger */}
                      <td className="whitespace-nowrap px-4 py-3.5 text-right">
                        <AuditLogDetailModal entry={entry} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Server-Side Pagination Footer */}
        <div className="border-t border-slate-200 px-4 py-3">
          <AdminPaginationFooter
            basePath="/admin/audit-logs"
            pagination={pagination}
            queryParams={preservedQueryParams}
          />
        </div>
      </div>
    </div>
  );
}

