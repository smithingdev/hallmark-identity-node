# Hallmark — Design Spec

- **Date:** 2026-07-04
- **Status:** Draft (design approved, pending spec review)
- **Author:** smithingdev

---

## 1. Summary

**Hallmark** is an open-source, IDP-agnostic **agent-identity toolkit** for Node and Python. It gives an AI agent two things automatically on every outbound call: its **own machine identity** and the **identity of the user it is acting for** — resolving a valid, audience-scoped access token via OAuth 2.0 **Token Exchange (RFC 8693)** without the developer having to hand-roll grant types, discovery, the `act` claim, caching, or refresh.

One-line positioning:

> *"Auth0 for AI Agents, but open, un-locked, and it works with any IDP."*

A *hallmark* is the identity stamp a silversmith punches into metal to prove who made it and that it is genuine — the metaphor for a library whose job is to attach a trustworthy identity to every action an agent takes.

## 2. Background & positioning

The problem — agents needing to act on a user's behalf with a real, auditable identity — is **already validated** by the market: Auth0's "Token Vault / Auth0 for AI Agents" and Okta have GA products doing exactly this, both built on RFC 8693.

Their structural limitation is **vendor lock-in**: they only work when *their* platform is your IDP/token store. There is no clean, open-source, **vendor-neutral, self-hostable** equivalent.

That gap is Hallmark's wedge, and it maps directly onto existing smithingdev strength: the `beartropy/oauth` (multi-provider OIDC) and `beartropy/saml2` (multi-IDP SP) packages already prove the "normalize across identity providers" muscle. Auth0 *cannot* be vendor-neutral; Hallmark's entire reason to exist is that it is.

**Primary goal:** OSS reputation / reach for the smithingdev brand, funneling the AI-developer audience toward the paid ecosystem (Vaxtly, Beartropy).

## 3. Goals

- Make "get a correct token for this downstream API, as this agent, on behalf of this user" a **one-line call**.
- Work against **any** standards-compliant IDP/STS (Keycloak, Entra, Okta, Cognito, Auth0, or a generic OIDC provider).
- Accept **multiple subject-token types** — OIDC access/id tokens, plain JWTs from a federated issuer, and **SAML2 assertions**.
- Ship as a **stateless library** (no mandatory database/service) with a **pluggable token store**.
- Provide **parallel API surfaces** in TypeScript and Python so concepts and docs transfer.

## 4. Non-goals (the scope fence)

These keep v1 a *package*, not a platform. Each is a deliberate exclusion, not an oversight:

- ❌ **No user login / "user mint."** Hallmark does not run authorization-code/PKCE login flows or mint the *initial* user token. The developer brings a `subject_token` their STS already trusts; Hallmark exchanges it. Adding login would make this a login SDK — a different, much larger product, and the exact Auth0-shaped thing we are deliberately not rebuilding.
- ❌ **No persistent vault/DB.** The token store is a pluggable interface; v1 ships an in-memory implementation. Persistent stores (Redis, etc.) are optional add-ons. This is what keeps Hallmark un-locked and stateless.
- ❌ **No MCP server-side auth.** Protecting an MCP server (OAuth resource-server role) is a separate concern from an agent *consuming* identity (OAuth client role). Explicitly out of scope; a candidate sibling project.
- ❌ **No agent-framework coupling in core.** Adapters for LangGraph / Vercel AI SDK / MCP clients, if built, live in separate packages.

## 5. The DX north star

The product succeeds or fails on this reading cleanly. Everything in §6 serves it.

**TypeScript:**

```ts
const identity = createIdentity({
  idp: oidc({ issuer, clientId, clientSecret }),   // or keycloak(), entra(), okta(), auth0()
  store: memoryStore(),                            // pluggable
})

// "who am I?" — the agent's own machine identity (client credentials grant)
const mine = await identity.agent().token({ audience: "https://api.internal" })

// "who am I acting for?" — on behalf of a user (RFC 8693 token exchange)
const onBehalf = await identity
  .onBehalfOf(userToken)                           // OIDC token by default...
  .token({ audience: "https://api.github.com", scopes: ["repo"] })

// ...or a non-OIDC subject the STS trusts (e.g. a SAML2 assertion)
const fromSaml = await identity
  .onBehalfOf(samlAssertion, { type: "saml2" })
  .token({ audience: "https://api.github.com" })
```

**Python (intentionally parallel):**

```python
identity = create_identity(idp=oidc(issuer=..., client_id=..., client_secret=...),
                           store=memory_store())

mine = await identity.agent().token(audience="https://api.internal")
on_behalf = await identity.on_behalf_of(user_token).token(
    audience="https://api.github.com", scopes=["repo"])
from_saml = await identity.on_behalf_of(saml_assertion, type="saml2").token(
    audience="https://api.github.com")
```

