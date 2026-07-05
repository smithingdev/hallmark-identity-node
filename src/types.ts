export type FetchLike = typeof fetch;

export interface GrantResult {
  accessToken: string;
  expiresIn?: number; // seconds
  issuedTokenType?: string;
  scope?: string;
  tokenType?: string;
}
