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
console.log("agent token acquired:", mine.raw.length, "chars");

// Acting on behalf of a user (the user token comes from YOUR app's existing login).
const userToken = process.env.USER_TOKEN!;
const onBehalf = await identity
  .onBehalfOf(userToken)
  .token({ audience: "https://api.github.com", scopes: ["repo"] });
console.log("on-behalf-of subject:", onBehalf.sub, "actor:", onBehalf.act?.sub);
