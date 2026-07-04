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
