import type {CustomClaims, DecodedFirebaseToken, FirebaseUser} from './types';

/** Standard claims Firebase puts on every token. Everything else is a custom claim. */
const STANDARD_CLAIMS = new Set([
  'iss',
  'aud',
  'auth_time',
  'user_id',
  'sub',
  'iat',
  'exp',
  'nbf',
  'jti',
  'email',
  'email_verified',
  'phone_number',
  'name',
  'picture',
  'firebase',
  'uid',
  'acr',
  'amr',
  'at_hash',
  'azp',
  'cnf',
  'c_hash',
  'nonce',
]);

/** Turns verified claims into the plain `FirebaseUser` object the package puts on the context. */
export function toFirebaseUser<Claims extends CustomClaims = CustomClaims>(
  decoded: DecodedFirebaseToken,
): FirebaseUser<Claims> {
  const claims: CustomClaims = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (!STANDARD_CLAIMS.has(key)) claims[key] = value;
  }
  return {
    uid: decoded.uid ?? decoded.sub,
    email: decoded.email ?? null,
    emailVerified: decoded.email_verified === true,
    name: decoded.name ?? null,
    picture: decoded.picture ?? null,
    phoneNumber: decoded.phone_number ?? null,
    signInProvider: decoded.firebase?.sign_in_provider ?? 'unknown',
    tenant: decoded.firebase?.tenant ?? null,
    authTime: decoded.auth_time,
    expiresAt: decoded.exp,
    claims: claims as Claims,
  };
}
