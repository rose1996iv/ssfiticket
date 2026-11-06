# SSFI Lucky Draw — Row Level Security (RLS) Authorization Matrix (Phase B)

**Document Reference:** `docs/preview/phase-b-rls-authorization-matrix.md`  
**Version:** 1.0.0  
**Date:** 2 November 2026  
**Auditor Roles:** Principal Software Architect, Supabase Security Engineer  
**Workspace:** `F:\PROJECT\Lucky Draw`  
**Scope:** Complete inventory and evaluation of all 34 Row Level Security policies across the 22 public tables.

---

## 1. Executive Security Evaluation

Every public table in the SSFI Lucky Draw database has **Row Level Security enabled** (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).

### Core Security Design Rules:
1. **Zero Client Write to Sensitive Outboxes & Audit Logs:** Client roles (`anon`, `authenticated`) have zero `INSERT`, `UPDATE`, or `DELETE` policies on `audit_logs`, `customer_email_outbox`, `system_settings`, `payment_screenshots`, and `payment_recovery_tokens`. All mutations are executed server-side via `createSupabaseAdminClient()` (`service_role`).
2. **Caller Identity Enforcement:** Policies relying on helper functions (`has_role`, `is_staff`, `owns_customer`, `seller_owns_customer`) enforce caller authorization, preventing horizontal user privilege escalation.
3. **Fail-Closed Public Read:** Public anonymous read is strictly limited to `campaigns` (where `status = 'ACTIVE'`) and `prizes` (where the parent campaign is active).

---

## 2. Master Policy Catalog (34 Policies Across 22 Tables)

| # | Table Name | Policy Name | Command | Target Role | USING Expression | WITH CHECK Expression | Workflow Purpose |
|---|---|---|---|---|---|---|---|
| 1 | `audit_logs` | `audit_staff_read` | SELECT | authenticated | `public.is_staff(auth.uid())` | — | Admin audit viewer |
| 2 | `campaigns` | `campaigns_public_read` | SELECT | public | `status = 'ACTIVE' OR public.is_staff(auth.uid())` | — | Public landing & checkout |
| 3 | `campaigns` | `campaigns_staff_write` | ALL | authenticated | `public.is_staff(auth.uid())` | `public.is_staff(auth.uid())` | Admin campaign configuration |
| 4 | `customers` | `customers_access` | SELECT | authenticated | `owns_customer(id) OR seller_owns_customer(id) OR is_staff(auth.uid())` | — | Customer / seller order view |
| 5 | `draws` | `draws_staff_access` | ALL | authenticated | `public.is_staff(auth.uid())` | `public.is_staff(auth.uid())` | Admin draw execution |
| 6 | `draw_results` | `results_staff_access` | ALL | authenticated | `public.is_staff(auth.uid())` | `public.is_staff(auth.uid())` | Winning numbers management |
| 7 | `order_items` | `order_items_access` | SELECT | authenticated | `order_id IN (SELECT id FROM public.orders)` | — | Order line item display |
| 8 | `orders` | `orders_access` | SELECT | authenticated | `owns_customer(customer_id) OR seller_id = current_seller_id() OR is_staff(auth.uid())` | — | Order history & seller sales |
| 9 | `payment_events`| `payment_events_staff_read`| SELECT | authenticated | `public.is_staff(auth.uid())` | — | Payment audit trail |
| 10 | `payments` | `payments_access` | SELECT | authenticated | `order_id IN (SELECT id FROM public.orders)` | — | Payment receipt lookup |
| 11 | `prizes` | `prizes_public_read` | SELECT | public | `EXISTS (SELECT 1 FROM campaigns c WHERE c.id = campaign_id AND (c.status = 'ACTIVE' OR is_staff(auth.uid())))` | — | Public prize showcase |
| 12 | `prizes` | `prizes_staff_write` | ALL | authenticated | `public.is_staff(auth.uid())` | `public.is_staff(auth.uid())` | Admin prize configuration |
| 13 | `profiles` | `profiles_own_select` | SELECT | authenticated | `id = auth.uid() OR public.is_staff(auth.uid())` | — | Profile viewing |
| 14 | `profiles` | `profiles_staff_write` | ALL | authenticated | `public.is_staff(auth.uid())` | `public.is_staff(auth.uid())` | Admin user management |
| 15 | `profile_roles`| `profile_roles_staff_read`| SELECT | authenticated | `public.is_staff(auth.uid())` | — | RBAC inspection |
| 16 | `roles` | `roles_staff_read` | SELECT | authenticated | `public.is_staff(auth.uid())` | — | Role catalog lookup |
| 17 | `seller_messages`| `seller_messages_seller_insert`| INSERT | authenticated | — | `sender_role = 'SELLER' AND EXISTS (SELECT 1 FROM sellers s WHERE s.id = recipient_seller_id AND s.profile_id = auth.uid() AND s.is_active = true)` | Seller messaging outbox |
| 18 | `seller_messages`| `seller_messages_seller_read` | SELECT | authenticated | `EXISTS (SELECT 1 FROM sellers s WHERE s.id = recipient_seller_id AND s.profile_id = auth.uid())` | — | Seller messaging inbox |
| 19 | `seller_messages`| `seller_messages_seller_update`| UPDATE | authenticated | `EXISTS (SELECT 1 FROM sellers s WHERE s.id = recipient_seller_id AND s.profile_id = auth.uid())` | Same as USING | Mark messages read |
| 20 | `seller_messages`| `seller_messages_staff_insert` | INSERT | authenticated | — | `public.is_staff(auth.uid())` | Admin staff broadcast |
| 21 | `seller_messages`| `seller_messages_staff_read` | SELECT | authenticated | `public.is_staff(auth.uid())` | — | Admin messaging view |
| 22 | `seller_messages`| `seller_messages_staff_update` | UPDATE | authenticated | `public.is_staff(auth.uid())` | Same as USING | Admin mark read |
| 23 | `sellers` | `sellers_access` | SELECT | authenticated | `profile_id = auth.uid() OR public.is_staff(auth.uid())` | — | Seller profile & code |
| 24 | `ticket_deliveries`| `ticket_deliveries_customer_read`| SELECT | authenticated | `public.owns_customer(customer_id)` | — | Customer delivery receipt |
| 25 | `ticket_deliveries`| `ticket_deliveries_seller_read`| SELECT | authenticated | `EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.seller_id = current_seller_id())` | — | Seller referral tracking |
| 26 | `ticket_deliveries`| `ticket_deliveries_staff_read`| SELECT | authenticated | `public.is_staff(auth.uid())` | — | Delivery management console |
| 27 | `tickets` | `tickets_access` | SELECT | authenticated | `order_id IN (SELECT id FROM public.orders)` | — | Issued ticket lookup |
| 28 | `ticket_verifications`| `verification_staff_read`| SELECT | authenticated | `public.is_staff(auth.uid())` | — | Verification audit log |
| 29 | `system_settings`| `system_settings_staff_read` | SELECT | authenticated | `public.is_staff(auth.uid())` | — | Feature flags & gates |
| 30 | `system_settings`| `system_settings_staff_update` | UPDATE | authenticated | `public.is_staff(auth.uid())` | Same as USING | Admin gate toggles |
| 31 | `customer_email_outbox`| `customer_email_outbox_staff_read`| SELECT | authenticated | `public.is_staff(auth.uid())` | — | Admin outbox queue view |
| 32 | `payment_recovery_tokens`| `service_role_all_tokens` | ALL | service_role | `true` | `true` | Token generation & intake |
| 33 | `payment_recovery_tokens`| `staff_select_tokens` | SELECT | authenticated | `has_role(SUPER_ADMIN) OR has_role(ADMIN)` | — | Admin recovery link list |
| 34 | `payment_screenshots`| *Service Role Exclusive* | ALL | service_role | Direct client permissions revoked | Direct client permissions revoked | Private proof storage |

