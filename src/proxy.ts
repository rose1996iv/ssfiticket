import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveDeploymentId, isValidFlightRouterState } from "@/lib/config/deployment";

const currentDeploymentId = resolveDeploymentId();

/**
 * Next.js 16 Proxy Convention
 * Protects against App Router Flight router-state-tree parsing failures
 * and cross-deployment version skew.
 */
export function proxy(request: NextRequest) {
  const routerStateHeader = request.headers.get("next-router-state-tree");

  if (routerStateHeader) {
    let shouldStripHeader = false;

    // 1. Check for unparseable, malformed, or corrupted router state header
    if (!isValidFlightRouterState(routerStateHeader)) {
      shouldStripHeader = true;
    }

    // 2. Check for cross-deployment version skew:
    // If the client identified itself with an older deploymentId, strip the old router state tree
    // so the server renders a fresh route payload instead of throwing an incompatible tree error.
    if (!shouldStripHeader && currentDeploymentId) {
      const clientDeploymentId = request.headers.get("x-deployment-id");
      if (clientDeploymentId && clientDeploymentId !== currentDeploymentId) {
        shouldStripHeader = true;
      }
    }

    if (shouldStripHeader) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.delete("next-router-state-tree");
      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    }
  }

  return NextResponse.next();
}

// Export default and named proxy to support all Next.js conventions
export default proxy;

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static assets)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon)
     * - static image/asset extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
