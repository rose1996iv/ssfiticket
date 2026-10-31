import type { NextConfig } from "next";
import { resolveDeploymentId } from "./src/lib/config/deployment";

const deploymentId = resolveDeploymentId();

// Sync process.env.NEXT_DEPLOYMENT_ID so Next.js build-time validation matches deploymentId
if (deploymentId) {
  process.env.NEXT_DEPLOYMENT_ID = deploymentId;
}

const nextConfig: NextConfig = {
  /* config options here */
  deploymentId,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
