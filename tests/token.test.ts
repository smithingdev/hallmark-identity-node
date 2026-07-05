import { describe, it, expect } from "vitest";
import { parseToken, isExpired, willExpireWithin } from "../src/token.js";

// Helper: build an unsigned JWT with the given payload (signature ignored — we never verify).
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.`;
}

describe("parseToken", () => {
  it("decodes sub, act, aud, scope, exp from a JWT", () => {
    const t = parseToken(jwt({ sub: "user-1", act: { sub: "agent-1" }, aud: "api", scope: "repo", exp: 1000 }));
    expect(t.sub).toBe("user-1");
    expect(t.act?.sub).toBe("agent-1");
    expect(t.aud).toBe("api");
    expect(t.scope).toBe("repo");
    expect(t.exp).toBe(1000);
    expect(t.raw).toContain(".");
  });

  it("returns only raw for an opaque (non-JWT) token", () => {
    const t = parseToken("opaque-token-value");
    expect(t.raw).toBe("opaque-token-value");
    expect(t.sub).toBeUndefined();
    expect(t.exp).toBeUndefined();
  });

  it("handles malformed payload gracefully by returning only raw", () => {
    const t = parseToken("aaa.@@@not-json@@@.bbb");
    expect(t.raw).toBe("aaa.@@@not-json@@@.bbb");
    expect(t.sub).toBeUndefined();
    expect(t.exp).toBeUndefined();
  });

  it("rejects non-string act.sub", () => {
    const t = parseToken(jwt({ act: { sub: 123 } }));
    expect(t.act?.sub).toBeUndefined();
  });

  it("rejects non-string/non-string-array aud", () => {
    const t = parseToken(jwt({ aud: 42 }));
    expect(t.aud).toBeUndefined();
  });
});

describe("isExpired / willExpireWithin", () => {
  const nowMs = 1_000_000; // → 1000 epoch seconds
  it("isExpired is true when exp is within the skew window", () => {
    expect(isExpired(parseToken(jwt({ exp: 1010 })), 30, nowMs)).toBe(true); // 1010 - 30 <= 1000
    expect(isExpired(parseToken(jwt({ exp: 1040 })), 30, nowMs)).toBe(false);
  });
  it("tokens without exp are never considered expired", () => {
    expect(isExpired(parseToken("opaque"), 30, nowMs)).toBe(false);
  });
  it("willExpireWithin looks ahead by the given ms", () => {
    expect(willExpireWithin(parseToken(jwt({ exp: 1005 })), 10_000, nowMs)).toBe(true); // expires in 5s
    expect(willExpireWithin(parseToken(jwt({ exp: 2000 })), 10_000, nowMs)).toBe(false);
  });
});
