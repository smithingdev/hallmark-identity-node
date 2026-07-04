import { describe, it, expect, vi } from "vitest";
import { keycloak } from "../src/idp/keycloak.js";

describe("keycloak adapter", () => {
  it("builds the realm issuer and discovers its token endpoint", async () => {
    const f = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://kc.example/realms/agents/.well-known/openid-configuration");
      return new Response(
        JSON.stringify({ token_endpoint: "https://kc.example/realms/agents/protocol/openid-connect/token", grant_types_supported: [] }),
        { status: 200 },
      );
    });
    const cfg = await keycloak({ baseUrl: "https://kc.example/", realm: "agents", clientId: "agent" }).resolve(f as never);
    expect(cfg.tokenEndpoint).toBe("https://kc.example/realms/agents/protocol/openid-connect/token");
  });
});
