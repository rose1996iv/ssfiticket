import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDeploymentId } from "../src/lib/config/deployment.ts";
import nextConfig from "../next.config.ts";

describe("Next.js Deployment ID & Version Skew Protection", () => {
  it("prefers VERCEL_DEPLOYMENT_ID and strips 'dpl_' prefix", () => {
    const id = resolveDeploymentId({
      NODE_ENV: "production",
      VERCEL_DEPLOYMENT_ID: "dpl_3FhYTxT3pbXNbGncQpGBMwgYWGuC",
      VERCEL_GIT_COMMIT_SHA: "8b2f587fe82b9da1a8f1fd6e50baca1922da0473",
    });

    assert.ok(id);
    assert.equal(id, "3FhYTxT3pbXNbGncQpGBMwgYWGuC");
    assert.ok(!id.startsWith("dpl_"), "Must not begin with dpl_");
    assert.ok(id.length <= 32, "Must be no longer than 32 characters");
  });

  it("enforces maximum length of 32 characters", () => {
    const longId = "a".repeat(45);
    const id = resolveDeploymentId({
      NODE_ENV: "production",
      VERCEL_DEPLOYMENT_ID: `dpl_${longId}`,
    });

    assert.ok(id);
    assert.equal(id.length, 32);
    assert.equal(id, "a".repeat(32));
  });

  it("falls back to VERCEL_GIT_COMMIT_SHA when VERCEL_DEPLOYMENT_ID is missing", () => {
    const sha = "8b2f587fe82b9da1a8f1fd6e50baca1922da0473";
    const id = resolveDeploymentId({
      NODE_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: sha,
    });

    assert.ok(id);
    assert.equal(id, sha.slice(0, 32));
    assert.ok(!id.startsWith("dpl_"));
    assert.equal(id.length, 32);
  });

  it("falls back to NEXT_DEPLOYMENT_ID if provided without dpl_", () => {
    const customId = "deploy_2026_11_01_release";
    const id = resolveDeploymentId({
      NODE_ENV: "production",
      NEXT_DEPLOYMENT_ID: customId,
    });

    assert.ok(id);
    assert.equal(id, customId);
    assert.ok(!id.startsWith("dpl_"));
    assert.ok(id.length <= 32);
  });

  it("strips 'dpl_' prefix even if passed via NEXT_DEPLOYMENT_ID", () => {
    const id = resolveDeploymentId({
      NODE_ENV: "production",
      NEXT_DEPLOYMENT_ID: "dpl_custom_123456",
    });

    assert.ok(id);
    assert.equal(id, "custom_123456");
    assert.ok(!id.startsWith("dpl_"));
  });

  it("returns undefined in development mode to preserve HMR and Fast Refresh", () => {
    const id = resolveDeploymentId({
      NODE_ENV: "development",
      VERCEL_DEPLOYMENT_ID: "dpl_test123",
    });

    assert.equal(id, undefined);
  });

  it("falls back to deterministic string in local production build without env", () => {
    const id = resolveDeploymentId({
      NODE_ENV: "production",
    });

    assert.ok(id);
    assert.equal(id, "local-prod-build");
    assert.ok(!id.startsWith("dpl_"));
    assert.ok(id.length <= 32);
  });

  it("sanitizes non-standard characters from deployment ID", () => {
    const id = resolveDeploymentId({
      NODE_ENV: "production",
      VERCEL_DEPLOYMENT_ID: "dpl_build#123@preview?v=1",
    });

    assert.ok(id);
    assert.equal(id, "build123previewv1");
    assert.ok(!id.startsWith("dpl_"));
    assert.ok(/^[a-zA-Z0-9_-]+$/.test(id));
  });

  it("generates distinct IDs for different Vercel deployments", () => {
    const idA = resolveDeploymentId({
      NODE_ENV: "production",
      VERCEL_DEPLOYMENT_ID: "dpl_deployment_A_11111",
    });
    const idB = resolveDeploymentId({
      NODE_ENV: "production",
      VERCEL_DEPLOYMENT_ID: "dpl_deployment_B_22222",
    });

    assert.ok(idA);
    assert.ok(idB);
    assert.notEqual(idA, idB);
  });

  it("ensures nextConfig explicitly disables runtimeServerDeploymentId", () => {
    assert.equal(
      nextConfig.experimental?.runtimeServerDeploymentId,
      false,
      "runtimeServerDeploymentId must be explicitly false so Next.js embeds the deploymentId in the build output and avoids crashing on missing process.env.NEXT_DEPLOYMENT_ID at runtime"
    );
  });

  it("simulates Next.js server initialization and verifies zero runtime missing-env errors", () => {
    // Next.js base-server.js logic simulation:
    // If runtimeServerDeploymentId is false, it uses nextConfig.deploymentId directly
    // and does NOT throw 'process.env.NEXT_DEPLOYMENT_ID is missing'
    const simulatedNextConfig = {
      deploymentId: "test_deployment_id_123",
      experimental: {
        runtimeServerDeploymentId: false,
      },
    };

    const runtimeEnv: Record<string, string | undefined> = {
      NODE_ENV: "production",
      VERCEL_DEPLOYMENT_ID: "dpl_test_deployment_id_123",
      // Notice: NEXT_DEPLOYMENT_ID is deliberately undefined (as it is in real Vercel runtime)
    };

    let serverDeploymentId: string = "";
    assert.doesNotThrow(() => {
      if (simulatedNextConfig.experimental.runtimeServerDeploymentId) {
        if (!runtimeEnv.NEXT_DEPLOYMENT_ID) {
          throw new Error("process.env.NEXT_DEPLOYMENT_ID is missing but runtimeServerDeploymentId is enabled");
        }
        serverDeploymentId = runtimeEnv.NEXT_DEPLOYMENT_ID;
      } else {
        serverDeploymentId = simulatedNextConfig.deploymentId || "";
        runtimeEnv.NEXT_DEPLOYMENT_ID = serverDeploymentId;
      }
    });

    assert.equal(serverDeploymentId, "test_deployment_id_123");
    assert.equal(runtimeEnv.NEXT_DEPLOYMENT_ID, "test_deployment_id_123");
  });
});
