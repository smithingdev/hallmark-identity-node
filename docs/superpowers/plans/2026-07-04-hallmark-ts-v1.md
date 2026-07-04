# Hallmark TypeScript v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the TypeScript v1 of Hallmark — a stateless, IDP-agnostic library that resolves a valid, audience-scoped token for an agent's own identity (client-credentials) and on-behalf-of a user (RFC 8693 token exchange).

**Architecture:** Six small units — token model, pluggable store, IDP adapters (generic OIDC + Keycloak), two grant request-builders (client-credentials, token-exchange), and a resolver that ties them together with caching and single-flight dedupe. A public `createIdentity()` factory is the only surface consumers touch. `fetch` is dependency-injected so every unit is deterministically testable.

**Tech Stack:** TypeScript (ESM), Node ≥ 20 (native `fetch` + `node:crypto`), vitest (tests), tsup (dual ESM/CJS build + types), pnpm. **Zero runtime dependencies.**

## Global Constraints

- **Node ≥ 20** — relies on global `fetch`, global `Response`, and `node:crypto`. No polyfills.
- **Zero runtime dependencies** — implement JWT decode, hashing, and HTTP with built-ins only.
- **ESM package** — `"type": "module"` in `package.json`; tsup emits both ESM and CJS + `.d.ts`.
- **Never log token values** — no `console.log`/error containing a raw token, subject token, or actor token.
- **Package name:** `hallmark`. **License:** MIT. **Org:** smithingdev.
- **`subject_token_type` URNs (verbatim, do not paraphrase):**
  - `access_token` → `urn:ietf:params:oauth:token-type:access_token`
  - `id_token` → `urn:ietf:params:oauth:token-type:id_token`
  - `jwt` → `urn:ietf:params:oauth:token-type:jwt`
  - `saml2` → `urn:ietf:params:oauth:token-type:saml2`
- **Token-exchange grant type (verbatim):** `urn:ietf:params:oauth:grant-type:token-exchange`
- **`fetch` is injectable** — every function that performs I/O accepts a `FetchLike` parameter defaulting to global `fetch`, so tests never touch the network.

---

## File Structure

```
hallmark/
  package.json              # Task 1
  tsconfig.json             # Task 1
  tsup.config.ts            # Task 1
  vitest.config.ts          # Task 1
  src/
    errors.ts               # Task 1  — typed error taxonomy
    token.ts                # Task 2  — parseToken, isExpired, willExpireWithin
    types.ts                # Task 3  — shared types: GrantResult, FetchLike
    store/
      types.ts              # Task 3  — TokenStore interface
      memory.ts             # Task 3  — in-memory store
    idp/
      types.ts              # Task 4  — IdpProvider, IdpConfig
      oidc.ts               # Task 4  — generic OIDC adapter (discovery)
      keycloak.ts           # Task 7  — Keycloak adapter
    grants/
      clientCredentials.ts  # Task 5
      tokenExchange.ts      # Task 6
    resolver.ts             # Task 8  — cache key, single-flight, grant dispatch
    identity.ts             # Task 8  — createIdentity public factory
    index.ts                # Task 9  — public exports
  tests/                    # mirrors src/, one test file per unit
  .github/workflows/ci.yml  # Task 10
  README.md                 # Task 10
  examples/keycloak.ts      # Task 10
  tests/integration/keycloak.test.ts  # Task 11 (Docker-required)
```

---

### Task 1: Scaffold + error taxonomy

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- Create: `src/errors.ts`
- Test: `tests/errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `HallmarkError`, `GrantError` (with `.status: number`, `.oauthError?: string`), `TokenExchangeUnsupportedError` (with `.issuer: string`). All carry `.code: string`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "hallmark",
  "version": "0.0.0",
  "description": "Open, IDP-agnostic agent-identity toolkit: agent + on-behalf-of tokens via RFC 8693.",
  "type": "module",
  "license": "MIT",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsup",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "declaration": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**"],
  },
});
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: `node_modules` created, lockfile written, no errors.

- [ ] **Step 6: Write the failing test — `tests/errors.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { HallmarkError, GrantError, TokenExchangeUnsupportedError } from "../src/errors.js";

