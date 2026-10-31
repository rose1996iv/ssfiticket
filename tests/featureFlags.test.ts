import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isFeatureEnabled, getAllFeatureFlags } from "../src/lib/config/featureFlags.ts";

describe("Feature Flags Architecture", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FEATURE_ENABLE_LIVE_PAYMENT_GATEWAY;
    delete process.env.NEXT_PUBLIC_FEATURE_ENABLE_LIVE_PAYMENT_GATEWAY;
    delete process.env.FEATURE_ENABLE_WHATSAPP_CLOUD_API;
    delete process.env.NEXT_PUBLIC_FEATURE_ENABLE_WHATSAPP_CLOUD_API;
    delete process.env.FEATURE_ENABLE_DETAILED_AUDIT_EXPORT;
    delete process.env.NEXT_PUBLIC_FEATURE_ENABLE_DETAILED_AUDIT_EXPORT;
    delete process.env.FEATURE_ENABLE_SELLER_SELF_REGISTRATION;
    delete process.env.NEXT_PUBLIC_FEATURE_ENABLE_SELLER_SELF_REGISTRATION;
    delete process.env.FEATURE_ENABLE_MAINTENANCE_MODE;
    delete process.env.NEXT_PUBLIC_FEATURE_ENABLE_MAINTENANCE_MODE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should default to the approved baseline configuration", () => {
    assert.strictEqual(
      isFeatureEnabled("ENABLE_LIVE_PAYMENT_GATEWAY"),
      false,
      "Live payment gateway should default to false (Manual UPI active)"
    );
    assert.strictEqual(
      isFeatureEnabled("ENABLE_WHATSAPP_CLOUD_API"),
      false,
      "WhatsApp Cloud API should default to false (Click-to-chat active)"
    );
    assert.strictEqual(
      isFeatureEnabled("ENABLE_DETAILED_AUDIT_EXPORT"),
      true,
      "Audit export should default to true"
    );
    assert.strictEqual(
      isFeatureEnabled("ENABLE_SELLER_SELF_REGISTRATION"),
      false,
      "Seller self-registration should default to false"
    );
    assert.strictEqual(
      isFeatureEnabled("ENABLE_MAINTENANCE_MODE"),
      false,
      "Maintenance mode should default to false"
    );
  });

  it("should permit overriding flags via server environment variable", () => {
    process.env.FEATURE_ENABLE_LIVE_PAYMENT_GATEWAY = "true";
    assert.strictEqual(isFeatureEnabled("ENABLE_LIVE_PAYMENT_GATEWAY"), true);

    process.env.FEATURE_ENABLE_MAINTENANCE_MODE = "1";
    assert.strictEqual(isFeatureEnabled("ENABLE_MAINTENANCE_MODE"), true);
  });

  it("should permit overriding flags via client NEXT_PUBLIC environment variable", () => {
    process.env.NEXT_PUBLIC_FEATURE_ENABLE_WHATSAPP_CLOUD_API = "true";
    assert.strictEqual(isFeatureEnabled("ENABLE_WHATSAPP_CLOUD_API"), true);
  });

  it("should safely return read-only snapshot of all flags", () => {
    const flags = getAllFeatureFlags();
    assert.strictEqual(typeof flags, "object");
    assert.strictEqual(flags.ENABLE_LIVE_PAYMENT_GATEWAY, false);
    assert.strictEqual(flags.ENABLE_DETAILED_AUDIT_EXPORT, true);
    assert.throws(() => {
      // @ts-expect-error Testing immutability
      flags.ENABLE_LIVE_PAYMENT_GATEWAY = true;
    }, /Cannot assign to read only property/);
  });
});
