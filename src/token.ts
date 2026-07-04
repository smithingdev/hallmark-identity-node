export interface Token {
  raw: string;
  sub?: string;
  act?: { sub?: string };
  aud?: string | string[];
  scope?: string;
  exp?: number; // epoch seconds
}

export function parseToken(raw: string): Token {
  const parts = raw.split(".");
  if (parts.length < 2) return { raw };
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const claims = JSON.parse(json) as Record<string, unknown>;
    return {
      raw,
      sub: typeof claims.sub === "string" ? claims.sub : undefined,
      act: isActClaim(claims.act) ? { sub: typeof claims.act.sub === "string" ? claims.act.sub : undefined } : undefined,
      aud: isAudClaim(claims.aud) ? claims.aud : undefined,
      scope: typeof claims.scope === "string" ? claims.scope : undefined,
      exp: typeof claims.exp === "number" ? claims.exp : undefined,
    };
  } catch {
    return { raw };
  }
}

function isActClaim(v: unknown): v is { sub?: string } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isAudClaim(v: unknown): v is string | string[] {
  if (typeof v === "string") return true;
  if (Array.isArray(v) && v.every(el => typeof el === "string")) return true;
  return false;
}

export function isExpired(token: Token, skewSeconds = 30, nowMs = Date.now()): boolean {
  if (token.exp === undefined) return false;
  return token.exp - skewSeconds <= Math.floor(nowMs / 1000);
}

export function willExpireWithin(token: Token, ms: number, nowMs = Date.now()): boolean {
  if (token.exp === undefined) return false;
  return token.exp * 1000 <= nowMs + ms;
}
