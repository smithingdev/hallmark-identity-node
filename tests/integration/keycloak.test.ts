import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { createIdentity, keycloak } from "../../src/index.js";

// Assumes a Keycloak reachable at KC_URL with a realm "agents", a confidential
// client "agent" (client-credentials + token-exchange enabled), and env vars set.
// See tests/integration/README.md for a one-line `docker run` to start one.
const KC_URL = process.env.KC_URL;
const CLIENT_SECRET = process.env.KC_CLIENT_SECRET;

describe.skipIf(!KC_URL || !CLIENT_SECRET)("keycloak integration", () => {
  beforeAll(() => {
    // Fail fast with a clear message if Keycloak isn't reachable.
    execSync(`curl -sf ${KC_URL}/realms/agents/.well-known/openid-configuration > /dev/null`);
  });

  it("acquires the agent's own token via client-credentials", async () => {
    const identity = createIdentity({
      idp: keycloak({ baseUrl: KC_URL!, realm: "agents", clientId: "agent", clientSecret: CLIENT_SECRET }),
    });
    const token = await identity.agent().token();
    expect(token.raw.length).toBeGreaterThan(10);
    expect(token.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
