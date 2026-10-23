import {setCookie, setResponseStatus} from '@tanstack/react-start/server';

import {APP_CHECK_HEADER, appCheckVerifier, type VerifiedAppCheckToken} from './app-check';
import {
  clearSessionCookie,
  type ResolvedCookieOptions,
  readCookie,
  resolveCookieOptions,
  type SessionCookieOptions,
  serializeSessionCookie,
} from './cookies';
import {FirebaseAuthError, type FirebaseAuthErrorCode} from './errors';
import {restBackend, type ServiceAccount} from './rest-backend';
import type {CustomClaims, FirebaseAuthBackend, FirebaseUser} from './types';
import {toFirebaseUser} from './user';

export interface FirebaseAuthOptions {
  /** Your Firebase project ID. Required unless you pass your own `backend`. */
  projectId?: string;
  /**
   * How tokens are verified and session cookies made. Defaults to `restBackend()` (Web Crypto, no `firebase-admin`)
   * built from `projectId`, `serviceAccount` and `emulatorHost`. Use `firebaseAdminBackend()` from `/admin` to go
   * through the Admin SDK instead.
   */
  backend?: FirebaseAuthBackend;
  /** For the default backend: needed to create session cookies, revoke tokens and use `checkRevoked`. */
  serviceAccount?: ServiceAccount;
  /** For the default backend: the Auth Emulator host. Tokens are then accepted unsigned. Development only. */
  emulatorHost?: string;
  /** The session cookie. It is always `HttpOnly`; see `SessionCookieOptions` for the defaults. */
  cookie?: SessionCookieOptions;
  /**
   * Also ask Firebase on every request whether the session was revoked or the user disabled. Costs one Identity
   * Toolkit call per request. Defaults to `false`, like firebase-admin. (The emulator always checks.)
   */
  checkRevoked?: boolean;
  /** Accept `Authorization: Bearer <Firebase ID token>` as well as the cookie. Defaults to `true`. */
  bearer?: boolean;
  /**
   * Origins allowed to call the login and logout handlers. Defaults to the origin of the request URL. Set it when a
   * proxy changes the scheme or host your server sees.
   */
  allowedOrigins?: string[];
  /**
   * Only make a session from an ID token whose sign-in (`auth_time`) is at most this many seconds old. Firebase's
   * guide uses 300. Not set by default, so the React hook can renew an expired cookie while the browser is still
   * signed in to Firebase.
   */
  maxAuthAgeSeconds?: number;
  /**
   * Revoke the user's refresh tokens on logout. This signs the user out of **every** device and is what makes a
   * copied cookie stop working, when combined with `checkRevoked: true`. Defaults to `false`.
   */
  revokeOnLogout?: boolean;
  /** Verify Firebase App Check tokens (header `X-Firebase-AppCheck`). */
  appCheck?: {
    projectNumber: string;
    /** Refuse logins without a valid App Check token. Defaults to `true` when `appCheck` is set. */
    requireOnLogin?: boolean;
  };
  /** Seconds of clock skew allowed by the default backend. Defaults to 0. */
  clockToleranceSeconds?: number;
  /** A `fetch` for the default backend and App Check key downloads. */
  fetch?: typeof fetch;
}

export type AuthSource = 'session-cookie' | 'bearer';

export interface AuthResult<Claims extends CustomClaims = CustomClaims> {
  user: FirebaseUser<Claims> | null;
  /** Where the user came from, or `null` when nobody is signed in. */
  source: AuthSource | null;
  /** Why a cookie or bearer token that was sent was refused. `null` when nothing was sent or it was valid. */
  error: FirebaseAuthError | null;
  /** `true` when a session cookie was sent that can never become valid again, so it should be deleted. */
  clearCookie: boolean;
}

/** The context the middleware body returns, for `next({ context })`. */
export interface FirebaseAuthContext<Claims extends CustomClaims = CustomClaims> {
  user: FirebaseUser<Claims> | null;
}

