import { describe, it, expect } from "vitest";
import { memoryStore } from "../src/store/memory.js";

describe("memoryStore", () => {
  it("returns a stored value before its TTL elapses", async () => {
    let t = 0;
    const store = memoryStore(() => t);
    await store.set("k", { accessToken: "abc" }, 60);
    t = 59_000; // 59s
    expect(await store.get("k")).toEqual({ accessToken: "abc" });
  });

  it("evicts a value once its TTL has elapsed", async () => {
    let t = 0;
    const store = memoryStore(() => t);
    await store.set("k", { accessToken: "abc" }, 60);
    t = 60_001; // just past 60s
    expect(await store.get("k")).toBeUndefined();
  });
});
