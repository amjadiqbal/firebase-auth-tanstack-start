import {createLocalJWKSet, decodeProtectedHeader, type JSONWebKeySet, jwtVerify} from 'jose';

import {FirebaseAuthError} from './errors';

export const APP_CHECK_JWKS_URL = 'https://firebaseappcheck.googleapis.com/v1/jwks';
/** The header the Firebase JS SDK and the package's React hook send the App Check token in. */
export const APP_CHECK_HEADER = 'x-firebase-appcheck';
/** How long fetched App Check keys are kept: six hours, as firebase-admin does. */
const JWKS_TTL_MS = 6 * 60 * 60 * 1000;

export interface AppCheckOptions {
  /** Your Firebase project **number** (not the project ID), from Project settings. */
  projectNumber: string;
  /** A `fetch` to use instead of the global one. */
  fetch?: typeof fetch;
}

export interface VerifiedAppCheckToken {
  /** The Firebase app ID the token was issued to (`sub`). */
  appId: string;
  claims: Record<string, unknown>;
}

/**
 * Builds a verifier for Firebase App Check tokens, with the checks Firebase documents for JWT libraries: RS256 and typ JWT, signed by a key in App Check's JWKS, issuer
 * `https://firebaseappcheck.googleapis.com/<projectNumber>`, audience containing `projects/<projectNumber>`, not expired.
 */
export function appCheckVerifier(options: AppCheckOptions) {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  let jwks: {set: ReturnType<typeof createLocalJWKSet>; expiresAt: number} | undefined;

  async function keySet() {
    if (jwks && jwks.expiresAt > Date.now()) return jwks.set;
    const response = await doFetch(APP_CHECK_JWKS_URL);
    if (!response.ok) {
      throw new FirebaseAuthError('auth/internal-error', `Fetching App Check keys failed (${response.status}).`);
    }
    jwks = {set: createLocalJWKSet((await response.json()) as JSONWebKeySet), expiresAt: Date.now() + JWKS_TTL_MS};
    return jwks.set;
  }

  return async function verifyAppCheckToken(token: string | null | undefined): Promise<VerifiedAppCheckToken> {
    if (!token) throw new FirebaseAuthError('app-check/missing-token', 'No App Check token was sent.');
    try {
      const header = decodeProtectedHeader(token);
      if (header.alg !== 'RS256' || header.typ !== 'JWT') throw new Error('unexpected header');
      const {payload} = await jwtVerify(token, await keySet(), {
        algorithms: ['RS256'],
        issuer: `https://firebaseappcheck.googleapis.com/${options.projectNumber}`,
        audience: `projects/${options.projectNumber}`,
      });
      if (typeof payload.sub !== 'string' || payload.sub === '') throw new Error('no subject');
      return {appId: payload.sub, claims: payload as Record<string, unknown>};
    } catch (error) {
      if (error instanceof FirebaseAuthError && error.code === 'auth/internal-error') throw error;
      throw new FirebaseAuthError('app-check/invalid-token', 'The App Check token is invalid.', {cause: error});
    }
  };
}
