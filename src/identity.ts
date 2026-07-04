import type { FetchLike } from "./types.js";
import { parseToken } from "./token.js";
import type { Token } from "./token.js";
import type { IdpProvider } from "./idp/types.js";
import type { TokenStore } from "./store/types.js";
import { memoryStore } from "./store/memory.js";
import type { SubjectTokenType } from "./grants/tokenExchange.js";
import { createResolver } from "./resolver.js";

export interface TokenRequest {
  audience?: string;
  scopes?: string[];
}

export interface CreateIdentityOptions {
  idp: IdpProvider;
  store?: TokenStore;
  refreshSkewSeconds?: number;
  fetch?: FetchLike;
}

export interface Identity {
  agent(): { token(req?: TokenRequest): Promise<Token> };
  onBehalfOf(subjectToken: string, opts?: { type?: SubjectTokenType }): { token(req?: TokenRequest): Promise<Token> };
}

export function createIdentity(options: CreateIdentityOptions): Identity {
  const resolve = createResolver({
    idp: options.idp,
    store: options.store ?? memoryStore(),
    refreshSkewSeconds: options.refreshSkewSeconds ?? 30,
    fetchImpl: options.fetch ?? fetch,
  });

  const scopeOf = (req?: TokenRequest) => (req?.scopes && req.scopes.length ? req.scopes.join(" ") : undefined);

  return {
    agent() {
      return {
        async token(req?: TokenRequest): Promise<Token> {
          const result = await resolve({ audience: req?.audience, scope: scopeOf(req) });
          return parseToken(result.accessToken);
        },
      };
    },
    onBehalfOf(subjectToken: string, opts?: { type?: SubjectTokenType }) {
      const subjectTokenType: SubjectTokenType = opts?.type ?? "access_token";
      return {
        async token(req?: TokenRequest): Promise<Token> {
          const result = await resolve({
            audience: req?.audience,
            scope: scopeOf(req),
            onBehalfOf: { subjectToken, subjectTokenType },
          });
          return parseToken(result.accessToken);
        },
      };
    },
  };
}
