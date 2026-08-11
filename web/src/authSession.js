export function normalizeSessionResponse(status, body = {}, authenticateHeader = "") {
  const challenge = String(authenticateHeader || "").toLowerCase();
  const accessTokenExpired = status === 401 && (
    body?.error === "invalid_token"
    || challenge.includes("cloudflare-access-protected-resource")
    || challenge.includes('realm="oauth"')
  );

  if (accessTokenExpired) {
    return {
      authenticated: false,
      authMode: "access",
      reauthRequired: true,
      error: "Your Cloudflare Access session expired.",
    };
  }
  return body;
}
