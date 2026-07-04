import { describe, it, expect, vi } from "vitest";
import { createIdentity } from "../src/identity.js";
import type { IdpProvider } from "../src/idp/types.js";

const idp: IdpProvider = {
  async resolve() {
    return { tokenEndpoint: "https://idp.example/token", clientId: "agent", clientSecret: "s", supportsTokenExchange: true };
  },
};

function tokenResponse(access: string, expiresIn = 300) {
  return new Response(JSON.stringify({ access_token: access, expires_in: expiresIn }), { status: 200 });
}

describe("createIdentity", () => {
  it("agent().token() runs client-credentials and caches the result", async () => {
    const f = vi.fn(async () => tokenResponse("AGENT_AT"));
    const identity = createIdentity({ idp, fetch: f as never });
    const first = await identity.agent().token({ audience: "https://api.internal" });
    const second = await identity.agent().token({ audience: "https://api.internal" });
    expect(first.raw).toBe("AGENT_AT");
    expect(second.raw).toBe("AGENT_AT");
    expect(f).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it("onBehalfOf().token() runs a token exchange", async () => {
    const f = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init!.body as string);
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
      expect(body.get("subject_token")).toBe("USER_TOKEN");
      return tokenResponse("OBO_AT", 120);
    });
    const identity = createIdentity({ idp, fetch: f as never });
    const t = await identity.onBehalfOf("USER_TOKEN").token({ audience: "https://api.github.com", scopes: ["repo"] });
    expect(t.raw).toBe("OBO_AT");
  });

  it("dedupes concurrent identical requests into a single grant (single-flight)", async () => {
    const f = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return tokenResponse("AGENT_AT");
    });
    const identity = createIdentity({ idp, fetch: f as never });
    const [a, b] = await Promise.all([identity.agent().token(), identity.agent().token()]);
    expect(a.raw).toBe("AGENT_AT");
    expect(b.raw).toBe("AGENT_AT");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("distinguishes cache entries by audience and scopes", async () => {
    const f = vi.fn(async () => tokenResponse("AT"));
    const identity = createIdentity({ idp, fetch: f as never });
    await identity.agent().token({ audience: "a" });
    await identity.agent().token({ audience: "b" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("distinguishes cache entries by scopes", async () => {
    const f = vi.fn(async () => tokenResponse("AT"));
    const identity = createIdentity({ idp, fetch: f as never });
    await identity.agent().token({ audience: "a", scopes: ["read"] });
    await identity.agent().token({ audience: "a", scopes: ["write"] });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does not collide cache keys between different (audience, scope) pairs that share characters", async () => {
    const f = vi.fn(async () => tokenResponse("AT"));
    const identity = createIdentity({ idp, fetch: f as never });
    await identity.agent().token({ audience: "https://api.example.com", scopes: ["user:email"] });
    await identity.agent().token({ audience: "https://api.example.com:user", scopes: ["email"] });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
