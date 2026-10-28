# Database Plan

## IMPLEMENTED

`supabase/migrations/202610270001_phase2_core.sql` creates the following UUID-keyed tables, enums, indexes, updated-at triggers, security-definer role helpers, RLS policies, and the ticket issuance function. Migration seed data includes roles, one DRAFT SSFI campaign, and five prizes only.

| Table | Purpose, key fields, relationships | RLS scope |
| --- | --- | --- |
| `profiles` | User profile keyed by `id` (auth user UUID); relates to roles and seller identity. | Owner read; staff write. |
| `roles` | Role catalogue, UUID `id`, unique role name. | Staff read. |
| `profile_roles` | Profile-to-role mapping with composite uniqueness. | Staff read; service/admin workflow writes. |
| `campaigns` | Draw campaign, UUID `id`, paise price, capacity and lifecycle. | Public active read; staff write. |
| `prizes` | Prize per campaign, UUID `id`, rank, description/value. | Public active read; staff write. |
| `draws` | Draw event, UUID `id`, campaign reference, status/timestamp. | Staff only. |
| `draw_results` | Winner relation with one winner per prize/ticket per draw. | Staff only; a privacy-safe public view is future work. |
| `customers` | Customer UUID `id`, contact data, optional profile link. | Owner, assigned seller, staff. |
| `sellers` | Seller UUID `id`, profile ref, unique seller code. | Seller self and staff. |
| `orders` | UUID `id`, unique public order number, integer paise totals and state. | Customer owner, assigned seller, staff. |
| `order_items` | UUID `id`, order ref and quantity/price snapshot. | Inherits authorized order scope. |
| `tickets` | UUID `id`, unique `SSFI-######`, order/campaign refs, lifecycle fields. | Owner/seller scoped; no public table access. |
| `payments` | UUID `id`, MANUAL_UPI reference, integer amount and lifecycle. | Authorized order scope; server/staff writes. |
| `payment_events` | Immutable payment status history. | Staff read; server writes. |
| `ticket_verifications` | Privacy-minimized verification activity. | Staff read; server writes. |
| `audit_logs` | Append-only actor/action/resource metadata. | Staff read; ordinary writes revoked. |
| `seller_daily_summaries` | Planned reporting aggregate. | NOT YET IMPLEMENTED. |
| `notification_logs` | Planned delivery log. | NOT YET IMPLEMENTED. |

Foreign keys, unique constraints, paise arithmetic, transition triggers, and the issuance function enforce integrity. A configured Supabase project is required to apply or execute this migration.

## Phase 3 migration review

`202610270002_phase3_operations.sql` is a separate, unapplied migration. It adds the seller order, UTR submission, staff verification, and rejection RPCs; records payment/order audit events; rejects duplicate UTR references; and calls the existing `issue_tickets(order_id)` function after payment verification. It must be reviewed and applied through the normal Supabase migration process before enabling the Phase 3 workflows in an environment.
