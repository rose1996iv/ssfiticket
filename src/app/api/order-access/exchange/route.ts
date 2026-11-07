import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getOrderCookieName,
  getOrderCookieOptions,
  isValidAccessTokenFormat,
  verifyOrderPaymentAccess,
} from "@/lib/security/orderAccessToken";
import { checkOrderAccessRateLimit, getClientIpFromHeaders } from "@/lib/security/rateLimit";

const querySchema = z.object({
  orderId: z.string().uuid("Invalid order ID format."),
  token: z.string().trim(),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawOrderId = searchParams.get("orderId");
  const rawToken = searchParams.get("token");

  const parsed = querySchema.safeParse({
    orderId: rawOrderId,
    token: rawToken,
  });

  if (!parsed.success) {
    const errorRedirectUrl = new URL("/buy", request.url);
    errorRedirectUrl.searchParams.set("error", "invalid_request");
    return NextResponse.redirect(errorRedirectUrl, {
      status: 303,
      headers: {
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  const { orderId, token } = parsed.data;

  if (!isValidAccessTokenFormat(token)) {
    const errorRedirectUrl = new URL(`/buy/order/${orderId}`, request.url);
    errorRedirectUrl.searchParams.set("error", "invalid_token");
    return NextResponse.redirect(errorRedirectUrl, {
      status: 303,
      headers: {
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  // 1. Rate limiting check
  const clientIp = getClientIpFromHeaders(request.headers);
  const rateLimit = await checkOrderAccessRateLimit({
    orderId,
    clientIp,
  });

  if (!rateLimit.allowed) {
    const errorRedirectUrl = new URL(`/buy/order/${orderId}`, request.url);
    errorRedirectUrl.searchParams.set("error", "rate_limited");
    return NextResponse.redirect(errorRedirectUrl, {
      status: 303,
      headers: {
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  // 2. Token verification
  const verification = await verifyOrderPaymentAccess(orderId, token, "READ");

  if (!verification.authorized) {
    const errorCode = (verification.code || "unauthorized").toLowerCase();
    const errorRedirectUrl = new URL(`/buy/order/${orderId}`, request.url);
    errorRedirectUrl.searchParams.set("error", errorCode);
    return NextResponse.redirect(errorRedirectUrl, {
      status: 303,
      headers: {
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  // 3. Authorized — Set HttpOnly cookie and 303 redirect to clean order URL (no token in URL)
  const cleanRedirectUrl = new URL(`/buy/order/${orderId}`, request.url);
  const response = NextResponse.redirect(cleanRedirectUrl, {
    status: 303,
    headers: {
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });

  const cookieName = getOrderCookieName(orderId);
  const cookieOptions = getOrderCookieOptions();
  response.cookies.set(cookieName, token.trim().toLowerCase(), cookieOptions);

  return response;
}