The returned token has the **user as `sub`** and the **agent as the `act` (actor) claim** — auditable, revocable, honest delegation — and is audience-scoped and auto-refreshed.

## 6. Architecture — six small units

Each unit has one responsibility, a defined interface, and can be understood and tested in isolation.

| Unit | Responsibility |
|---|---|
| **Resolver** (core) | The only surface devs touch. Flow: build cache key → cache-check → on miss run the correct grant → store → return. |
| **IDP adapter** | Normalizes one provider: token endpoint, token-exchange parameters, `.well-known` discovery, client-credentials. Interface + concrete adapters. |
| **Token store** | `get(key)` / `set(key, token, ttl)`, keyed by `(principal, subject, audience, scopes)`. Ships in-memory; external stores are optional add-ons. |
| **Token model** | Parsed claims (`sub`, `act`, `aud`, `exp`, scopes) + helpers `isExpired` / `willExpireWithin(skew)`. |
| **Lifecycle** | Proactive refresh, **single-flight** dedupe (concurrent requests for the same key make one exchange), clock-skew tolerance. |
| **Errors** | Typed and actionable — e.g. "this IDP does not advertise token-exchange", "audience rejected", "insufficient scope". |

### 6.1 Grants used

- **Agent's own identity:** OAuth 2.0 **Client Credentials** grant → the agent is a first-class principal with its own token.
- **On-behalf-of:** RFC 8693 **Token Exchange**
  - `grant_type = urn:ietf:params:oauth:grant-type:token-exchange`
  - `subject_token` = the user's token; `subject_token_type` ∈ { `access_token`, `id_token`, `jwt`, `saml2` }
  - `actor_token` = the agent's token (optional, when the STS wants the actor asserted explicitly); `audience` + `scope` scope the result down.

### 6.2 v1 adapter set

- **Generic OIDC** adapter (spec-compliant baseline; works with any conformant STS via discovery).
- **Keycloak** as the first concrete adapter (fully OSS, trivial to self-host for demos and CI tests).
- (Entra / Okta / Cognito / Auth0 adapters follow post-v1; each is a thin normalization layer.)

## 7. Subject-token flexibility (why SAML "just works")

Because `subject_token_type` is a parameter, not a hard-coded assumption, Hallmark accepts any subject token the STS trusts. This means a user who logged in via **SAML** (or a federated **JWT**, or **AD** via ADFS/Entra) can still drive an exchange — provided the STS is configured to trust that issuer, which is the operator's configuration, not Hallmark's code.

The one true dead end — a user authenticated only against an **internal DB with no IDP relationship** — has no token any STS trusts, and is therefore un-exchangeable by *any* RFC 8693 tool. See §10 for a possible future companion that federates such apps.

## 8. Language strategy

**TypeScript first** as the reference implementation (biggest npm/agent/MCP reach, primary smithingdev strength, most shareable README). **Python mirrors the same API** as a fast-follow. The two API surfaces are kept intentionally parallel so a single conceptual model and docs set covers both. The languages are sequenced, not built simultaneously, to keep v1 shippable.

## 9. Cross-cutting concerns

- **Security:** never log token values; audience-scope every exchanged token (least privilege); encryption-at-rest is the store's responsibility, documented as such; validate `exp`/`aud` before returning a cached token.
- **Testing:** contract tests against a mock STS asserting RFC 8693 request/response conformance; an integration suite against a real **Keycloak** in CI (testcontainers) for the happy path and the SAML-subject path.
- **Distribution:** npm (`hallmark`) and PyPI (`hallmark`), MIT-licensed, under the smithingdev org.

## 10. Future / out-of-scope (captured, not committed)

- **"Trusted issuer" companion** — a tiny helper for internal-DB apps to self-sign a JWT + publish JWKS so their homegrown auth can federate and become exchangeable. Separate module, separate decision.
- **Persistent store adapters** (Redis, etc.).
- **Agent-framework adapters** (LangGraph, Vercel AI SDK, MCP clients) as separate packages.
- **Hallmark for MCP** — the sibling resource-server / MCP-auth project (the "other half" the user correctly split off).

## 11. Success criteria

- The DX north star (§5) works end-to-end against a self-hosted Keycloak for both the agent-identity and on-behalf-of paths.
- A developer can add correct agent identity to an existing agent in **≤ 5 lines** and **without** touching grant types, discovery, or refresh logic.
- SAML2 subject tokens exchange successfully against an STS configured to trust the SAML IdP.
- README + a runnable example are compelling enough to share (the OSS-reach lever).
