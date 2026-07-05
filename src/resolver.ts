import { createHash } from "node:crypto";
import type { FetchLike, GrantResult } from "./types.js";
import type { IdpProvider, IdpConfig } from "./idp/types.js";
import type { TokenStore } from "./store/types.js";
import { clientCredentials } from "./grants/clientCredentials.js";
import { tokenExchange, type SubjectTokenType } from "./grants/tokenExchange.js";
import { parseToken, isExpired } from "./token.js";

export interface ResolveRequest {
  audience?: string;
  scope?: string;
  onBehalfOf?: { subjectToken: string; subjectTokenType: SubjectTokenType };
}

export interface ResolverDeps {
  idp: IdpProvider;
  store: TokenStore;
  refreshSkewSeconds: number;
  fetchImpl: FetchLike;
}

export function createResolver(deps: ResolverDeps) {
  const inflight = new Map<string, Promise<GrantResult>>();

  function keyFor(cfg: IdpConfig, req: ResolveRequest): string {
    const audience = req.audience ?? "";
    const scope = req.scope ?? "";
    if (req.onBehalfOf) {
      const subHash = createHash("sha256").update(req.onBehalfOf.subjectToken).digest("hex");
      return JSON.stringify(["te", cfg.tokenEndpoint, cfg.clientId, req.onBehalfOf.subjectTokenType, subHash, audience, scope]);
    }
    return JSON.stringify(["cc", cfg.tokenEndpoint, cfg.clientId, audience, scope]);
  }

  async function grant(cfg: IdpConfig, req: ResolveRequest): Promise<GrantResult> {
    if (req.onBehalfOf) {
      return tokenExchange(
        cfg,
        {
          subjectToken: req.onBehalfOf.subjectToken,
          subjectTokenType: req.onBehalfOf.subjectTokenType,
          audience: req.audience,
          scope: req.scope,
        },
        deps.fetchImpl,
      );
    }
    return clientCredentials(cfg, { audience: req.audience, scope: req.scope }, deps.fetchImpl);
  }

  return async function resolve(req: ResolveRequest): Promise<GrantResult> {
    const cfg = await deps.idp.resolve(deps.fetchImpl);
    const key = keyFor(cfg, req);
    const cached = await deps.store.get(key);
    if (cached && !isExpired(parseToken(cached.accessToken), deps.refreshSkewSeconds)) return cached;

    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const result = await grant(cfg, req);
      const ttl = ttlFor(result, deps.refreshSkewSeconds, Date.now());
      try {
        await deps.store.set(key, result, ttl);
      } catch {
        // best-effort: a cache-write failure must not fail a call whose token was already minted
      }
      return result;
    })();

    inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(key);
    }
  };
}

function ttlFor(result: GrantResult, skewSeconds: number, nowMs: number): number {
  const nowSec = Math.floor(nowMs / 1000);
  const candidates: number[] = [];
  if (typeof result.expiresIn === "number") candidates.push(result.expiresIn - skewSeconds);
  const exp = parseToken(result.accessToken).exp;
  if (typeof exp === "number") candidates.push(exp - nowSec - skewSeconds);
  if (candidates.length === 0) candidates.push(300 - skewSeconds);
  return Math.max(Math.min(...candidates), 1);
}
