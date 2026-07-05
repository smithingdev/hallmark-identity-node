import { oidc } from "./oidc.js";
import type { IdpProvider } from "./types.js";

export function keycloak(opts: {
  baseUrl: string;
  realm: string;
  clientId: string;
  clientSecret?: string;
}): IdpProvider {
  const base = opts.baseUrl.replace(/\/$/, "");
  return oidc({
    issuer: `${base}/realms/${opts.realm}`,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
  });
}
