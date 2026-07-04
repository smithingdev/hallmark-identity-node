import type { FetchLike, GrantResult } from "../types.js";
import { GrantError } from "../errors.js";

export async function postForm(
  tokenEndpoint: string,
  body: URLSearchParams,
  fetchImpl: FetchLike,
): Promise<GrantResult> {
  const res = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const oauthError = typeof json.error === "string" ? json.error : undefined;
    throw new GrantError(`Token request failed (${res.status})`, res.status, oauthError);
  }
  return {
    accessToken: String(json.access_token ?? ""),
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined,
    issuedTokenType: typeof json.issued_token_type === "string" ? json.issued_token_type : undefined,
    scope: typeof json.scope === "string" ? json.scope : undefined,
    tokenType: typeof json.token_type === "string" ? json.token_type : undefined,
  };
}
