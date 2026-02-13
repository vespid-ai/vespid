export function toBearerTokenHeader(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
  };
}
