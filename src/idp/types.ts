import type { FetchLike } from "../types.js";

export interface IdpConfig {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  supportsTokenExchange: boolean;
}

export interface IdpProvider {
  resolve(fetchImpl?: FetchLike): Promise<IdpConfig>;
}
