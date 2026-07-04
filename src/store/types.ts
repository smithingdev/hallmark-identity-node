import type { GrantResult } from "../types.js";

export interface TokenStore {
  get(key: string): Promise<GrantResult | undefined>;
  set(key: string, value: GrantResult, ttlSeconds: number): Promise<void>;
}
