import type { FetchLike, GrantResult } from "../types.js";
import type { IdpConfig } from "../idp/types.js";
import { postForm } from "./http.js";

export async function clientCredentials(
  cfg: IdpConfig,
  params: { audience?: string; scope?: string },
  fetchImpl: FetchLike = fetch,
): Promise<GrantResult> {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId });
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
  if (params.audience) body.set("audience", params.audience);
  if (params.scope) body.set("scope", params.scope);
  return postForm(cfg.tokenEndpoint, body, fetchImpl);
}
