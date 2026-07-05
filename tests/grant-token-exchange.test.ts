import { describe, it, expect, vi } from "vitest";
import { tokenExchange } from "../src/grants/tokenExchange.js";
import { TokenExchangeUnsupportedError } from "../src/errors.js";
import type { IdpConfig } from "../src/idp/types.js";

const base: IdpConfig = {
  tokenEndpoint: "https://idp.example/token",
  clientId: "agent",
  clientSecret: "secret",
  supportsTokenExchange: true,
};

describe("tokenExchange", () => {
  it("builds an RFC 8693 request with the correct grant type and URNs", async () => {
    const f = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init!.body as string);
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
      expect(body.get("subject_token")).toBe("USER");
      expect(body.get("subject_token_type")).toBe("urn:ietf:params:oauth:token-type:access_token");
      expect(body.get("actor_token")).toBe("AGENT");
      expect(body.get("actor_token_type")).toBe("urn:ietf:params:oauth:token-type:access_token");
      expect(body.get("audience")).toBe("https://api.github.com");
      expect(body.get("scope")).toBe("repo");
      return new Response(JSON.stringify({ access_token: "EXCHANGED", expires_in: 120 }), { status: 200 });
    });
    const result = await tokenExchange(
      base,
      { subjectToken: "USER", subjectTokenType: "access_token", actorToken: "AGENT", audience: "https://api.github.com", scope: "repo" },
      f as never,
    );
    expect(result.accessToken).toBe("EXCHANGED");
    expect(result.expiresIn).toBe(120);
  });

  it("maps a SAML2 subject token to the saml2 URN", async () => {
    const f = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init!.body as string);
      expect(body.get("subject_token_type")).toBe("urn:ietf:params:oauth:token-type:saml2");
      return new Response(JSON.stringify({ access_token: "X" }), { status: 200 });
    });
    await tokenExchange(base, { subjectToken: "<saml/>", subjectTokenType: "saml2" }, f as never);
    expect(f).toHaveBeenCalledOnce();
  });

  it("throws TokenExchangeUnsupportedError without calling the network when the IDP lacks support", async () => {
    const f = vi.fn();
    await expect(
      tokenExchange({ ...base, supportsTokenExchange: false, tokenEndpoint: "https://idp.example/token" }, { subjectToken: "U", subjectTokenType: "access_token" }, f as never),
    ).rejects.toBeInstanceOf(TokenExchangeUnsupportedError);
    expect(f).not.toHaveBeenCalled();
  });
});