describe("errors", () => {
  it("GrantError carries status, oauth error, and code", () => {
    const e = new GrantError("bad", 400, "invalid_grant");
    expect(e).toBeInstanceOf(HallmarkError);
    expect(e.status).toBe(400);
    expect(e.oauthError).toBe("invalid_grant");
    expect(e.code).toBe("grant_failed");
    expect(e.name).toBe("GrantError");
  });

  it("TokenExchangeUnsupportedError names the issuer", () => {
    const e = new TokenExchangeUnsupportedError("https://idp.example");
    expect(e.issuer).toBe("https://idp.example");
    expect(e.code).toBe("token_exchange_unsupported");
    expect(e.message).toContain("https://idp.example");
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm test`
Expected: FAIL — cannot find module `../src/errors.js`.

- [ ] **Step 8: Implement `src/errors.ts`**

```ts
export class HallmarkError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "HallmarkError";
  }
}

export class GrantError extends HallmarkError {
  constructor(
    message: string,
    readonly status: number,
    readonly oauthError?: string,
  ) {
    super(message, "grant_failed");
    this.name = "GrantError";
  }
}

export class TokenExchangeUnsupportedError extends HallmarkError {
  constructor(readonly issuer: string) {
    super(`IDP at ${issuer} does not advertise token exchange`, "token_exchange_unsupported");
    this.name = "TokenExchangeUnsupportedError";
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm test`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json tsup.config.ts vitest.config.ts src/errors.ts tests/errors.test.ts pnpm-lock.yaml
git commit -m "chore: scaffold hallmark + error taxonomy"
```

---

### Task 2: Token model

**Files:**
- Create: `src/token.ts`
- Test: `tests/token.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Token { raw: string; sub?: string; act?: { sub?: string }; aud?: string | string[]; scope?: string; exp?: number }`
  - `parseToken(raw: string): Token` — best-effort JWT decode; opaque tokens return `{ raw }` with no claims.
  - `isExpired(token: Token, skewSeconds?: number, nowMs?: number): boolean`
  - `willExpireWithin(token: Token, ms: number, nowMs?: number): boolean`

- [ ] **Step 1: Write the failing test — `tests/token.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseToken, isExpired, willExpireWithin } from "../src/token.js";

// Helper: build an unsigned JWT with the given payload (signature ignored — we never verify).
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.`;
}

describe("parseToken", () => {
  it("decodes sub, act, aud, scope, exp from a JWT", () => {
    const t = parseToken(jwt({ sub: "user-1", act: { sub: "agent-1" }, aud: "api", scope: "repo", exp: 1000 }));
    expect(t.sub).toBe("user-1");
    expect(t.act?.sub).toBe("agent-1");
    expect(t.aud).toBe("api");
    expect(t.scope).toBe("repo");
    expect(t.exp).toBe(1000);
    expect(t.raw).toContain(".");
  });

  it("returns only raw for an opaque (non-JWT) token", () => {
    const t = parseToken("opaque-token-value");
    expect(t.raw).toBe("opaque-token-value");
    expect(t.sub).toBeUndefined();
    expect(t.exp).toBeUndefined();
  });
});

describe("isExpired / willExpireWithin", () => {
  const nowMs = 1_000_000; // → 1000 epoch seconds
  it("isExpired is true when exp is within the skew window", () => {
    expect(isExpired(parseToken(jwt({ exp: 1010 })), 30, nowMs)).toBe(true); // 1010 - 30 <= 1000
    expect(isExpired(parseToken(jwt({ exp: 1040 })), 30, nowMs)).toBe(false);
  });
  it("tokens without exp are never considered expired", () => {
    expect(isExpired(parseToken("opaque"), 30, nowMs)).toBe(false);
  });
  it("willExpireWithin looks ahead by the given ms", () => {
    expect(willExpireWithin(parseToken(jwt({ exp: 1005 })), 10_000, nowMs)).toBe(true); // expires in 5s
    expect(willExpireWithin(parseToken(jwt({ exp: 2000 })), 10_000, nowMs)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/token.test.ts`
Expected: FAIL — cannot find module `../src/token.js`.

- [ ] **Step 3: Implement `src/token.ts`**

```ts
export interface Token {
  raw: string;
  sub?: string;
  act?: { sub?: string };
  aud?: string | string[];
  scope?: string;
  exp?: number; // epoch seconds
}

export function parseToken(raw: string): Token {
  const parts = raw.split(".");
  if (parts.length < 2) return { raw };
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const claims = JSON.parse(json) as Record<string, unknown>;
    return {
      raw,
      sub: typeof claims.sub === "string" ? claims.sub : undefined,
      act: isActClaim(claims.act) ? { sub: claims.act.sub } : undefined,
      aud: claims.aud as string | string[] | undefined,
      scope: typeof claims.scope === "string" ? claims.scope : undefined,
      exp: typeof claims.exp === "number" ? claims.exp : undefined,
    };
  } catch {
    return { raw };
  }
}

function isActClaim(v: unknown): v is { sub?: string } {
  return typeof v === "object" && v !== null;
}

export function isExpired(token: Token, skewSeconds = 30, nowMs = Date.now()): boolean {
  if (token.exp === undefined) return false;
  return token.exp - skewSeconds <= Math.floor(nowMs / 1000);
}

export function willExpireWithin(token: Token, ms: number, nowMs = Date.now()): boolean {
  if (token.exp === undefined) return false;
  return token.exp * 1000 <= nowMs + ms;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/token.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/token.ts tests/token.test.ts
git commit -m "feat: token model with claim parsing and expiry helpers"
```

---

### Task 3: Shared types + token store

**Files:**
- Create: `src/types.ts`, `src/store/types.ts`, `src/store/memory.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/types.ts`: `type FetchLike = typeof fetch`; `interface GrantResult { accessToken: string; expiresIn?: number; issuedTokenType?: string; scope?: string; tokenType?: string }`
  - `src/store/types.ts`: `interface TokenStore { get(key: string): Promise<GrantResult | undefined>; set(key: string, value: GrantResult, ttlSeconds: number): Promise<void> }`
  - `src/store/memory.ts`: `memoryStore(nowMs?: () => number): TokenStore`

- [ ] **Step 1: Create `src/types.ts`**

```ts
export type FetchLike = typeof fetch;

export interface GrantResult {
  accessToken: string;
  expiresIn?: number; // seconds
  issuedTokenType?: string;
  scope?: string;
  tokenType?: string;
}
```

- [ ] **Step 2: Create `src/store/types.ts`**

```ts
import type { GrantResult } from "../types.js";

export interface TokenStore {
  get(key: string): Promise<GrantResult | undefined>;
  set(key: string, value: GrantResult, ttlSeconds: number): Promise<void>;
}
```

- [ ] **Step 3: Write the failing test — `tests/store.test.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm test tests/store.test.ts`
Expected: FAIL — cannot find module `../src/store/memory.js`.

- [ ] **Step 5: Implement `src/store/memory.ts`**

```ts
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test tests/store.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/store/types.ts src/store/memory.ts tests/store.test.ts
git commit -m "feat: shared types and in-memory token store"
```

---

### Task 4: IDP interface + generic OIDC adapter (discovery)

**Files:**
- Create: `src/idp/types.ts`, `src/idp/oidc.ts`
- Test: `tests/idp-oidc.test.ts`

**Interfaces:**
- Consumes: `FetchLike` (Task 3), `GrantError` (Task 1).
- Produces:
  - `src/idp/types.ts`: `interface IdpConfig { tokenEndpoint: string; clientId: string; clientSecret?: string; supportsTokenExchange: boolean }` and `interface IdpProvider { resolve(fetchImpl?: FetchLike): Promise<IdpConfig> }`
  - `src/idp/oidc.ts`: `oidc(opts: { issuer: string; clientId: string; clientSecret?: string; tokenEndpoint?: string }): IdpProvider` — discovery cached after first call.

- [ ] **Step 1: Create `src/idp/types.ts`**

```ts
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
```

- [ ] **Step 2: Write the failing test — `tests/idp-oidc.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { oidc } from "../src/idp/oidc.js";

const TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange";

function discoveryFetch(doc: Record<string, unknown>) {
  return vi.fn(async (url: string | URL) => {
    expect(String(url)).toBe("https://idp.example/.well-known/openid-configuration");
    return new Response(JSON.stringify(doc), { status: 200 });
  });
}

describe("oidc adapter", () => {
  it("discovers the token endpoint and detects token-exchange support", async () => {
    const f = discoveryFetch({
      token_endpoint: "https://idp.example/token",
      grant_types_supported: ["client_credentials", TOKEN_EXCHANGE],
    });
    const cfg = await oidc({ issuer: "https://idp.example/", clientId: "agent", clientSecret: "s" }).resolve(f as never);
    expect(cfg.tokenEndpoint).toBe("https://idp.example/token");
    expect(cfg.supportsTokenExchange).toBe(true);
    expect(cfg.clientId).toBe("agent");
  });

  it("caches discovery — resolve twice hits the network once", async () => {
    const f = discoveryFetch({ token_endpoint: "https://idp.example/token", grant_types_supported: [] });
    const provider = oidc({ issuer: "https://idp.example", clientId: "agent" });
    await provider.resolve(f as never);
    const cfg = await provider.resolve(f as never);
    expect(f).toHaveBeenCalledTimes(1);
    expect(cfg.supportsTokenExchange).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test tests/idp-oidc.test.ts`
Expected: FAIL — cannot find module `../src/idp/oidc.js`.

- [ ] **Step 4: Implement `src/idp/oidc.ts`**

```ts
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
      if (!cached) cached = discover(opts, fetchImpl);
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test tests/idp-oidc.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/idp/types.ts src/idp/oidc.ts tests/idp-oidc.test.ts
git commit -m "feat: IdpProvider interface and generic OIDC discovery adapter"
```

---

### Task 5: Client-credentials grant

**Files:**
- Create: `src/grants/clientCredentials.ts`
- Test: `tests/grant-client-credentials.test.ts`

**Interfaces:**
- Consumes: `IdpConfig` (Task 4), `GrantResult` + `FetchLike` (Task 3), `GrantError` (Task 1).
- Produces: `clientCredentials(cfg: IdpConfig, params: { audience?: string; scope?: string }, fetchImpl?: FetchLike): Promise<GrantResult>`

- [ ] **Step 1: Write the failing test — `tests/grant-client-credentials.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { clientCredentials } from "../src/grants/clientCredentials.js";
import { GrantError } from "../src/errors.js";
import type { IdpConfig } from "../src/idp/types.js";

const cfg: IdpConfig = {
  tokenEndpoint: "https://idp.example/token",
  clientId: "agent",
  clientSecret: "secret",
  supportsTokenExchange: true,
};

describe("clientCredentials", () => {
  it("posts the client_credentials grant and parses the result", async () => {
    const f = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init!.body as string);
      expect(body.get("grant_type")).toBe("client_credentials");
      expect(body.get("client_id")).toBe("agent");
      expect(body.get("client_secret")).toBe("secret");
      expect(body.get("audience")).toBe("https://api.internal");
      expect(body.get("scope")).toBe("read");
      return new Response(JSON.stringify({ access_token: "AT", expires_in: 300, token_type: "Bearer" }), { status: 200 });
    });
    const result = await clientCredentials(cfg, { audience: "https://api.internal", scope: "read" }, f as never);
    expect(result).toEqual({ accessToken: "AT", expiresIn: 300, scope: undefined, tokenType: "Bearer", issuedTokenType: undefined });
  });

  it("throws GrantError with the OAuth error code on failure", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }));
    await expect(clientCredentials(cfg, {}, f as never)).rejects.toMatchObject({
      constructor: GrantError,
      status: 401,
      oauthError: "invalid_client",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/grant-client-credentials.test.ts`
Expected: FAIL — cannot find module `../src/grants/clientCredentials.js`.

- [ ] **Step 3: Implement `src/grants/clientCredentials.ts`**

```ts
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
```

- [ ] **Step 4: Create the shared `src/grants/http.ts` helper**

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test tests/grant-client-credentials.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/grants/clientCredentials.ts src/grants/http.ts tests/grant-client-credentials.test.ts
git commit -m "feat: client-credentials grant + shared form-post helper"
```

---

### Task 6: Token-exchange grant (RFC 8693)

**Files:**
- Create: `src/grants/tokenExchange.ts`
- Test: `tests/grant-token-exchange.test.ts`

**Interfaces:**
- Consumes: `IdpConfig` (Task 4), `postForm` (Task 5), `GrantResult` + `FetchLike` (Task 3), `TokenExchangeUnsupportedError` (Task 1).
- Produces:
  - `type SubjectTokenType = "access_token" | "id_token" | "jwt" | "saml2"`
  - `tokenExchange(cfg: IdpConfig, params: { subjectToken: string; subjectTokenType: SubjectTokenType; actorToken?: string; audience?: string; scope?: string }, fetchImpl?: FetchLike): Promise<GrantResult>`

- [ ] **Step 1: Write the failing test — `tests/grant-token-exchange.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { tokenExchange } from "../src/grants/tokenExchange.js";
import { TokenExchangeUnsupportedError } from "../src/errors.js";
import type { IdpConfig } from "../src/idp/types.js";

const base: IdpConfig = {
  tokenEndpoint: "https://idp.example/token",
  clientId: "agent",
  clientSecret: "secret",
  supportsTokenExchange: true,
};

describe("tokenExchange", () => {
  it("builds an RFC 8693 request with the correct grant type and URNs", async () => {
    const f = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init!.body as string);
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
      expect(body.get("subject_token")).toBe("USER");
      expect(body.get("subject_token_type")).toBe("urn:ietf:params:oauth:token-type:access_token");
      expect(body.get("actor_token")).toBe("AGENT");
      expect(body.get("actor_token_type")).toBe("urn:ietf:params:oauth:token-type:access_token");
      expect(body.get("audience")).toBe("https://api.github.com");
      expect(body.get("scope")).toBe("repo");
      return new Response(JSON.stringify({ access_token: "EXCHANGED", expires_in: 120 }), { status: 200 });
    });
    const result = await tokenExchange(
      base,
      { subjectToken: "USER", subjectTokenType: "access_token", actorToken: "AGENT", audience: "https://api.github.com", scope: "repo" },
      f as never,
    );
    expect(result.accessToken).toBe("EXCHANGED");
    expect(result.expiresIn).toBe(120);
  });

  it("maps a SAML2 subject token to the saml2 URN", async () => {
    const f = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init!.body as string);
      expect(body.get("subject_token_type")).toBe("urn:ietf:params:oauth:token-type:saml2");
      return new Response(JSON.stringify({ access_token: "X" }), { status: 200 });
    });
    await tokenExchange(base, { subjectToken: "<saml/>", subjectTokenType: "saml2" }, f as never);
    expect(f).toHaveBeenCalledOnce();
  });

  it("throws TokenExchangeUnsupportedError without calling the network when the IDP lacks support", async () => {
    const f = vi.fn();
    await expect(
      tokenExchange({ ...base, supportsTokenExchange: false, tokenEndpoint: "https://idp.example/token" }, { subjectToken: "U", subjectTokenType: "access_token" }, f as never),
    ).rejects.toBeInstanceOf(TokenExchangeUnsupportedError);
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/grant-token-exchange.test.ts`
Expected: FAIL — cannot find module `../src/grants/tokenExchange.js`.

- [ ] **Step 3: Implement `src/grants/tokenExchange.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/grant-token-exchange.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/grants/tokenExchange.ts tests/grant-token-exchange.test.ts
git commit -m "feat: RFC 8693 token-exchange grant with subject-token-type mapping"
```

---

### Task 7: Keycloak adapter

**Files:**
- Create: `src/idp/keycloak.ts`
- Test: `tests/idp-keycloak.test.ts`

**Interfaces:**
- Consumes: `oidc` (Task 4), `IdpProvider` (Task 4).
- Produces: `keycloak(opts: { baseUrl: string; realm: string; clientId: string; clientSecret?: string }): IdpProvider`

- [ ] **Step 1: Write the failing test — `tests/idp-keycloak.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { keycloak } from "../src/idp/keycloak.js";

describe("keycloak adapter", () => {
  it("builds the realm issuer and discovers its token endpoint", async () => {
    const f = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://kc.example/realms/agents/.well-known/openid-configuration");
      return new Response(
        JSON.stringify({ token_endpoint: "https://kc.example/realms/agents/protocol/openid-connect/token", grant_types_supported: [] }),
        { status: 200 },
      );
    });
    const cfg = await keycloak({ baseUrl: "https://kc.example/", realm: "agents", clientId: "agent" }).resolve(f as never);
    expect(cfg.tokenEndpoint).toBe("https://kc.example/realms/agents/protocol/openid-connect/token");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/idp-keycloak.test.ts`
Expected: FAIL — cannot find module `../src/idp/keycloak.js`.

- [ ] **Step 3: Implement `src/idp/keycloak.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/idp-keycloak.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/idp/keycloak.ts tests/idp-keycloak.test.ts
git commit -m "feat: keycloak adapter over generic OIDC"
```

---

### Task 8: Resolver + createIdentity public factory

**Files:**
- Create: `src/resolver.ts`, `src/identity.ts`
- Test: `tests/identity.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6 — `IdpProvider`, `TokenStore`, `memoryStore`, `clientCredentials`, `tokenExchange`, `SubjectTokenType`, `parseToken`, `Token`, `GrantResult`, `FetchLike`.
- Produces:
  - `interface TokenRequest { audience?: string; scopes?: string[] }`
  - `interface CreateIdentityOptions { idp: IdpProvider; store?: TokenStore; refreshSkewSeconds?: number; fetch?: FetchLike }`
  - `interface Identity { agent(): { token(req?: TokenRequest): Promise<Token> }; onBehalfOf(subjectToken: string, opts?: { type?: SubjectTokenType }): { token(req?: TokenRequest): Promise<Token> } }`
  - `createIdentity(options: CreateIdentityOptions): Identity`

- [ ] **Step 1: Write the failing test — `tests/identity.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { createIdentity } from "../src/identity.js";
import type { IdpProvider } from "../src/idp/types.js";

const idp: IdpProvider = {
  async resolve() {
    return { tokenEndpoint: "https://idp.example/token", clientId: "agent", clientSecret: "s", supportsTokenExchange: true };
  },
};

function tokenResponse(access: string, expiresIn = 300) {
  return new Response(JSON.stringify({ access_token: access, expires_in: expiresIn }), { status: 200 });
}

describe("createIdentity", () => {
  it("agent().token() runs client-credentials and caches the result", async () => {
    const f = vi.fn(async () => tokenResponse("AGENT_AT"));
    const identity = createIdentity({ idp, fetch: f as never });
    const first = await identity.agent().token({ audience: "https://api.internal" });
    const second = await identity.agent().token({ audience: "https://api.internal" });
    expect(first.raw).toBe("AGENT_AT");
    expect(second.raw).toBe("AGENT_AT");
    expect(f).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it("onBehalfOf().token() runs a token exchange", async () => {
    const f = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = new URLSearchParams(init!.body as string);
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
      expect(body.get("subject_token")).toBe("USER_TOKEN");
      return tokenResponse("OBO_AT", 120);
    });
    const identity = createIdentity({ idp, fetch: f as never });
    const t = await identity.onBehalfOf("USER_TOKEN").token({ audience: "https://api.github.com", scopes: ["repo"] });
    expect(t.raw).toBe("OBO_AT");
  });

  it("dedupes concurrent identical requests into a single grant (single-flight)", async () => {
    const f = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return tokenResponse("AGENT_AT");
    });
    const identity = createIdentity({ idp, fetch: f as never });
    const [a, b] = await Promise.all([identity.agent().token(), identity.agent().token()]);
    expect(a.raw).toBe("AGENT_AT");
    expect(b.raw).toBe("AGENT_AT");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("distinguishes cache entries by audience and scopes", async () => {
    const f = vi.fn(async () => tokenResponse("AT"));
    const identity = createIdentity({ idp, fetch: f as never });
    await identity.agent().token({ audience: "a" });
    await identity.agent().token({ audience: "b" });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/identity.test.ts`
Expected: FAIL — cannot find module `../src/identity.js`.

- [ ] **Step 3: Implement `src/resolver.ts`**

```ts
import { createHash } from "node:crypto";
import type { FetchLike, GrantResult } from "./types.js";
import type { IdpProvider } from "./idp/types.js";
import type { TokenStore } from "./store/types.js";
import { clientCredentials } from "./grants/clientCredentials.js";
import { tokenExchange, type SubjectTokenType } from "./grants/tokenExchange.js";

export interface ResolveRequest {
  audience?: string;
  scope?: string;
  onBehalfOf?: { subjectToken: string; subjectTokenType: SubjectTokenType };
}

export interface ResolverDeps {
  idp: IdpProvider;
  store: TokenStore;
  refreshSkewSeconds: number;
  fetchImpl: FetchLike;
}

export function createResolver(deps: ResolverDeps) {
  const inflight = new Map<string, Promise<GrantResult>>();

  function keyFor(req: ResolveRequest): string {
    const audience = req.audience ?? "";
    const scope = req.scope ?? "";
    if (req.onBehalfOf) {
      const subHash = createHash("sha256").update(req.onBehalfOf.subjectToken).digest("hex").slice(0, 16);
      return `te:${req.onBehalfOf.subjectTokenType}:${subHash}:${audience}:${scope}`;
    }
    return `cc:${audience}:${scope}`;
  }

  async function grant(req: ResolveRequest): Promise<GrantResult> {
    const cfg = await deps.idp.resolve(deps.fetchImpl);
    if (req.onBehalfOf) {
      return tokenExchange(
        cfg,
        {
          subjectToken: req.onBehalfOf.subjectToken,
          subjectTokenType: req.onBehalfOf.subjectTokenType,
          audience: req.audience,
          scope: req.scope,
        },
        deps.fetchImpl,
      );
    }
    return clientCredentials(cfg, { audience: req.audience, scope: req.scope }, deps.fetchImpl);
  }

  return async function resolve(req: ResolveRequest): Promise<GrantResult> {
    const key = keyFor(req);
    const cached = await deps.store.get(key);
    if (cached) return cached;

    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const result = await grant(req);
      const ttl = Math.max((result.expiresIn ?? 300) - deps.refreshSkewSeconds, 1);
      await deps.store.set(key, result, ttl);
      return result;
    })();

    inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(key);
    }
  };
}
```

- [ ] **Step 4: Implement `src/identity.ts`**

```ts
import type { FetchLike } from "./types.js";
import { parseToken } from "./token.js";
import type { Token } from "./token.js";
import type { IdpProvider } from "./idp/types.js";
import type { TokenStore } from "./store/types.js";
import { memoryStore } from "./store/memory.js";
import type { SubjectTokenType } from "./grants/tokenExchange.js";
import { createResolver } from "./resolver.js";

export interface TokenRequest {
  audience?: string;
  scopes?: string[];
}

export interface CreateIdentityOptions {
  idp: IdpProvider;
  store?: TokenStore;
  refreshSkewSeconds?: number;
  fetch?: FetchLike;
}

export interface Identity {
  agent(): { token(req?: TokenRequest): Promise<Token> };
  onBehalfOf(subjectToken: string, opts?: { type?: SubjectTokenType }): { token(req?: TokenRequest): Promise<Token> };
}

export function createIdentity(options: CreateIdentityOptions): Identity {
  const resolve = createResolver({
    idp: options.idp,
    store: options.store ?? memoryStore(),
    refreshSkewSeconds: options.refreshSkewSeconds ?? 30,
    fetchImpl: options.fetch ?? fetch,
  });

  const scopeOf = (req?: TokenRequest) => (req?.scopes && req.scopes.length ? req.scopes.join(" ") : undefined);

  return {
    agent() {
      return {
        async token(req?: TokenRequest): Promise<Token> {
          const result = await resolve({ audience: req?.audience, scope: scopeOf(req) });
          return parseToken(result.accessToken);
        },
      };
    },
    onBehalfOf(subjectToken: string, opts?: { type?: SubjectTokenType }) {
      const subjectTokenType: SubjectTokenType = opts?.type ?? "access_token";
      return {
        async token(req?: TokenRequest): Promise<Token> {
          const result = await resolve({
            audience: req?.audience,
            scope: scopeOf(req),
            onBehalfOf: { subjectToken, subjectTokenType },
          });
          return parseToken(result.accessToken);
        },
      };
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test tests/identity.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/resolver.ts src/identity.ts tests/identity.test.ts
git commit -m "feat: resolver with caching + single-flight, and createIdentity factory"
```

---

### Task 9: Public exports + end-to-end mock-STS test

**Files:**
- Create: `src/index.ts`
- Test: `tests/e2e.test.ts`

**Interfaces:**
- Consumes: all public symbols.
- Produces: the package's public API surface.

- [ ] **Step 1: Implement `src/index.ts`**

```ts
export { createIdentity } from "./identity.js";
export type { Identity, CreateIdentityOptions, TokenRequest } from "./identity.js";
export { oidc } from "./idp/oidc.js";
export { keycloak } from "./idp/keycloak.js";
export type { IdpProvider, IdpConfig } from "./idp/types.js";
export { memoryStore } from "./store/memory.js";
export type { TokenStore } from "./store/types.js";
export { parseToken, isExpired, willExpireWithin } from "./token.js";
export type { Token } from "./token.js";
export type { GrantResult, FetchLike } from "./types.js";
export type { SubjectTokenType } from "./grants/tokenExchange.js";
export { HallmarkError, GrantError, TokenExchangeUnsupportedError } from "./errors.js";
```

Each type is exported from the module that actually defines it: `Token` from `token.ts`; `GrantResult`/`FetchLike` from `types.ts`; `IdpProvider`/`IdpConfig` from `idp/types.ts`.

- [ ] **Step 2: Write the failing test — `tests/e2e.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { createIdentity, oidc } from "../src/index.js";

const TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange";

// A tiny in-memory STS: answers discovery, client_credentials, and token-exchange.
function mockSts() {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/.well-known/openid-configuration")) {
      return new Response(
        JSON.stringify({ token_endpoint: "https://sts.example/token", grant_types_supported: ["client_credentials", TOKEN_EXCHANGE] }),
        { status: 200 },
      );
    }
    const body = new URLSearchParams(init!.body as string);
    if (body.get("grant_type") === TOKEN_EXCHANGE) {
      return new Response(JSON.stringify({ access_token: "OBO", expires_in: 120 }), { status: 200 });
    }
    return new Response(JSON.stringify({ access_token: "AGENT", expires_in: 300 }), { status: 200 });
  });
}

describe("end-to-end against a mock STS", () => {
  it("resolves both agent identity and on-behalf-of tokens through the public API", async () => {
    const f = mockSts();
    const identity = createIdentity({
      idp: oidc({ issuer: "https://sts.example", clientId: "agent", clientSecret: "s" }),
      fetch: f as never,
    });

    const agentToken = await identity.agent().token({ audience: "https://api.internal" });
    expect(agentToken.raw).toBe("AGENT");

    const oboToken = await identity.onBehalfOf("USER").token({ audience: "https://api.github.com", scopes: ["repo"] });
    expect(oboToken.raw).toBe("OBO");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails, then passes**

Run: `pnpm test tests/e2e.test.ts`
Expected: FAIL first (module `../src/index.js` not resolvable until Step 1 is saved); after saving `src/index.ts`, PASS.

- [ ] **Step 4: Typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: no type errors; `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` produced.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`
Expected: PASS — all unit + e2e tests green.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/e2e.test.ts
git commit -m "feat: public exports and end-to-end mock-STS test"
```

---

### Task 10: CI workflow, README, runnable example

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`, `examples/keycloak.ts`

**Interfaces:**
- Consumes: the public API.
- Produces: OSS-reach deliverables (the spec's success lever).

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2: Create `examples/keycloak.ts`**

```ts
import { createIdentity, keycloak } from "hallmark";

const identity = createIdentity({
  idp: keycloak({
    baseUrl: process.env.KC_URL ?? "http://localhost:8080",
    realm: "agents",
    clientId: process.env.KC_CLIENT_ID ?? "agent",
    clientSecret: process.env.KC_CLIENT_SECRET,
  }),
});

// The agent's own identity.
const mine = await identity.agent().token({ audience: "https://api.internal" });
console.log("agent token acquired:", mine.raw.slice(0, 8), "…");

// Acting on behalf of a user (the user token comes from YOUR app's existing login).
const userToken = process.env.USER_TOKEN!;
const onBehalf = await identity
  .onBehalfOf(userToken)
  .token({ audience: "https://api.github.com", scopes: ["repo"] });
console.log("on-behalf-of subject:", onBehalf.sub, "actor:", onBehalf.act?.sub);
```

- [ ] **Step 3: Create `README.md`**

````markdown
# Hallmark

Open, IDP-agnostic **agent-identity** toolkit. Give an AI agent its own identity **and** on-behalf-of-user tokens via OAuth 2.0 Token Exchange ([RFC 8693](https://datatracker.ietf.org/doc/html/rfc8693)) — against **any** IDP (Keycloak, Entra, Okta, Cognito, Auth0, or plain OIDC). Stateless, zero-dependency, MIT.

> Auth0 for AI Agents, but open and un-locked.

## Install

```bash
pnpm add hallmark
```

## Use

```ts
import { createIdentity, oidc } from "hallmark";

const identity = createIdentity({
  idp: oidc({ issuer: "https://your-idp/", clientId: "agent", clientSecret: "…" }),
});

// "who am I?" — the agent's own machine identity
const mine = await identity.agent().token({ audience: "https://api.internal" });

// "who am I acting for?" — on behalf of a user (you bring the user token)
const onBehalf = await identity
  .onBehalfOf(userToken)                       // OIDC token by default; pass { type: "saml2" } for SAML
  .token({ audience: "https://api.github.com", scopes: ["repo"] });
```

The exchanged token has the **user as `sub`** and the **agent as the `act` claim** — auditable, revocable delegation — and is audience-scoped and auto-refreshed.

## What Hallmark does not do

- It does **not** log your users in. You bring a `subject_token` your IDP already trusts (OIDC token, JWT, or SAML2 assertion); Hallmark exchanges it.
- It does **not** persist tokens. The store is pluggable and in-memory by default.
- It is **not** MCP server-side auth — that's a separate concern.
````

- [ ] **Step 4: Verify the example typechecks against the built package**

Run: `pnpm build && pnpm exec tsc --noEmit examples/keycloak.ts --module nodenext --moduleResolution nodenext`
Expected: no type errors (imports resolve against `dist` types via the package name).

Note: if resolving `hallmark` from `examples/` fails locally because the package isn't linked, this check is also covered in CI after `pnpm install` links the workspace; a local `pnpm link --global` is optional.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml README.md examples/keycloak.ts
git commit -m "docs: CI workflow, README, and Keycloak example"
```

---

### Task 11: Keycloak integration test (Docker-required) — spec §9

**Files:**
- Create: `tests/integration/keycloak.test.ts`
- Modify: `package.json` (add `test:integration` script)

**Interfaces:**
- Consumes: the public API + a real Keycloak container.
- Produces: proof the happy path works against a real STS, not just a mock.

**Precondition:** Docker available. This suite is excluded from the default `pnpm test` (see `vitest.config.ts` exclude) and CI's fast job; run it explicitly. (This realizes spec §9's "real Keycloak in CI" intent with a lightweight opt-in `docker run` + `describe.skipIf` rather than the `testcontainers` library, to keep the zero-dependency constraint intact. If you later want auto-managed lifecycle, adding `@testcontainers/keycloak` as a `devDependency` is a clean swap.)

- [ ] **Step 1: Add the integration script to `package.json`**

```json
"test:integration": "vitest run --dir tests/integration --exclude ''"
```

- [ ] **Step 2: Write `tests/integration/keycloak.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { createIdentity, keycloak } from "../../src/index.js";

// Assumes a Keycloak reachable at KC_URL with a realm "agents", a confidential
// client "agent" (client-credentials + token-exchange enabled), and env vars set.
// See tests/integration/README.md for a one-line `docker run` to start one.
const KC_URL = process.env.KC_URL;
const CLIENT_SECRET = process.env.KC_CLIENT_SECRET;

describe.skipIf(!KC_URL || !CLIENT_SECRET)("keycloak integration", () => {
  beforeAll(() => {
    // Fail fast with a clear message if Keycloak isn't reachable.
    execSync(`curl -sf ${KC_URL}/realms/agents/.well-known/openid-configuration > /dev/null`);
  });

  it("acquires the agent's own token via client-credentials", async () => {
    const identity = createIdentity({
      idp: keycloak({ baseUrl: KC_URL!, realm: "agents", clientId: "agent", clientSecret: CLIENT_SECRET }),
    });
    const token = await identity.agent().token();
    expect(token.raw.length).toBeGreaterThan(10);
    expect(token.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
```

- [ ] **Step 3: Document how to start Keycloak — create `tests/integration/README.md`**

````markdown
# Integration tests

These require a real Keycloak. Start one:

```bash
docker run --rm -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.0 start-dev
```

Then create realm `agents` and a confidential client `agent` with
**Service Accounts (client credentials)** and **Token Exchange** enabled,
export its secret, and run:

```bash
KC_URL=http://localhost:8080 KC_CLIENT_SECRET=<secret> pnpm test:integration
```
````

- [ ] **Step 4: Run the integration suite (with Keycloak up)**

Run: `KC_URL=http://localhost:8080 KC_CLIENT_SECRET=<secret> pnpm test:integration`
Expected: PASS. Without env vars set, the suite is skipped (`describe.skipIf`), so CI's default job stays green.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/keycloak.test.ts tests/integration/README.md package.json
git commit -m "test: Keycloak integration suite (opt-in, Docker-required)"
```

---

## Notes for the executor

- **Import paths use `.js` extensions** even for `.ts` sources — this is correct for ESM + `"moduleResolution": "Bundler"`/NodeNext. Do not drop them.
- **Never introduce a runtime dependency.** If tempted (JWT libs, axios, uuid), stop — the constraints forbid it; use `node:crypto` and global `fetch`.
- **Python mirror is a separate plan** (spec §8) — do not start it here.
- **Follow-ups captured in spec §10** (persistent store adapters, Entra/Okta/Cognito/Auth0 adapters, framework adapters, the "trusted issuer" companion, Hallmark-for-MCP) are out of scope for this plan.
