/**
 * ============================================================================
 * Project: SSFI Lucky Draw Email Automation
 * Platform: Google Apps Script Web App (V8 Runtime)
 * Organization: Senthang Students Fellowship India (SSFI)
 * ============================================================================
 *
 * PURPOSE
 * -------
 * Secure server-to-server webhook endpoint (`doPost(e)`) for dispatching
 * authoritative SSFI Lucky Draw ticket confirmation and transactional emails
 * via Google's `MailApp` service after server-side payment verification and
 * ticket issuance.
 *
 * REQUIRED SCRIPT PROPERTIES (Project Settings -> Script Properties)
 * ------------------------------------------------------------------
 * - APPS_SCRIPT_SHARED_SECRET : High-entropy shared secret (32+ chars) matching
 *                               the Next.js server environment variable.
 * - SENDER_NAME               : (Optional) Defaults to "Senthang Students Fellowship India (SSFI)"
 * - REPLY_TO_EMAIL            : (Optional) Defaults to "Senthangstudents@gmail.com"
 * - PREVIEW_ALLOWED_RECIPIENT : (Optional) Approved test inbox allowed when
 *                               environment !== "production".
 */

var DEFAULT_SENDER_NAME = "Senthang Students Fellowship India (SSFI)";
var DEFAULT_REPLY_TO = "Senthangstudents@gmail.com";
var DEFAULT_TICKET_SUBJECT = "Congratulations! Your SSFI Lucky Draw Ticket Is Ready";
var REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
var IDEMPOTENCY_TTL_SECONDS = 21600; // 6 hours (maximum CacheService TTL)

/**
 * Rejects browser / GET requests with a structured JSON error.
 */
function doGet() {
  return buildJsonResponse({
    ok: false,
    status: "REJECTED",
    error: "Method not allowed. Use authenticated server-side POST from the SSFI backend.",
    timestamp: new Date().toISOString()
  });
}

/**
 * Primary server-to-server webhook handler.
 * Accepts JSON payloads signed with APPS_SCRIPT_SHARED_SECRET.
 */
