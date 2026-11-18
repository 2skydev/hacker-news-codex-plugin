export const issuer = "https://auth.openai.com";
export const resource = "https://api.openai.com/v1";
export const tokenUrl = `${issuer}/api/accounts/oauth/token`;
export const sharing = "chatgpt.tokens.use.direct";
export const scope = `openid profile email offline_access resource.invoke ${sharing}`;
export const lunaModel = "gpt-6-luna";
export const terminalGrants = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);