---

## 3. Role-Based Access Matrix

| Entity Category | Anonymous Visitors | Authenticated Customer | Active Seller | Super Admin & Admin | Service Role (Backend) |
|---|---|---|---|---|---|
| **Active Campaigns** | SELECT | SELECT | SELECT | ALL | ALL (Bypasses RLS) |
| **Draft / Closed Campaigns**| NONE | NONE | NONE | ALL | ALL (Bypasses RLS) |
| **Prizes (Active Campaign)**| SELECT | SELECT | SELECT | ALL | ALL (Bypasses RLS) |
| **Customer Profiles** | NONE | Own Record | Referred Customers | ALL | ALL (Bypasses RLS) |
| **Orders & Tickets** | NONE | Own Orders | Referred Orders | ALL | ALL (Bypasses RLS) |
| **Payments** | NONE | Own Payments | Referred Orders | ALL | ALL (Bypasses RLS) |
| **Seller Messages** | NONE | NONE | Own Thread | ALL | ALL (Bypasses RLS) |
| **Audit Logs** | NONE | NONE | NONE | SELECT | ALL (Bypasses RLS) |
| **Payment Recovery Tokens**| NONE | NONE | NONE | SELECT | ALL (Bypasses RLS) |
| **Payment Screenshots**| NONE | NONE | NONE | Via Signed URL | ALL (Bypasses RLS) |
| **System Settings** | NONE | NONE | NONE | SELECT, UPDATE | ALL (Bypasses RLS) |
| **Email Outbox** | NONE | NONE | NONE | SELECT | ALL (Bypasses RLS) |

---

## 4. RLS Divergence: Production Dump vs Target Preview Architecture

- **Missing Seller Messaging Policies in Production:** Historical Production lacks the bidirectional message policies (`seller_messages_seller_insert`, `seller_messages_seller_update`), which causes seller inboxes to throw authorization errors upon responding to admin messages.
- **`is_staff` Public Dependency:** In historical Production, `is_staff` was not granted to `anon`. However, `campaigns_public_read` evaluates `is_staff(auth.uid())`. If unauthenticated visitors access the homepage without this grant, PostgreSQL returns error `42501 (permission denied for function is_staff)`. The target Preview architecture grants `EXECUTE ON FUNCTION public.is_staff(uuid) TO anon, authenticated, service_role` with an internal null check returning `false` immediately.

