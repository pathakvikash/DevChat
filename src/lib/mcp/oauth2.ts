export interface OAuth2ProviderConfig {
  authorizationUrl: string;
  tokenUrl: string;
  defaultScopes: string;
}

const OAUTH2_PROVIDERS: Record<string, OAuth2ProviderConfig> = {
  github: {
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    defaultScopes: "repo read:user",
  },
  gmail: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    defaultScopes: "https://www.googleapis.com/auth/gmail.modify",
  },
  slack: {
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    defaultScopes: "channels:read chat:write users:read",
  },
  sap: {
    authorizationUrl: "",
    tokenUrl: "",
    defaultScopes: "openid api-access",
  },
};

export function getOAuth2Provider(name: string): OAuth2ProviderConfig | null {
  return OAUTH2_PROVIDERS[name.toLowerCase()] || null;
}

export function buildAuthorizationUrl(params: {
  authorizationUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
}): string {
  const url = new URL(params.authorizationUrl);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scopes);
  url.searchParams.set("state", params.state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export async function exchangeCode(params: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const res = await fetch(params.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in };
}
