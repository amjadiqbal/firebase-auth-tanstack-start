export {APP_CHECK_HEADER, type AppCheckOptions, appCheckVerifier, type VerifiedAppCheckToken} from './app-check';
export {readCookie, type SessionCookieOptions} from './cookies';
export {FirebaseAuthError, type FirebaseAuthErrorCode, isFirebaseAuthError} from './errors';
export {
  type AuthResult,
  type AuthSource,
  createFirebaseAuth,
  type FirebaseAuth,
  type FirebaseAuthContext,
  type FirebaseAuthOptions,
} from './firebase-auth';
export {
  ID_TOKEN_CERTS_URL,
  type RestBackendOptions,
  restBackend,
  SESSION_COOKIE_CERTS_URL,
  type ServiceAccount,
} from './rest-backend';
export type {CustomClaims, DecodedFirebaseToken, FirebaseAuthBackend, FirebaseUser} from './types';
export {toFirebaseUser} from './user';
