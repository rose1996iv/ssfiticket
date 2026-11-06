# SSFI Lucky Draw Email Automation — Google Apps Script Deployment Guide

This directory contains the Google Apps Script Web App (`SSFI Lucky Draw Email Automation`) used by the SSFI Lucky Draw system to automatically deliver verified customer tickets by email after administrative payment approval and ticket issuance.

---

## 1. Architecture & Security Overview

- **Trigger Rule**: The Next.js backend invokes this Web App **only** after `verify_payment_and_issue(p_payment_id, p_actor)` succeeds, payment status is `VERIFIED`, order status is `TICKETS_ISSUED`, and sequential ticket numbers (`SSFI-XXXXXX`) have been committed.
- **Server-Only Invocation**: The Web App URL and shared secret are strictly server-only (`src/lib/delivery/providers/appsScript.ts`) and are never exposed to the browser.
- **Authentication**: Every `POST` request includes a shared secret (`APPS_SCRIPT_SHARED_SECRET`), timestamp (`5-minute` replay window), and `HMAC-SHA256` signature over `${timestamp}.${idempotencyKey}.${recipient}`.
- **Idempotency**:
  - Database level: `customer_email_outbox` enforces a unique `idempotency_key` (`TICKETS_ISSUED:${orderId}`).
  - Apps Script level: `CacheService.getScriptCache()` deduplicates rapid retries by `idempotencyKey`.
- **Preview Safety Gate**: In non-production environments (`VERCEL_ENV !== "production"`), live transmission is strictly restricted to the approved test email (`ALLOWED_TEST_EMAIL` / `GMAIL_PREVIEW_ALLOWED_RECIPIENT` / `PREVIEW_ALLOWED_RECIPIENT`). All other addresses are safely simulated.

---

## 2. Step-by-Step Google Apps Script Setup

1. Open [script.google.com](https://script.google.com) while signed into the official SSFI Google account (`Senthangstudents@gmail.com`).
2. Click **New project** and rename the project to:
   **`SSFI Lucky Draw Email Automation`**
3. Replace the contents of `Code.gs` with [`Code.gs`](./Code.gs).
4. In **Project Settings** (gear icon on the left):
   - Check **"Show 'appsscript.json' manifest file in editor"** and copy [`appsscript.json`](./appsscript.json) if needed.
   - Scroll down to **Script Properties** and add the following properties:
     | Property | Value |
     |---|---|
     | `APPS_SCRIPT_SHARED_SECRET` | A strong 32+ character random secret (e.g. `openssl rand -hex 32`) |
     | `SENDER_NAME` | `Senthang Students Fellowship India (SSFI)` |
     | `REPLY_TO_EMAIL` | `Senthangstudents@gmail.com` |
     | `PREVIEW_ALLOWED_RECIPIENT` | Your approved test email address for Preview testing |
5. Click **Deploy** → **New deployment**:
   - **Select type**: `Web app`
   - **Description**: `SSFI Lucky Draw Email Automation v1`
   - **Execute as**: `Me (Senthangstudents@gmail.com)`
   - **Who has access**: `Anyone` *(required so Vercel serverless functions can POST without browser cookies; all requests are authenticated via `APPS_SCRIPT_SHARED_SECRET` + `HMAC-SHA256`)*
6. Authorize the script when prompted (`https://www.googleapis.com/auth/script.send_mail`), then copy the generated **Web app URL** (`https://script.google.com/macros/s/.../exec`).

---

## 3. Vercel Environment Variables (Server-Only)

Configure the following environment variables in Vercel (**Preview** first; never use `NEXT_PUBLIC_` prefixes):

| Variable Name | Description |
|---|---|
| `APPS_SCRIPT_WEB_APP_URL` | The `/exec` Web App URL from Google Apps Script deployment |
| `APPS_SCRIPT_SHARED_SECRET` | The exact shared secret set in Apps Script `Script Properties` |
| `APPS_SCRIPT_SENDER_NAME` | *(Optional)* `Senthang Students Fellowship India (SSFI)` |
| `APPS_SCRIPT_REPLY_TO` | *(Optional)* `Senthangstudents@gmail.com` |
| `ALLOWED_TEST_EMAIL` | Approved test email recipient permitted to receive real emails in Preview |

