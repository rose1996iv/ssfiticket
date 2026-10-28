# Payment Architecture

## IMPLEMENTED

The schema supports **MANUAL_UPI** only: a payment is created as `PENDING`, submitted with an indexed UTR/reference, and can be moved through guarded lifecycle states. A UTR alone never verifies a payment. Issuance requires a matching server-confirmed `VERIFIED` payment.

## Phase 3 workflow

Seller order entry creates a `PENDING` manual-UPI payment. A seller submits a UTR/reference, moving it to `SUBMITTED`; a server-authorized staff member can verify or reject it. A rejected reference can be replaced and resubmitted. Verification locks the payment and order, confirms the expected amount, and invokes the existing issuance function atomically. The browser cannot verify a payment.

Payment Gateway = **NOT implemented**. There is no gateway checkout, webhook, automated verification, or provider SDK.

The future service layer will expose a provider interface so business logic does not depend on a specific commercial provider. The current planned development implementation is `ManualPaymentProvider`; production may use an `ApprovedPaymentProvider` only after legal, commercial, and campaign approval. No provider is assumed available.

Planned payment states are `PENDING`, `SUBMITTED`, `VERIFIED`, `FAILED`, `REFUNDED`, and `CANCELLED`. Only trusted server-side evidence may transition to `VERIFIED`; ticket issuance follows verified payment through an idempotent, audited workflow.
