/** The claims of a verified Firebase ID token or session cookie, as Firebase issues them. */
export interface DecodedFirebaseToken {
  /** The user's uid (`sub`). */
  uid: string;
  sub: string;
  aud: string;
  iss: string;
  iat: number;
  exp: number;
  auth_time: number;
  email?: string;
  email_verified?: boolean;
  phone_number?: string;
  name?: string;
  picture?: string;
  firebase: {
    sign_in_provider: string;
    tenant?: string;
    identities?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [claim: string]: unknown;
}

/** Custom claims you set with `setCustomUserClaims()`. Pass your own shape as the type parameter. */
export type CustomClaims = Record<string, unknown>;

/**
 * The signed-in user, built from the verified token. Plain JSON, so it can be returned from server functions and
 * put on the router context.
 */
export interface FirebaseUser<Claims extends CustomClaims = CustomClaims> {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  phoneNumber: string | null;
  /** `firebase.sign_in_provider`, for example `password`, `google.com` or `anonymous`. */
  signInProvider: string;
  /** `firebase.tenant` for Identity Platform multi-tenancy, else `null`. */
  tenant: string | null;
  /** When the user signed in, in seconds since the epoch (`auth_time`). */
  authTime: number;
  /** When the verified token or session cookie expires, in seconds since the epoch (`exp`). */
  expiresAt: number;
  /**
   * The custom claims on the token (every claim that is not a standard Firebase claim). The type is what you declare;
   * nothing checks the values at runtime.
   */
  claims: Claims;
}

/**
 * What the package needs from Firebase. `restBackend()` (Web Crypto and `fetch`, no `firebase-admin`) and
 * `firebaseAdminBackend()` (from `/admin`) both implement it.
 */
export interface FirebaseAuthBackend {
  verifyIdToken(idToken: string, checkRevoked: boolean): Promise<DecodedFirebaseToken>;
  verifySessionCookie(sessionCookie: string, checkRevoked: boolean): Promise<DecodedFirebaseToken>;
  /** Exchanges an ID token for a session cookie valid for `expiresInSeconds` (300 to 1,209,600). */
  createSessionCookie(idToken: string, expiresInSeconds: number): Promise<string>;
  /** Revokes every refresh token and session cookie the user has (sets `validSince` to now). */
  revokeRefreshTokens(uid: string): Promise<void>;
}
