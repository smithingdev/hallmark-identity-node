import type { FetchLike } from "../types.js";
import { GrantError } from "../errors.js";
import type { IdpConfig, IdpProvider } from "./types.js";

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";

export function oidc(opts: {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint?: string;
}): IdpProvider {
  let cached: Promise<IdpConfig> | undefined;

  return {
    resolve(fetchImpl: FetchLike = fetch): Promise<IdpConfig> {
      if (!cached) {
        cached = discover(opts, fetchImpl).catch((err) => {
          cached = undefined;
          throw err;
        });
      }
      return cached;
    },
  };
}

async function discover(
  opts: { issuer: string; clientId: string; clientSecret?: string; tokenEndpoint?: string },
  fetchImpl: FetchLike,
): Promise<IdpConfig> {
  const issuer = opts.issuer.replace(/\/$/, "");
  const url = `${issuer}/.well-known/openid-configuration`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new GrantError(`OIDC discovery failed for ${issuer}`, res.status);
  }
  const doc = (await res.json()) as { token_endpoint?: string; grant_types_supported?: string[] };
  const tokenEndpoint = opts.tokenEndpoint ?? doc.token_endpoint;
  if (!tokenEndpoint) {
    throw new GrantError(`OIDC discovery for ${issuer} returned no token_endpoint`, res.status);
  }
  return {
    tokenEndpoint,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    supportsTokenExchange: (doc.grant_types_supported ?? []).includes(TOKEN_EXCHANGE_GRANT),
  };
}
