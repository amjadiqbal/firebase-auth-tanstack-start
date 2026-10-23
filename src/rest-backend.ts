import type {CryptoKey, JWTPayload} from 'jose';
import {decodeJwt, decodeProtectedHeader, errors, importPKCS8, importX509, jwtVerify, SignJWT} from 'jose';

import {FirebaseAuthError} from './errors';
import type {DecodedFirebaseToken, FirebaseAuthBackend} from './types';

/** Google's certificates for Firebase ID tokens. */
export const ID_TOKEN_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
/** Google's certificates for Firebase session cookies. */
export const SESSION_COOKIE_CERTS_URL = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/publicKeys';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/identitytoolkit';

/** A service account key, as in the JSON file you download from the Firebase console. */
export interface ServiceAccount {
  clientEmail: string;
  /** The PEM private key. Escaped `\n` sequences (common in environment variables) are turned into newlines. */
  privateKey: string;
}

export interface RestBackendOptions {
  projectId: string;
  /**
   * Needed to create session cookies, revoke tokens and check revocation (`checkRevoked`). Verifying tokens and
   * cookies needs only the project ID. Not used with the emulator.
   */
  serviceAccount?: ServiceAccount;
  /**
   * The Auth Emulator host, for example `127.0.0.1:9099`. When set, tokens are accepted **unsigned** (the emulator
   * does not sign them) and every call goes to the emulator. Only set it in development; it is never read from the
   * environment on its own.
   */
  emulatorHost?: string;
  /** Seconds of clock skew to allow when checking `exp`, `iat` and `auth_time`. Defaults to 0, like firebase-admin. */
  clockToleranceSeconds?: number;
  /** A `fetch` to use instead of the global one. */
  fetch?: typeof fetch;
}

type TokenKind = 'id' | 'session';

const KIND = {
  id: {
    name: 'ID token',
    issuer: 'https://securetoken.google.com/',
    certsUrl: ID_TOKEN_CERTS_URL,
    invalid: 'auth/invalid-id-token',
    expired: 'auth/id-token-expired',
    revoked: 'auth/id-token-revoked',
  },
  session: {
    name: 'session cookie',
    issuer: 'https://session.firebase.google.com/',
    certsUrl: SESSION_COOKIE_CERTS_URL,
    invalid: 'auth/invalid-session-cookie',
    expired: 'auth/session-cookie-expired',
    revoked: 'auth/session-cookie-revoked',
  },
} as const satisfies Record<TokenKind, Record<string, string>>;

interface CachedKeys {
  keys: Map<string, CryptoKey>;
  expiresAt: number;
}

function maxAgeSeconds(cacheControl: string | null): number {
  const match = cacheControl?.match(/max-age=(\d+)/);
  return match ? Number(match[1]) : 0;
}

/**
 * A backend that needs no `firebase-admin`: tokens and cookies are verified with Web Crypto (`jose`) against Google's
 * public certificates, and the Identity Toolkit REST API is called with `fetch`. It runs wherever Web Crypto and
 * `fetch` exist.
 */
