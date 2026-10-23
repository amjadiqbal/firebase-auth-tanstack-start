/**
 * Every error code this package produces. Codes that also exist in `firebase-admin` keep the same name.
 */
export type FirebaseAuthErrorCode =
  | 'auth/invalid-id-token'
  | 'auth/id-token-expired'
  | 'auth/id-token-revoked'
  | 'auth/invalid-session-cookie'
  | 'auth/session-cookie-expired'
  | 'auth/session-cookie-revoked'
  | 'auth/user-disabled'
  | 'auth/user-not-found'
  | 'auth/recent-sign-in-required'
  | 'auth/credential-required'
  | 'auth/invalid-request'
  | 'auth/csrf-rejected'
  | 'auth/method-not-allowed'
  | 'auth/unauthenticated'
  | 'auth/forbidden'
  | 'auth/internal-error'
  | 'app-check/missing-token'
  | 'app-check/invalid-token';

const STATUS: Record<FirebaseAuthErrorCode, number> = {
  'auth/invalid-id-token': 401,
  'auth/id-token-expired': 401,
  'auth/id-token-revoked': 401,
  'auth/invalid-session-cookie': 401,
  'auth/session-cookie-expired': 401,
  'auth/session-cookie-revoked': 401,
  'auth/user-disabled': 401,
  'auth/user-not-found': 401,
  'auth/recent-sign-in-required': 401,
  'auth/credential-required': 500,
  'auth/invalid-request': 400,
  'auth/csrf-rejected': 403,
  'auth/method-not-allowed': 405,
  'auth/unauthenticated': 401,
  'auth/forbidden': 403,
  'auth/internal-error': 500,
  'app-check/missing-token': 401,
  'app-check/invalid-token': 401,
};

/** An error with a stable `code` and the HTTP `status` the package's handlers answer with for it. */
export class FirebaseAuthError extends Error {
  readonly code: FirebaseAuthErrorCode;
  readonly status: number;

  constructor(code: FirebaseAuthErrorCode, message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'FirebaseAuthError';
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isFirebaseAuthError(error: unknown): error is FirebaseAuthError {
  return error instanceof FirebaseAuthError;
}
