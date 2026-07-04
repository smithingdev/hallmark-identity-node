import { describe, it, expect } from "vitest";
import { HallmarkError, GrantError, TokenExchangeUnsupportedError } from "../src/errors.js";

describe("errors", () => {
  it("GrantError carries status, oauth error, and code", () => {
    const e = new GrantError("bad", 400, "invalid_grant");
    expect(e).toBeInstanceOf(HallmarkError);
    expect(e.status).toBe(400);
    expect(e.oauthError).toBe("invalid_grant");
    expect(e.code).toBe("grant_failed");
    expect(e.name).toBe("GrantError");
  });

  it("TokenExchangeUnsupportedError names the issuer", () => {
    const e = new TokenExchangeUnsupportedError("https://idp.example");
    expect(e.issuer).toBe("https://idp.example");
    expect(e.code).toBe("token_exchange_unsupported");
    expect(e.message).toContain("https://idp.example");
  });
});
