<h1 align="center">Hallmark</h1>

<p align="center">
  <strong>Open, IDP-agnostic identity for AI agents.</strong><br>
  Give an agent its own identity <em>and</em> the identity of the user it acts for —
  via OAuth 2.0 Token Exchange (<a href="https://datatracker.ietf.org/doc/html/rfc8693">RFC 8693</a>), against any IDP.
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-4f8ff7">
  <img alt="Zero dependencies" src="https://img.shields.io/badge/runtime%20deps-0-4f8ff7">
  <img alt="RFC 8693" src="https://img.shields.io/badge/RFC-8693-4f8ff7">
  <img alt="Node ≥ 20" src="https://img.shields.io/badge/node-%E2%89%A5%2020-4f8ff7">
</p>

> **Auth0 for AI Agents — but open, self-hostable, and locked to no one.**

---

## Why Hallmark exists

An AI agent that does real work has to answer two questions on every call it makes to an external API:

- **Who am I?** — the agent is a first-class principal, not an anonymous script.
- **Who am I doing this for?** — it's acting on behalf of a specific user, and that must be *auditable and revocable*.

The standards answer is OAuth 2.0 **Token Exchange (RFC 8693)**: hand your IDP the user's token plus the agent's identity, get back a downstream, audience-scoped token whose `sub` is the **user** and whose `act` (actor) claim is the **agent**.

The commercial answer (Auth0 Token Vault, Okta) works — but only if *their* platform is your IDP. **Hallmark is the open, vendor-neutral version.** It speaks the standard against **any** compliant IDP, stores nothing you don't ask it to, and adds **zero runtime dependencies**.

## Status

The **TypeScript v1 core is complete and tested** (agent identity + on-behalf-of exchange, generic OIDC and Keycloak adapters, caching, single-flight). A **Python port** and the **npm release** are on the [roadmap](#roadmap). Until then, install from source.

## Install

```bash
pnpm add hallmark   # (npm publish pending — see Status)
```

Requires **Node ≥ 20** (native `fetch` + `node:crypto`). ESM and CommonJS builds are both shipped.

## Quick start

```ts
import { createIdentity, oidc } from "hallmark";

const identity = createIdentity({
  idp: oidc({ issuer: "https://your-idp/", clientId: "agent", clientSecret: "…" }),
});

// "Who am I?" — the agent's own machine identity (client-credentials grant)
const mine = await identity.agent().token({ audience: "https://api.internal" });

// "Who am I acting for?" — on behalf of a user (you bring the user's token)
const onBehalf = await identity
  .onBehalfOf(userToken)                                  // OIDC access/id token by default
  .token({ audience: "https://api.github.com", scopes: ["repo"] });

fetch("https://api.github.com/user/repos", {
  headers: { authorization: `Bearer ${onBehalf.raw}` },
});
```

That's the whole surface: **one import, one call, a correct token.** You never touch grant types, discovery, token caching, or refresh.

## How it works

The token Hallmark returns for an on-behalf-of call carries the **user as `sub`** and the **agent as the `act` (actor) claim** — honest, auditable, revocable delegation — scoped to the one audience you asked for. Exactly which claims land in the exchanged token is governed by *your* IDP's token-exchange configuration; Hallmark speaks the protocol correctly and lets the IDP be the source of truth.

Under the hood, on every `.token()` call Hallmark:

1. **Discovers** the IDP's token endpoint (`.well-known/openid-configuration`), cached after the first call.
2. **Checks its cache**, keyed by `(principal, subject, audience, scopes)` — the subject token is hashed, never stored raw.
3. On a miss, runs the right grant (**client-credentials** for the agent, **token-exchange** for on-behalf-of), **de-duplicating** concurrent identical requests into a single network call (single-flight).
4. **Caches** the result, transparently re-acquiring it as it nears expiry (with a configurable skew), and never serving a token past its own `exp`.

## Supported IDPs

Hallmark works with **any RFC 8693-capable OIDC provider** through the generic `oidc()` adapter, plus a first-class `keycloak()` convenience adapter:

```ts
import { oidc, keycloak } from "hallmark";

oidc({ issuer: "https://login.microsoftonline.com/<tenant>/v2.0", clientId, clientSecret });
keycloak({ baseUrl: "https://kc.example", realm: "agents", clientId, clientSecret });
```

Dedicated adapters for **Entra, Okta, Cognito, and Auth0** are on the roadmap; today they work via `oidc()` as long as their STS advertises token-exchange support.

## Subject tokens: OIDC, JWT, or SAML

Because RFC 8693 parameterizes the subject-token type, users who authenticated in different ways can all drive an exchange — as long as your IDP is configured to trust the issuer:

```ts
identity.onBehalfOf(oidcAccessToken);                    // default
identity.onBehalfOf(jwtFromFederatedIssuer, { type: "jwt" });
identity.onBehalfOf(samlAssertion,          { type: "saml2" });
```

Supported types: `access_token` (default), `id_token`, `jwt`, `saml2`.

## API

| Export | Purpose |
| --- | --- |
| `createIdentity(opts)` | Factory. `opts`: `{ idp, store?, refreshSkewSeconds?, fetch? }`. |
| `identity.agent().token(req?)` | The agent's own identity. `req`: `{ audience?, scopes? }`. |
| `identity.onBehalfOf(subjectToken, { type? }).token(req?)` | On-behalf-of a user. |
| `oidc(opts)` / `keycloak(opts)` | IDP adapters (`IdpProvider`). |
| `memoryStore()` | Default in-memory `TokenStore`; implement the interface to plug in Redis, etc. |
| `parseToken`, `isExpired`, `willExpireWithin` | Token-claim helpers. |
| `HallmarkError`, `GrantError`, `TokenExchangeUnsupportedError` | Typed errors. |

A returned `Token` exposes `{ raw, sub, act?, aud?, scope?, exp? }` — `raw` is the string you send as a bearer token.

### Bring your own store

The token store is a two-method interface, so a shared cache (Redis, etc.) is a drop-in:

```ts
import { createIdentity, type TokenStore } from "hallmark";

const redisStore: TokenStore = {
  async get(key) { /* … */ },
  async set(key, value, ttlSeconds) { /* … */ },
};

createIdentity({ idp, store: redisStore });
```

Cache keys are scoped by principal and issuer, so one shared store is safe across multiple agents and IDPs.

## What Hallmark is **not**

- **Not a login system.** It does not authenticate your users or mint the *initial* user token — you bring a `subject_token` your IDP already trusts. Hallmark exchanges it.
- **Not a token vault.** It persists nothing by default; the store is pluggable and in-memory unless you swap it.
- **Not MCP server-side auth.** Protecting an MCP server (the resource-server role) is a separate concern from an agent *consuming* identity (the client role).

## Security

- **Token values are never logged** and never appear in error messages — errors carry only status codes, OAuth error codes, and endpoint URLs.
- **Subject tokens are hashed** (SHA-256) before they enter a cache key.
- **Every exchanged token is audience-scoped** to a single downstream API — least privilege by default.
- **Expired tokens are never served** from cache, even if the store's TTL hasn't elapsed.

## Roadmap

- [ ] Publish to npm
- [ ] Python port (parallel API)
- [ ] Dedicated Entra / Okta / Cognito / Auth0 adapters
- [ ] Persistent store adapters (Redis, …)
- [ ] Adapters for popular agent frameworks
- [ ] Explicit `actor_token` option for STSes that require it

## License

MIT
