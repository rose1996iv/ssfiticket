# Ticket System

## IMPLEMENTED

Orders will use human-readable references in the form `ORD-YYYY-######`; tickets will use `SSFI-######`. Database primary keys remain UUIDs and are not replaced by public identifiers.

Ticket issuance is server-side only through `issue_tickets(order_id)`, callable exclusively by `service_role`. It locks the order and campaign, requires an active campaign, correct order lifecycle, and matching VERIFIED payment, then uses a non-cycling database sequence to produce `SSFI-000001` through `SSFI-001000`. It checks capacity while the campaign row is locked, inserts tickets and audit data, and updates order/campaign state atomically.

## NOT YET IMPLEMENTED

QR codes, public verification endpoint/view, draw selection, and result publication.
