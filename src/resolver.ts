import { createHash } from "node:crypto";
import type { FetchLike, GrantResult } from "./types.js";
import type { IdpProvider } from "./idp/types.js";
import type { TokenStore } from "./store/types.js";
import { clientCredentials } from "./grants/clientCredentials.js";
import { tokenExchange, type SubjectTokenType } from "./grants/tokenExchange.js";

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

  function keyFor(req: ResolveRequest): string {
    const audience = req.audience ?? "";
    const scope = req.scope ?? "";
    if (req.onBehalfOf) {
      const subHash = createHash("sha256").update(req.onBehalfOf.subjectToken).digest("hex").slice(0, 16);
      return JSON.stringify(["te", req.onBehalfOf.subjectTokenType, subHash, audience, scope]);
    }
    return JSON.stringify(["cc", audience, scope]);
  }

  async function grant(req: ResolveRequest): Promise<GrantResult> {
    const cfg = await deps.idp.resolve(deps.fetchImpl);
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
    const key = keyFor(req);
    const cached = await deps.store.get(key);
    if (cached) return cached;

    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const result = await grant(req);
      const ttl = Math.max((result.expiresIn ?? 300) - deps.refreshSkewSeconds, 1);
      await deps.store.set(key, result, ttl);
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
