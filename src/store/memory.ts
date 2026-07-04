import type { GrantResult } from "../types.js";
import type { TokenStore } from "./types.js";

interface Entry {
  value: GrantResult;
  expiresAtMs: number;
}

export function memoryStore(nowMs: () => number = () => Date.now()): TokenStore {
  const map = new Map<string, Entry>();
  return {
    async get(key) {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (nowMs() > entry.expiresAtMs) {
        map.delete(key);
        return undefined;
      }
      return entry.value;
    },
    async set(key, value, ttlSeconds) {
      map.set(key, { value, expiresAtMs: nowMs() + ttlSeconds * 1000 });
    },
  };
}
