import type {Auth} from 'firebase-admin/auth';

import {FirebaseAuthError, type FirebaseAuthErrorCode} from './errors';
import type {DecodedFirebaseToken, FirebaseAuthBackend} from './types';

const PASSED_THROUGH = new Set<string>([
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/session-cookie-expired',
  'auth/session-cookie-revoked',
  'auth/user-disabled',
  'auth/user-not-found',
]);

function mapError(error: unknown, invalid: FirebaseAuthErrorCode): FirebaseAuthError {
  if (error instanceof FirebaseAuthError) return error;
  const code = (error as {code?: string})?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code && PASSED_THROUGH.has(code))
    return new FirebaseAuthError(code as FirebaseAuthErrorCode, message, {cause: error});
  if (code === 'auth/argument-error' || code === 'auth/invalid-id-token') {
    return new FirebaseAuthError(invalid, message, {cause: error});
  }
  return new FirebaseAuthError('auth/internal-error', message, {cause: error});
}

/**
 * A backend on the Firebase Admin SDK, for Node servers that already use `firebase-admin`. Pass its `Auth`:
 *
 * ```ts
 * import { getAuth } from 'firebase-admin/auth'
 * firebaseAdminBackend(getAuth(app))
 * ```
 *
 * `firebase-admin` reads `FIREBASE_AUTH_EMULATOR_HOST` itself; this backend adds nothing to that.
 */
export function firebaseAdminBackend(auth: Auth): FirebaseAuthBackend {
  return {
    async verifyIdToken(idToken, checkRevoked) {
      try {
        return (await auth.verifyIdToken(idToken, checkRevoked)) as unknown as DecodedFirebaseToken;
      } catch (error) {
        throw mapError(error, 'auth/invalid-id-token');
      }
    },
    async verifySessionCookie(cookie, checkRevoked) {
      try {
        return (await auth.verifySessionCookie(cookie, checkRevoked)) as unknown as DecodedFirebaseToken;
      } catch (error) {
        throw mapError(error, 'auth/invalid-session-cookie');
      }
    },
    async createSessionCookie(idToken, expiresInSeconds) {
      try {
        return await auth.createSessionCookie(idToken, {expiresIn: expiresInSeconds * 1000});
      } catch (error) {
        throw mapError(error, 'auth/invalid-id-token');
      }
    },
    async revokeRefreshTokens(uid) {
      try {
        await auth.revokeRefreshTokens(uid);
      } catch (error) {
        throw mapError(error, 'auth/invalid-request');
      }
    },
  };
}
