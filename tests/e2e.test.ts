import { describe, it, expect, vi } from "vitest";
import { createIdentity, oidc } from "../src/index.js";

const TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange";

// A tiny in-memory STS: answers discovery, client_credentials, and token-exchange.
function mockSts() {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/.well-known/openid-configuration")) {
      return new Response(
        JSON.stringify({ token_endpoint: "https://sts.example/token", grant_types_supported: ["client_credentials", TOKEN_EXCHANGE] }),
        { status: 200 },
      );
    }
    const body = new URLSearchParams(init!.body as string);
    if (body.get("grant_type") === TOKEN_EXCHANGE) {
      return new Response(JSON.stringify({ access_token: "OBO", expires_in: 120 }), { status: 200 });
    }
    return new Response(JSON.stringify({ access_token: "AGENT", expires_in: 300 }), { status: 200 });
  });
}

describe("end-to-end against a mock STS", () => {
  it("resolves both agent identity and on-behalf-of tokens through the public API", async () => {
    const f = mockSts();
    const identity = createIdentity({
      idp: oidc({ issuer: "https://sts.example", clientId: "agent", clientSecret: "s" }),
      fetch: f as never,
    });

    const agentToken = await identity.agent().token({ audience: "https://api.internal" });
    expect(agentToken.raw).toBe("AGENT");

    const oboToken = await identity.onBehalfOf("USER").token({ audience: "https://api.github.com", scopes: ["repo"] });
    expect(oboToken.raw).toBe("OBO");
  });
});
