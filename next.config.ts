import type { NextConfig } from "next";
import { resolveDeploymentId } from "./src/lib/config/deployment.ts";

const deploymentId = resolveDeploymentId();

const nextConfig: NextConfig = {
  /* config options here */
  deploymentId,
  experimental: {
    // Explicitly disable runtimeServerDeploymentId so Next.js embeds the deploymentId
    // directly into build artifacts and never requires process.env.NEXT_DEPLOYMENT_ID at runtime.
    runtimeServerDeploymentId: false,
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
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
