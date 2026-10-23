import {type Auth, signOut as firebaseSignOut, onIdTokenChanged, type User} from 'firebase/auth';
import {useCallback, useEffect, useRef, useState} from 'react';

import {customClaimsOf} from './user';

export interface UseFirebaseUserOptions {
  /**
   * The user the server rendered with (`context.user` from the root route), or `null`. The hook compares it with the
   * browser's Firebase user and only calls the server when they differ. Leave it out and the hook calls the server on
   * every page load: login when the browser is signed in, logout when it is not.
   *
   * When it has `claims` (a `FirebaseUser` does), the hook also makes a new session when the browser's ID token has
   * different custom claims, for example after `setCustomUserClaims()` and `getIdToken(true)`.
   */
  serverUser?: {uid: string; claims?: Record<string, unknown>} | null;
  /** The login route. Defaults to `/api/auth/login`. */
  loginUrl?: string;
  /** The logout route. Defaults to `/api/auth/logout`. */
  logoutUrl?: string;
  /** Called after the server session changed, for example `() => router.invalidate()` to reload `context.user`. */
  onSessionChange?: () => unknown;
  /** Returns a Firebase App Check token to send with logins (header `X-Firebase-AppCheck`). */
  getAppCheckToken?: () => Promise<string | undefined>;
}

export type FirebaseUserStatus = 'loading' | 'signed-in' | 'signed-out';

/** A failed call to the login or logout route, with the error code the route answered. */
export class SessionSyncError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'SessionSyncError';
    this.code = code;
    this.status = status;
  }
}

export interface FirebaseUserState {
  /** The browser's Firebase user, `null` while loading or when signed out. */
  user: User | null;
  /** `loading` until Firebase has restored the browser's sign-in state. */
  status: FirebaseUserStatus;
  /** `true` while the hook is calling the login or logout route. */
  syncing: boolean;
  /** The last failed login or logout call, cleared by the next successful one. */
  error: SessionSyncError | null;
  /** Deletes the server session, then signs the browser out of Firebase. */
  signOut: () => Promise<void>;
}

/** JSON with sorted keys, so two claim objects compare equal regardless of key order. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {error?: {code?: string; message?: string}} | null;
    throw new SessionSyncError(
      payload?.error?.code ?? 'auth/internal-error',
      response.status,
      payload?.error?.message ?? `${url} answered ${response.status}`,
    );
  }
}

/**
 * Keeps the server's session cookie in step with the browser's Firebase sign-in. It listens to `onIdTokenChanged`:
 * when the browser signs in as a user the server does not have, it posts the ID token to the login route; when the
 * browser signs out while the server still has a session, it posts to the logout route.
 */
export function useFirebaseUser(auth: Auth, options: UseFirebaseUserOptions = {}): FirebaseUserState {
  const {loginUrl = '/api/auth/login', logoutUrl = '/api/auth/logout'} = options;
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<FirebaseUserStatus>('loading');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<SessionSyncError | null>(null);

  // `undefined` means "unknown": the caller did not pass serverUser.
  const serverUid = useRef<string | null | undefined>(
    options.serverUser === undefined ? undefined : (options.serverUser?.uid ?? null),
  );
  // The server's custom claims as stable JSON, or undefined when serverUser has no claims.
  const serverClaims = useRef<string | undefined>(
    options.serverUser?.claims ? stableJson(options.serverUser.claims) : undefined,
  );
  const browserUser = useRef<User | null | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(options);
  latest.current = options;

  const run = useCallback((task: () => Promise<void>) => {
    const next = queue.current.then(async () => {
      setSyncing(true);
      try {
        await task();
        setError(null);
      } catch (cause) {
        setError(
          cause instanceof SessionSyncError ? cause : new SessionSyncError('auth/internal-error', 0, String(cause)),
        );
      } finally {
        setSyncing(false);
      }
    });
    queue.current = next;
    return next;
  }, []);

  const reconcile = useCallback(() => {
    const current = browserUser.current;
    if (current === undefined) return Promise.resolve();
    return run(async () => {
      if (!current) {
        if (serverUid.current !== null) {
          await post(logoutUrl, {});
          serverUid.current = null;
          serverClaims.current = undefined;
          await latest.current.onSessionChange?.();
        }
        return;
      }
      let claims: string | undefined;
      if (current.uid === serverUid.current) {
        if (serverClaims.current === undefined) return;
        claims = stableJson(customClaimsOf((await current.getIdTokenResult()).claims));
        if (claims === serverClaims.current) return;
      }
      const appCheck = await latest.current.getAppCheckToken?.();
      await post(
        loginUrl,
        {idToken: await current.getIdToken()},
        appCheck ? {'x-firebase-appcheck': appCheck} : undefined,
      );
      serverUid.current = current.uid;
      if (claims !== undefined) serverClaims.current = claims;
      await latest.current.onSessionChange?.();
    });
  }, [run, loginUrl, logoutUrl]);

  useEffect(
    () =>
      onIdTokenChanged(auth, (next) => {
        browserUser.current = next;
        setUser(next);
        setStatus(next ? 'signed-in' : 'signed-out');
        void reconcile();
      }),
    [auth, reconcile],
  );

  // The server's view changed (for example the router reloaded context.user after the cookie expired).
  const serverUserUid = options.serverUser === undefined ? undefined : (options.serverUser?.uid ?? null);
  const serverUserClaims = options.serverUser?.claims ? stableJson(options.serverUser.claims) : undefined;
  useEffect(() => {
    serverClaims.current = serverUserClaims;
  }, [serverUserClaims]);
  useEffect(() => {
    if (serverUserUid === undefined || serverUserUid === serverUid.current) return;
    serverUid.current = serverUserUid;
    void reconcile();
  }, [serverUserUid, reconcile]);

  const signOut = useCallback(async () => {
    await run(async () => {
      await post(logoutUrl, {});
      serverUid.current = null;
    });
    await firebaseSignOut(auth);
    await latest.current.onSessionChange?.();
  }, [auth, run, logoutUrl]);

  return {user, status, syncing, error, signOut};
}