export interface FirebaseAuth<Claims extends CustomClaims = CustomClaims> {
  /** Verifies the request's bearer token or session cookie. Never throws for a bad credential; see `error`. */
  authenticate(request: Request): Promise<AuthResult<Claims>>;
  /** The signed-in user for a request, or `null`. */
  getUser(request: Request): Promise<FirebaseUser<Claims> | null>;
  /**
   * Body for a TanStack Start request middleware. Returns `{ user }` for `next({ context })` and deletes a session
   * cookie that is expired, revoked or invalid.
   *
   * ```ts
   * createMiddleware().server(async ({ request, next }) => next({ context: await auth.middleware({ request }) }))
   * ```
   */
  middleware(args: {request: Request}): Promise<FirebaseAuthContext<Claims>>;
  /**
   * Returns `context.user`, or throws a `FirebaseAuthError`: `auth/unauthenticated` (status 401) when nobody is
   * signed in, `auth/forbidden` (403) when `authorize` returns false. Inside a request it also sets that status.
   */
  requireUser(
    context: {user?: FirebaseUser<Claims> | null} | undefined,
    authorize?: (user: FirebaseUser<Claims>) => boolean,
  ): FirebaseUser<Claims>;
  /**
   * POST handler that turns a Firebase ID token into the session cookie. Body: `{ "idToken": "..." }` as
   * `application/json`. Answers 200 `{ uid }` with `Set-Cookie`, or an error (see the README's error table).
   */
  loginHandler(request: Request): Promise<Response>;
  /** POST handler that deletes the session cookie (and revokes the user's tokens with `revokeOnLogout`). */
  logoutHandler(request: Request): Promise<Response>;
  /**
   * Verifies the request's `X-Firebase-AppCheck` header. Throws `app-check/missing-token` or
   * `app-check/invalid-token`. Needs the `appCheck` option.
   */
  verifyAppCheck(request: Request): Promise<VerifiedAppCheckToken>;
  /** The resolved session cookie settings. */
  readonly cookie: Readonly<ResolvedCookieOptions>;
  readonly backend: FirebaseAuthBackend;
}

/** Codes after which a session cookie can never become valid again. */
const DEAD_COOKIE: ReadonlySet<FirebaseAuthErrorCode> = new Set([
  'auth/invalid-session-cookie',
  'auth/session-cookie-expired',
  'auth/session-cookie-revoked',
  'auth/user-disabled',
  'auth/user-not-found',
]);

function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json', 'cache-control': 'no-store'},
  });
  for (const [name, value] of new Headers(headers)) response.headers.append(name, value);
  return response;
}

function errorResponse(error: FirebaseAuthError, headers?: HeadersInit): Response {
  return json(error.status, {error: {code: error.code, message: error.message}}, headers);
}

function toAuthError(error: unknown): FirebaseAuthError {
  return error instanceof FirebaseAuthError
    ? error
    : new FirebaseAuthError('auth/internal-error', error instanceof Error ? error.message : String(error), {
        cause: error,
      });
}

/** Runs a Start response helper, ignoring the error it throws outside a Start request (tests, other servers). */
function inStartRequest(fn: () => void) {
  try {
    fn();
  } catch {}
}

/**
 * Creates the server side of Firebase Authentication for a TanStack Start app. Keep it in a server-only module
 * (for example `src/firebase-auth.server.ts`).
 *
 * ```ts
 * export const auth = createFirebaseAuth<{ role?: 'admin' }>({
 *   projectId: process.env.FIREBASE_PROJECT_ID!,
 *   serviceAccount: { clientEmail: process.env.FIREBASE_CLIENT_EMAIL!, privateKey: process.env.FIREBASE_PRIVATE_KEY! },
 * })
 * ```
 */
