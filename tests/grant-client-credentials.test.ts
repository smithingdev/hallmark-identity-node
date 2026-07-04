import { describe, it, expect, vi } from "vitest";
import { clientCredentials } from "../src/grants/clientCredentials.js";
import { GrantError } from "../src/errors.js";
import type { IdpConfig } from "../src/idp/types.js";

const cfg: IdpConfig = {
  tokenEndpoint: "https://idp.example/token",
  clientId: "agent",
  clientSecret: "secret",
  supportsTokenExchange: true,
};

describe("clientCredentials", () => {
  it("posts the client_credentials grant and parses the result", async () => {
    const f = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init!.body as string);
      expect(body.get("grant_type")).toBe("client_credentials");
      expect(body.get("client_id")).toBe("agent");
      expect(body.get("client_secret")).toBe("secret");
      expect(body.get("audience")).toBe("https://api.internal");
      expect(body.get("scope")).toBe("read");
      return new Response(JSON.stringify({ access_token: "AT", expires_in: 300, token_type: "Bearer" }), { status: 200 });
    });
    const result = await clientCredentials(cfg, { audience: "https://api.internal", scope: "read" }, f as never);
    expect(result).toEqual({ accessToken: "AT", expiresIn: 300, scope: undefined, tokenType: "Bearer", issuedTokenType: undefined });
  });

  it("throws GrantError with the OAuth error code on failure", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }));
    await expect(clientCredentials(cfg, {}, f as never)).rejects.toMatchObject({
      constructor: GrantError,
      status: 401,
      oauthError: "invalid_client",
    });
  });
});
