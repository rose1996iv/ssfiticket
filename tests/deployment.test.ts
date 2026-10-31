import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDeploymentId, isValidFlightRouterState } from "../src/lib/config/deployment.ts";

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

  it("validates well-formed FlightRouterState header", () => {
    const validTree = encodeURIComponent(
      JSON.stringify(["", { children: ["buy", {}] }, null, null, true])
    );
    assert.equal(isValidFlightRouterState(validTree), true);
  });

  it("rejects malformed URI encoding in next-router-state-tree", () => {
    const malformedUri = "%E0%A4%A"; // Invalid UTF-8 sequence for decodeURIComponent
    assert.equal(isValidFlightRouterState(malformedUri), false);
  });

  it("rejects invalid JSON in next-router-state-tree", () => {
    const invalidJson = encodeURIComponent("{unclosed_json: true");
    assert.equal(isValidFlightRouterState(invalidJson), false);
  });

  it("rejects non-array or truncated state in next-router-state-tree", () => {
    const nonArray = encodeURIComponent(JSON.stringify({ notAnArray: true }));
    assert.equal(isValidFlightRouterState(nonArray), false);

    const emptyArray = encodeURIComponent(JSON.stringify([]));
    assert.equal(isValidFlightRouterState(emptyArray), false);

    const oneElem = encodeURIComponent(JSON.stringify(["root"]));
    assert.equal(isValidFlightRouterState(oneElem), false);
  });

  it("rejects null, undefined, or empty router state headers", () => {
    assert.equal(isValidFlightRouterState(null), false);
    assert.equal(isValidFlightRouterState(undefined), false);
    assert.equal(isValidFlightRouterState(""), false);
  });
});
