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
