import { describe, it, expect, vi } from "vitest";
import { oidc } from "../src/idp/oidc.js";

const TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange";

function discoveryFetch(doc: Record<string, unknown>) {
  return vi.fn(async (url: string | URL) => {
    expect(String(url)).toBe("https://idp.example/.well-known/openid-configuration");
    return new Response(JSON.stringify(doc), { status: 200 });
  });
}

describe("oidc adapter", () => {
  it("discovers the token endpoint and detects token-exchange support", async () => {
    const f = discoveryFetch({
      token_endpoint: "https://idp.example/token",
      grant_types_supported: ["client_credentials", TOKEN_EXCHANGE],
    });
    const cfg = await oidc({ issuer: "https://idp.example/", clientId: "agent", clientSecret: "s" }).resolve(f as never);
    expect(cfg.tokenEndpoint).toBe("https://idp.example/token");
    expect(cfg.supportsTokenExchange).toBe(true);
    expect(cfg.clientId).toBe("agent");
  });

  it("caches discovery — resolve twice hits the network once", async () => {
    const f = discoveryFetch({ token_endpoint: "https://idp.example/token", grant_types_supported: [] });
    const provider = oidc({ issuer: "https://idp.example", clientId: "agent" });
    await provider.resolve(f as never);
    const cfg = await provider.resolve(f as never);
    expect(f).toHaveBeenCalledTimes(1);
    expect(cfg.supportsTokenExchange).toBe(false);
  });
});