export function createFirebaseAuth<Claims extends CustomClaims = CustomClaims>(
  options: FirebaseAuthOptions,
): FirebaseAuth<Claims> {
  const cookie = resolveCookieOptions(options.cookie);
  let backend = options.backend;
  if (!backend) {
    if (!options.projectId) {
      throw new FirebaseAuthError('auth/invalid-request', 'createFirebaseAuth() needs projectId or a backend.');
    }
    backend = restBackend({
      projectId: options.projectId,
      serviceAccount: options.serviceAccount,
      emulatorHost: options.emulatorHost,
      clockToleranceSeconds: options.clockToleranceSeconds,
      fetch: options.fetch,
    });
  }
  const checkRevoked = options.checkRevoked ?? false;
  const acceptBearer = options.bearer ?? true;
  const verifyAppCheckToken = options.appCheck
    ? appCheckVerifier({projectNumber: options.appCheck.projectNumber, fetch: options.fetch})
    : undefined;
  const requireAppCheckOnLogin = options.appCheck ? (options.appCheck.requireOnLogin ?? true) : false;
  const verifier = backend;

  async function authenticate(request: Request): Promise<AuthResult<Claims>> {
    const authorization = request.headers.get('authorization');
    if (acceptBearer && authorization?.toLowerCase().startsWith('bearer ')) {
      try {
        const decoded = await verifier.verifyIdToken(authorization.slice(7).trim(), checkRevoked);
        return {user: toFirebaseUser<Claims>(decoded), source: 'bearer', error: null, clearCookie: false};
      } catch (error) {
        return {user: null, source: null, error: toAuthError(error), clearCookie: false};
      }
    }

    const sessionCookie = readCookie(request.headers.get('cookie'), cookie.name);
    if (!sessionCookie) return {user: null, source: null, error: null, clearCookie: false};
    try {
      const decoded = await verifier.verifySessionCookie(sessionCookie, checkRevoked);
      return {user: toFirebaseUser<Claims>(decoded), source: 'session-cookie', error: null, clearCookie: false};
    } catch (error) {
      const authError = toAuthError(error);
      return {user: null, source: null, error: authError, clearCookie: DEAD_COOKIE.has(authError.code)};
    }
  }

  function isAllowedOrigin(request: Request): boolean {
    const origin = request.headers.get('origin');
    if (origin) return (options.allowedOrigins ?? [new URL(request.url).origin]).includes(origin);
    // No Origin header: fall back to Fetch Metadata. Without either, refuse.
    return request.headers.get('sec-fetch-site') === 'same-origin';
  }

  function guard(request: Request): FirebaseAuthError | undefined {
    if (request.method !== 'POST') {
      return new FirebaseAuthError('auth/method-not-allowed', 'Use POST.');
    }
    if (!isAllowedOrigin(request)) {
      return new FirebaseAuthError('auth/csrf-rejected', 'The request did not come from an allowed origin.');
    }
    return undefined;
  }

  async function verifyAppCheck(request: Request): Promise<VerifiedAppCheckToken> {
    if (!verifyAppCheckToken) {
      throw new FirebaseAuthError('auth/invalid-request', 'verifyAppCheck() needs the appCheck option.');
    }
    return verifyAppCheckToken(request.headers.get(APP_CHECK_HEADER));
  }

  return {
    cookie,
    backend: verifier,
    authenticate,

    async getUser(request) {
      return (await authenticate(request)).user;
    },

    async middleware({request}) {
      const result = await authenticate(request);
      if (result.clearCookie) {
        inStartRequest(() =>
          setCookie(cookie.name, '', {
            maxAge: 0,
            expires: new Date(0),
            path: cookie.path,
            domain: cookie.domain,
            httpOnly: true,
            secure: cookie.secure,
            sameSite: cookie.sameSite,
          }),
        );
      }
      return {user: result.user};
    },

    requireUser(context, authorize) {
      const user = context?.user;
      if (!user) {
        inStartRequest(() => setResponseStatus(401));
        throw new FirebaseAuthError('auth/unauthenticated', 'Sign in first.');
      }
      if (authorize && !authorize(user)) {
        inStartRequest(() => setResponseStatus(403));
        throw new FirebaseAuthError('auth/forbidden', 'You are not allowed to do this.');
      }
      return user;
    },

    async loginHandler(request) {
      const refused = guard(request);
      if (refused) return errorResponse(refused, refused.status === 405 ? {allow: 'POST'} : undefined);
      try {
        if (requireAppCheckOnLogin) await verifyAppCheck(request);
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
          throw new FirebaseAuthError('auth/invalid-request', 'Send the ID token as application/json.');
        }
        const body = (await request.json().catch(() => null)) as {idToken?: unknown} | null;
        if (typeof body?.idToken !== 'string' || body.idToken === '') {
          throw new FirebaseAuthError('auth/invalid-request', 'The body needs an "idToken" string.');
        }
        const decoded = await verifier.verifyIdToken(body.idToken, checkRevoked);
        if (
          options.maxAuthAgeSeconds !== undefined &&
          Date.now() / 1000 - decoded.auth_time > options.maxAuthAgeSeconds
        ) {
          throw new FirebaseAuthError('auth/recent-sign-in-required', 'Sign in again to start a session.');
        }
        const sessionCookie = await verifier.createSessionCookie(body.idToken, cookie.maxAge);
        return json(200, {uid: decoded.uid}, {'set-cookie': serializeSessionCookie(sessionCookie, cookie)});
      } catch (error) {
        return errorResponse(toAuthError(error));
      }
    },

    async logoutHandler(request) {
      const refused = guard(request);
      if (refused) return errorResponse(refused, refused.status === 405 ? {allow: 'POST'} : undefined);
      const clear = {'set-cookie': clearSessionCookie(cookie)};
      const sessionCookie = readCookie(request.headers.get('cookie'), cookie.name);
      if (sessionCookie && options.revokeOnLogout) {
        let uid: string | undefined;
        try {
          uid = (await verifier.verifySessionCookie(sessionCookie, false)).uid;
        } catch {
          // An invalid or expired cookie has nothing left to revoke.
        }
        if (uid) {
          try {
            await verifier.revokeRefreshTokens(uid);
          } catch (error) {
            return errorResponse(toAuthError(error), clear);
          }
        }
      }
      return json(200, {signedOut: true}, clear);
    },

    verifyAppCheck,
  };
}
