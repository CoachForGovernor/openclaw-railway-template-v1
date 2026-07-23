import crypto from "node:crypto";

const SESSION_TTL_SECONDS = 12 * 60 * 60;

function sessionSignature(password, expiresAt) {
  return crypto
    .createHmac("sha256", password)
    .update(`openclaw-setup:${expiresAt}`)
    .digest("base64url");
}

export function createSetupSession(password, now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return `${expiresAt}.${sessionSignature(password, expiresAt)}`;
}

export function verifySetupSession(token, password, now = Date.now()) {
  if (!token || !password) return false;
  const [expiresAtText, signature, ...extra] = token.split(".");
  if (extra.length || !expiresAtText || !signature) return false;

  const expiresAt = Number.parseInt(expiresAtText, 10);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) {
    return false;
  }

  const expected = sessionSignature(password, expiresAt);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function safeSetupReturnPath(value) {
  if (typeof value !== "string") return "/setup";
  if (value === "/logs" || value.startsWith("/setup")) return value;
  return "/setup";
}

export const setupSessionMaxAgeSeconds = SESSION_TTL_SECONDS;