function doPost(e) {
  var nowIso = new Date().toISOString();

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return buildJsonResponse({
        ok: false,
        status: "INVALID_REQUEST",
        error: "Missing POST body payload.",
        timestamp: nowIso
      });
    }

    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return buildJsonResponse({
        ok: false,
        status: "INVALID_JSON",
        error: "Request body must be valid JSON.",
        timestamp: nowIso
      });
    }

    var props = PropertiesService.getScriptProperties();
    var configuredSecret = (props.getProperty("APPS_SCRIPT_SHARED_SECRET") || "").trim();

    if (!configuredSecret || configuredSecret.length < 16) {
      return buildJsonResponse({
        ok: false,
        status: "SERVER_MISCONFIGURED",
        error: "APPS_SCRIPT_SHARED_SECRET is not configured in Script Properties.",
        timestamp: nowIso
      });
    }

    // 1. Authenticate Shared Secret & HMAC-SHA256 Signature
    var auth = payload.auth || {};
    var providedSecret = String(auth.secret || payload.secret || "").trim();
    var providedSignature = String(auth.signature || "").trim();
    var providedTimestamp = Number(auth.timestamp || 0);

    if (!providedSecret || !timingSafeEqual(providedSecret, configuredSecret)) {
      return buildJsonResponse({
        ok: false,
        status: "UNAUTHORIZED",
        error: "Invalid or missing shared secret.",
        timestamp: nowIso
      });
    }

    // Replay window and HMAC verification when timestamp + signature are supplied
    if (providedTimestamp > 0) {
      var drift = Math.abs(Date.now() - providedTimestamp);
      if (drift > REPLAY_WINDOW_MS) {
        return buildJsonResponse({
          ok: false,
          status: "EXPIRED_TIMESTAMP",
          error: "Request timestamp is outside the allowed 5-minute replay window.",
          timestamp: nowIso
        });
      }
    }

    var idempotencyKey = String(payload.idempotencyKey || "").trim();
    var recipient = String(payload.recipient || "").trim().toLowerCase();

    if (providedSignature) {
      var signingInput = String(providedTimestamp) + "." + idempotencyKey + "." + recipient;
      var expectedSig = computeHmacHex(signingInput, configuredSecret);
      if (!timingSafeEqual(providedSignature.toLowerCase(), expectedSig.toLowerCase())) {
        return buildJsonResponse({
          ok: false,
          status: "INVALID_SIGNATURE",
          error: "HMAC-SHA256 signature verification failed.",
          timestamp: nowIso
        });
      }
    }

    var action = String(payload.action || "SEND_TICKET_EMAIL").trim().toUpperCase();

    // 2. Health Check Action (Does not send email)
    if (action === "HEALTH_CHECK") {
      var quota = MailApp.getRemainingDailyQuota();
      var senderNameProp = (props.getProperty("SENDER_NAME") || DEFAULT_SENDER_NAME).trim();
      var replyToProp = (props.getProperty("REPLY_TO_EMAIL") || DEFAULT_REPLY_TO).trim();

      return buildJsonResponse({
        ok: true,
        status: "HEALTHY",
        provider: "google_apps_script",
        senderName: senderNameProp,
        replyTo: replyToProp,
        remainingDailyQuota: quota,
        timestamp: nowIso
      });
    }

    // 3. Validate Required Email Fields
    if (!recipient || !isValidEmail(recipient)) {
      return buildJsonResponse({
        ok: false,
        status: "VALIDATION_ERROR",
        error: "A valid recipient email address is required.",
        timestamp: nowIso
      });
    }

    var eventType = String(payload.eventType || "TICKETS_ISSUED").trim().toUpperCase();
    var orderNumber = String(payload.orderNumber || "").trim();
    var ticketNumbers = Array.isArray(payload.ticketNumbers) ? payload.ticketNumbers : [];

    // Strict guard for TICKETS_ISSUED: must include order reference and at least one issued ticket number
    if (eventType === "TICKETS_ISSUED") {
      if (!orderNumber) {
        return buildJsonResponse({
          ok: false,
          status: "VALIDATION_ERROR",
          error: "orderNumber is required for TICKETS_ISSUED email delivery.",
          timestamp: nowIso
        });
      }
      if (ticketNumbers.length === 0) {
        return buildJsonResponse({
          ok: false,
          status: "VALIDATION_ERROR",
          error: "At least one issued ticketNumber is required before sending ticket confirmation.",
          timestamp: nowIso
        });
      }
    }

    var subject = String(payload.subject || DEFAULT_TICKET_SUBJECT).trim();
    var htmlBody = String(payload.htmlBody || "").trim();
    var textBody = String(payload.textBody || "").trim();

    if (!htmlBody && !textBody) {
      return buildJsonResponse({
        ok: false,
        status: "VALIDATION_ERROR",
        error: "Email body content (htmlBody or textBody) is required.",
        timestamp: nowIso
      });
    }

    // 4. Environment & Preview Safety Gate (Defense-in-Depth)
    var environment = String(payload.environment || "preview").trim().toLowerCase();
    if (environment !== "production") {
      var allowedPreviewProp = (props.getProperty("PREVIEW_ALLOWED_RECIPIENT") || "").trim().toLowerCase();
      var allowedFromPayload = String(payload.allowedPreviewRecipient || "").trim().toLowerCase();
      var effectiveAllowed = allowedPreviewProp || allowedFromPayload;

      if (!effectiveAllowed || recipient !== effectiveAllowed) {
        return buildJsonResponse({
          ok: false,
          status: "BLOCKED_BY_PREVIEW_GATE",
          error: "Non-production environment blocked: recipient does not match approved test email.",
          timestamp: nowIso
        });
      }
    }

    // 5. Idempotency Guard via CacheService (Prevents Duplicate Emails on Retry)
    var cache = CacheService.getScriptCache();
    var cacheKey = idempotencyKey ? "ssfi_email_" + Utilities.base64EncodeWebSafe(idempotencyKey).slice(0, 180) : null;

    if (cacheKey) {
      var cachedMessageId = cache.get(cacheKey);
      if (cachedMessageId) {
        return buildJsonResponse({
          ok: true,
          status: "SENT",
          deduplicated: true,
          provider: "google_apps_script",
          messageId: cachedMessageId,
          recipient: recipient,
          orderNumber: orderNumber || null,
          timestamp: nowIso
        });
      }
    }

    // 6. Check Daily Quota & Send Email via MailApp
    var remainingQuota = MailApp.getRemainingDailyQuota();
    if (remainingQuota <= 0) {
      return buildJsonResponse({
        ok: false,
        status: "QUOTA_EXCEEDED",
        error: "Google Apps Script MailApp daily sending quota is exhausted (0 remaining).",
        remainingDailyQuota: 0,
        timestamp: nowIso
      });
    }

    var senderName = String(payload.senderName || props.getProperty("SENDER_NAME") || DEFAULT_SENDER_NAME).trim();
    var replyTo = String(payload.replyTo || props.getProperty("REPLY_TO_EMAIL") || DEFAULT_REPLY_TO).trim();

    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      body: textBody || stripHtml(htmlBody),
      htmlBody: htmlBody || undefined,
      name: senderName,
      replyTo: replyTo
    });

    var generatedMessageId = "gas-" + (orderNumber || eventType.toLowerCase()) + "-" + new Date().getTime();

    if (cacheKey) {
      try {
        cache.put(cacheKey, generatedMessageId, IDEMPOTENCY_TTL_SECONDS);
      } catch (cacheErr) {
        // Non-fatal cache write warning
      }
    }

    return buildJsonResponse({
      ok: true,
      status: "SENT",
      deduplicated: false,
      provider: "google_apps_script",
      messageId: generatedMessageId,
      recipient: recipient,
      orderNumber: orderNumber || null,
      remainingDailyQuota: remainingQuota - 1,
      timestamp: nowIso
    });
  } catch (err) {
    var errMsg = err && err.message ? String(err.message) : "Unexpected Google Apps Script exception.";
    return buildJsonResponse({
      ok: false,
      status: "FAILED",
      provider: "google_apps_script",
      error: errMsg,
      timestamp: nowIso
    });
  }
}

/**
 * Formats a JSON response using ContentService.
 */
function buildJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 */
function timingSafeEqual(a, b) {
  var strA = String(a || "");
  var strB = String(b || "");
  if (strA.length !== strB.length) {
    return false;
  }
  var mismatch = 0;
  for (var i = 0; i < strA.length; i++) {
    mismatch |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Computes lowercase hexadecimal HMAC-SHA256 digest.
 */
function computeHmacHex(message, secret) {
  var rawBytes = Utilities.computeHmacSha256Signature(message, secret);
  var hex = "";
  for (var i = 0; i < rawBytes.length; i++) {
    var b = (rawBytes[i] + 256) % 256;
    var h = b.toString(16);
    hex += h.length === 1 ? "0" + h : h;
  }
  return hex;
}

/**
 * Validates standard email format.
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());
}

/**
 * Fallback HTML tag stripper if plain text body is omitted.
 */
function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

