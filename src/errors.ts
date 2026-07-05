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
