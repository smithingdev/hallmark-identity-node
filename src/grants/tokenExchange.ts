import type { FetchLike, GrantResult } from "../types.js";
import type { IdpConfig } from "../idp/types.js";
import { TokenExchangeUnsupportedError } from "../errors.js";
import { postForm } from "./http.js";

export type SubjectTokenType = "access_token" | "id_token" | "jwt" | "saml2";

const SUBJECT_TOKEN_TYPE_URNS: Record<SubjectTokenType, string> = {
  access_token: "urn:ietf:params:oauth:token-type:access_token",
  id_token: "urn:ietf:params:oauth:token-type:id_token",
  jwt: "urn:ietf:params:oauth:token-type:jwt",
  saml2: "urn:ietf:params:oauth:token-type:saml2",
};

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const ACCESS_TOKEN_URN = SUBJECT_TOKEN_TYPE_URNS.access_token;

export async function tokenExchange(
  cfg: IdpConfig,
  params: {
    subjectToken: string;
    subjectTokenType: SubjectTokenType;
    actorToken?: string;
    audience?: string;
    scope?: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<GrantResult> {
  if (!cfg.supportsTokenExchange) {
    throw new TokenExchangeUnsupportedError(cfg.tokenEndpoint);
  }
  const body = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE_GRANT,
    client_id: cfg.clientId,
    subject_token: params.subjectToken,
    subject_token_type: SUBJECT_TOKEN_TYPE_URNS[params.subjectTokenType],
  });
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
  if (params.actorToken) {
    body.set("actor_token", params.actorToken);
    body.set("actor_token_type", ACCESS_TOKEN_URN);
  }
  if (params.audience) body.set("audience", params.audience);
  if (params.scope) body.set("scope", params.scope);
  return postForm(cfg.tokenEndpoint, body, fetchImpl);
}