export function restBackend(options: RestBackendOptions): FirebaseAuthBackend {
  const {projectId, serviceAccount, emulatorHost} = options;
  const tolerance = options.clockToleranceSeconds ?? 0;
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  if (!projectId) throw new FirebaseAuthError('auth/invalid-request', 'restBackend() needs a projectId.');

  const apiBase = emulatorHost
    ? `http://${emulatorHost}/identitytoolkit.googleapis.com/v1/projects/${projectId}`
    : `https://identitytoolkit.googleapis.com/v1/projects/${projectId}`;

  const keyCache = new Map<string, Promise<CachedKeys>>();
  let accessToken: {value: string; expiresAt: number} | undefined;

  async function loadKeys(url: string): Promise<CachedKeys> {
    const response = await doFetch(url);
    if (!response.ok) {
      throw new FirebaseAuthError('auth/internal-error', `Fetching Google public keys failed (${response.status}).`);
    }
    const pems = (await response.json()) as Record<string, string>;
    const keys = new Map<string, CryptoKey>();
    for (const [kid, pem] of Object.entries(pems)) keys.set(kid, await importX509(pem, 'RS256'));
    return {keys, expiresAt: Date.now() + maxAgeSeconds(response.headers.get('cache-control')) * 1000};
  }

  async function publicKey(url: string, kid: string): Promise<CryptoKey | undefined> {
    let cached = keyCache.get(url);
    let entry = cached ? await cached.catch(() => undefined) : undefined;
    if (!entry || entry.expiresAt <= Date.now()) {
      cached = loadKeys(url);
      keyCache.set(url, cached);
      cached.catch(() => keyCache.delete(url));
      entry = await cached;
    }
    return entry.keys.get(kid);
  }

  function checkClaims(payload: JWTPayload, kind: TokenKind) {
    const info = KIND[kind];
    const fail = (message: string): never => {
      throw new FirebaseAuthError(info.invalid, `The ${info.name} ${message}.`);
    };
    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== projectId) fail(`has the wrong audience (aud) for project "${projectId}"`);
    if (payload.iss !== info.issuer + projectId) fail(`has the wrong issuer (iss) for project "${projectId}"`);
    if (typeof payload.sub !== 'string' || payload.sub === '') fail('has no subject (sub)');
    if ((payload.sub as string).length > 128) fail('has a subject (sub) longer than 128 characters');
    if (typeof payload.exp !== 'number') fail('has no expiry (exp)');
    if ((payload.exp as number) + tolerance <= now) {
      throw new FirebaseAuthError(info.expired, `The ${info.name} has expired.`);
    }
    if (typeof payload.iat !== 'number' || payload.iat > now + tolerance) fail('was issued in the future (iat)');
    if (typeof payload.auth_time !== 'number' || payload.auth_time > now + tolerance) {
      fail('has an authentication time (auth_time) in the future');
    }
  }

  async function verifySignature(token: string, kind: TokenKind): Promise<JWTPayload> {
    const info = KIND[kind];
    let header: ReturnType<typeof decodeProtectedHeader>;
    try {
      header = decodeProtectedHeader(token);
    } catch (error) {
      throw new FirebaseAuthError(info.invalid, `The ${info.name} is not a JWT.`, {cause: error});
    }

    if (emulatorHost) {
      // The Auth Emulator issues unsigned tokens: alg "none" and an empty signature.
      if (header.alg !== 'none' || !token.endsWith('.')) {
        throw new FirebaseAuthError(info.invalid, `The ${info.name} is not an unsigned Auth Emulator token.`);
      }
      try {
        return decodeJwt(token);
      } catch (error) {
        throw new FirebaseAuthError(info.invalid, `The ${info.name} could not be decoded.`, {cause: error});
      }
    }

    if (header.alg !== 'RS256') {
      throw new FirebaseAuthError(info.invalid, `The ${info.name} must use RS256, not "${header.alg}".`);
    }
    if (!header.kid) throw new FirebaseAuthError(info.invalid, `The ${info.name} has no "kid" header.`);
    const key = await publicKey(info.certsUrl, header.kid);
    if (!key) {
      throw new FirebaseAuthError(
        info.invalid,
        `The ${info.name} has a "kid" that matches no current Google public key. It is probably expired.`,
      );
    }
    try {
      const {payload} = await jwtVerify(token, key, {algorithms: ['RS256'], clockTolerance: tolerance});
      return payload;
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        throw new FirebaseAuthError(info.expired, `The ${info.name} has expired.`, {cause: error});
      }
      const reason = error instanceof errors.JWSSignatureVerificationFailed ? 'has an invalid signature' : 'is invalid';
      throw new FirebaseAuthError(info.invalid, `The ${info.name} ${reason}.`, {cause: error});
    }
  }

  async function getAccessToken(): Promise<string> {
    if (emulatorHost) return 'owner';
    if (!serviceAccount) {
      throw new FirebaseAuthError(
        'auth/credential-required',
        'Creating session cookies, revoking tokens and checking revocation need a service account (serviceAccount).',
      );
    }
    if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
    const key = await importPKCS8(serviceAccount.privateKey.replace(/\\n/g, '\n'), 'RS256');
    const assertion = await new SignJWT({scope: SCOPES})
      .setProtectedHeader({alg: 'RS256', typ: 'JWT'})
      .setIssuer(serviceAccount.clientEmail)
      .setAudience(TOKEN_URL)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    const response = await doFetch(TOKEN_URL, {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion}),
    });
    if (!response.ok) {
      throw new FirebaseAuthError('auth/internal-error', `Getting a Google access token failed (${response.status}).`);
    }
    const body = (await response.json()) as {access_token: string; expires_in: number};
    accessToken = {value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000};
    return body.access_token;
  }

  async function callApi<T>(path: string, body: unknown): Promise<T> {
    const response = await doFetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${await getAccessToken()}`},
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as T & {error?: {message?: string}};
    if (!response.ok) {
      const message = json.error?.message ?? `HTTP ${response.status}`;
      if (message.startsWith('USER_NOT_FOUND')) throw new FirebaseAuthError('auth/user-not-found', 'No such user.');
      if (message.startsWith('INVALID_ID_TOKEN')) {
        throw new FirebaseAuthError('auth/invalid-id-token', `Firebase rejected the ID token (${message}).`);
      }
      if (message.startsWith('USER_DISABLED'))
        throw new FirebaseAuthError('auth/user-disabled', 'The user is disabled.');
      throw new FirebaseAuthError('auth/internal-error', `Identity Toolkit ${path} failed: ${message}`);
    }
    return json;
  }

  async function checkNotRevokedOrDisabled(decoded: DecodedFirebaseToken, kind: TokenKind) {
    const result = await callApi<{users?: {disabled?: boolean; validSince?: string}[]}>('/accounts:lookup', {
      localId: [decoded.sub],
    });
    const user = result.users?.[0];
    if (!user) throw new FirebaseAuthError('auth/user-not-found', 'The token belongs to a user that no longer exists.');
    if (user.disabled) throw new FirebaseAuthError('auth/user-disabled', 'The user is disabled.');
    if (user.validSince && decoded.auth_time < Number(user.validSince)) {
      throw new FirebaseAuthError(KIND[kind].revoked, `The ${KIND[kind].name} has been revoked.`);
    }
  }

  async function verify(token: string, kind: TokenKind, checkRevoked: boolean): Promise<DecodedFirebaseToken> {
    if (typeof token !== 'string' || token === '') {
      throw new FirebaseAuthError(KIND[kind].invalid, `No ${KIND[kind].name} was given.`);
    }
    const payload = await verifySignature(token, kind);
    checkClaims(payload, kind);
    const decoded = {...payload, uid: payload.sub} as DecodedFirebaseToken;
    // Like firebase-admin, the emulator always checks for revoked and disabled users.
    if (checkRevoked || emulatorHost) await checkNotRevokedOrDisabled(decoded, kind);
    return decoded;
  }

  return {
    verifyIdToken: (idToken, checkRevoked) => verify(idToken, 'id', checkRevoked),
    verifySessionCookie: (cookie, checkRevoked) => verify(cookie, 'session', checkRevoked),
    async createSessionCookie(idToken, expiresInSeconds) {
      const result = await callApi<{sessionCookie: string}>(':createSessionCookie', {
        idToken,
        validDuration: expiresInSeconds,
      });
      return result.sessionCookie;
    },
    async revokeRefreshTokens(uid) {
      await callApi('/accounts:update', {localId: uid, validSince: Math.floor(Date.now() / 1000)});
    },
  };
}
