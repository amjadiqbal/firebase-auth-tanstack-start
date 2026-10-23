import {beforeEach, describe, expect, it, vi} from 'vitest';

const start = vi.hoisted(() => ({setCookie: vi.fn(), setResponseStatus: vi.fn()}));
vi.mock('@tanstack/react-start/server', () => start);

import {FirebaseAuthError} from '../src/errors';
import {createFirebaseAuth, type FirebaseAuthOptions} from '../src/firebase-auth';
import type {DecodedFirebaseToken, FirebaseAuthBackend} from '../src/types';
import {now} from './helpers';

const ORIGIN = 'https://app.example.com';

function decoded(overrides: Partial<DecodedFirebaseToken> = {}): DecodedFirebaseToken {
  const t = now();
  return {
    uid: 'user-1',
    sub: 'user-1',
    aud: 'demo',
    iss: 'x',
    iat: t,
    exp: t + 3600,
    auth_time: t - 10,
    email: 'ada@example.com',
    email_verified: true,
    firebase: {sign_in_provider: 'password'},
    role: 'admin',
    ...overrides,
  };
}

/** A backend that knows the tokens "good-id", "good-cookie", and fails others with the given codes. */
function fakeBackend(overrides: Partial<FirebaseAuthBackend> = {}) {
  const backend = {
    verifyIdToken: vi.fn(async (token: string) => {
      if (token === 'good-id') return decoded();
      if (token === 'old-id') return decoded({auth_time: now() - 3600});
      throw new FirebaseAuthError('auth/invalid-id-token', 'bad id token');
    }),
    verifySessionCookie: vi.fn(async (cookie: string) => {
      if (cookie === 'good-cookie') return decoded();
      if (cookie === 'network') throw new FirebaseAuthError('auth/internal-error', 'down');
      throw new FirebaseAuthError('auth/session-cookie-expired', 'expired');
    }),
    createSessionCookie: vi.fn(async () => 'good-cookie'),
    revokeRefreshTokens: vi.fn(async () => {}),
    ...overrides,
  };
  return backend;
}

function setup(options: Partial<FirebaseAuthOptions> = {}, backend = fakeBackend()) {
  return {backend, auth: createFirebaseAuth<{role?: string}>({backend, ...options})};
}

function request(path: string, init: RequestInit & {headers?: Record<string, string>} = {}) {
  return new Request(`${ORIGIN}${path}`, init);
}

function login(body: unknown, headers: Record<string, string> = {}) {
  return request('/api/auth/login', {
    method: 'POST',
    headers: {origin: ORIGIN, 'content-type': 'application/json', ...headers},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  start.setCookie.mockReset();
  start.setResponseStatus.mockReset();
});

describe('authenticate', () => {
  it('returns no user and no error when nothing is sent', async () => {
    const {auth} = setup();
    expect(await auth.authenticate(request('/'))).toEqual({user: null, source: null, error: null, clearCookie: false});
  });

  it('reads the __session cookie and maps the claims to a user with custom claims', async () => {
    const {auth} = setup();
    const result = await auth.authenticate(request('/', {headers: {cookie: 'a=1; __session=good-cookie; b=2'}}));
    expect(result.source).toBe('session-cookie');
    expect(result.user).toMatchObject({
      uid: 'user-1',
      email: 'ada@example.com',
      emailVerified: true,
      signInProvider: 'password',
      claims: {role: 'admin'},
    });
    expect(result.user?.claims).not.toHaveProperty('email');
  });

  it('prefers a bearer ID token, and reports a bad one without falling back to the cookie', async () => {
    const {auth} = setup();
    const good = await auth.authenticate(request('/', {headers: {authorization: 'Bearer good-id'}}));
    expect(good.source).toBe('bearer');
    const bad = await auth.authenticate(
      request('/', {headers: {authorization: 'Bearer nope', cookie: '__session=good-cookie'}}),
    );
    expect(bad.user).toBeNull();
    expect(bad.error?.code).toBe('auth/invalid-id-token');
  });

  it('ignores bearer tokens with bearer: false', async () => {
    const {auth} = setup({bearer: false});
    const result = await auth.authenticate(request('/', {headers: {authorization: 'Bearer good-id'}}));
    expect(result.user).toBeNull();
    expect(result.error).toBeNull();
  });

  it('marks dead cookies for deletion but keeps a cookie that failed for a network reason', async () => {
    const {auth} = setup();
    const expired = await auth.authenticate(request('/', {headers: {cookie: '__session=old'}}));
    expect(expired).toMatchObject({user: null, clearCookie: true});
    expect(expired.error?.code).toBe('auth/session-cookie-expired');
    const network = await auth.authenticate(request('/', {headers: {cookie: '__session=network'}}));
    expect(network).toMatchObject({user: null, clearCookie: false});
  });

  it('passes checkRevoked to the backend', async () => {
    const {auth, backend} = setup({checkRevoked: true});
    await auth.getUser(request('/', {headers: {cookie: '__session=good-cookie'}}));
    expect(backend.verifySessionCookie).toHaveBeenCalledWith('good-cookie', true);
  });

  it('uses a custom cookie name', async () => {
    const {auth} = setup({cookie: {name: 'sid'}});
    expect(await auth.getUser(request('/', {headers: {cookie: '__session=good-cookie'}}))).toBeNull();
    expect(await auth.getUser(request('/', {headers: {cookie: 'sid=good-cookie'}}))).not.toBeNull();
  });
});

describe('middleware', () => {
  it('returns { user } and deletes a dead cookie through Start', async () => {
    const {auth} = setup();
    expect(
      (await auth.middleware({request: request('/', {headers: {cookie: '__session=good-cookie'}})})).user?.uid,
    ).toBe('user-1');
    expect(start.setCookie).not.toHaveBeenCalled();
    expect(await auth.middleware({request: request('/', {headers: {cookie: '__session=old'}})})).toEqual({user: null});
    expect(start.setCookie).toHaveBeenCalledWith('__session', '', {
      maxAge: 0,
      expires: new Date(0),
      path: '/',
      domain: undefined,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    });
  });
});

describe('requireUser', () => {
  it('returns the user, or throws 401 / 403 errors and sets the response status', () => {
    const {auth} = setup();
    const user = {uid: 'u', claims: {role: 'admin'}} as never;
    expect(auth.requireUser({user})).toBe(user);
    expect(() => auth.requireUser({user: null})).toThrowError(
      expect.objectContaining({code: 'auth/unauthenticated', status: 401}),
    );
    expect(start.setResponseStatus).toHaveBeenCalledWith(401);
    expect(() => auth.requireUser({user}, (u) => u.claims.role === 'owner')).toThrowError(
      expect.objectContaining({code: 'auth/forbidden', status: 403}),
    );
    expect(start.setResponseStatus).toHaveBeenCalledWith(403);
  });

  it('still throws when no Start request is active', () => {
    start.setResponseStatus.mockImplementation(() => {
      throw new Error('no event');
    });
    const {auth} = setup();
    expect(() => auth.requireUser(undefined)).toThrowError(expect.objectContaining({code: 'auth/unauthenticated'}));
  });
});

describe('loginHandler', () => {
  it('exchanges the ID token for an HttpOnly, Secure, SameSite=Lax session cookie', async () => {
    const {auth, backend} = setup();
    const response = await auth.loginHandler(login({idToken: 'good-id'}));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({uid: 'user-1'});
    expect(response.headers.get('set-cookie')).toBe(
      '__session=good-cookie; Max-Age=432000; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backend.createSessionCookie).toHaveBeenCalledWith('good-id', 432000);
  });

  it('applies cookie options', async () => {
    const {auth} = setup({
      cookie: {name: 'sid', maxAge: 3600, secure: false, sameSite: 'strict', domain: 'example.com'},
    });
    const response = await auth.loginHandler(login({idToken: 'good-id'}));
    expect(response.headers.get('set-cookie')).toBe(
      'sid=good-cookie; Max-Age=3600; Path=/; HttpOnly; Domain=example.com; SameSite=Strict',
    );
  });

  it.each([
    ['GET', request('/api/auth/login', {headers: {origin: ORIGIN}}), 405, 'auth/method-not-allowed'],
    ['another origin', login({idToken: 'good-id'}, {origin: 'https://evil.example'}), 403, 'auth/csrf-rejected'],
    [
      'no Origin and a cross-site Sec-Fetch-Site',
      request('/api/auth/login', {
        method: 'POST',
        headers: {'sec-fetch-site': 'cross-site', 'content-type': 'application/json'},
        body: '{"idToken":"good-id"}',
      }),
      403,
      'auth/csrf-rejected',
    ],
    [
      'no Origin and no Sec-Fetch-Site',
      request('/api/auth/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'}),
      403,
      'auth/csrf-rejected',
    ],
    [
      'a form body',
      login('idToken=good-id', {'content-type': 'application/x-www-form-urlencoded'}),
      400,
      'auth/invalid-request',
    ],
    ['invalid JSON', login('{'), 400, 'auth/invalid-request'],
    ['no idToken', login({}), 400, 'auth/invalid-request'],
    ['a bad ID token', login({idToken: 'nope'}), 401, 'auth/invalid-id-token'],
  ])('refuses %s', async (_, req, status, code) => {
    const {auth, backend} = setup();
    const response = await auth.loginHandler(req);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(backend.createSessionCookie).not.toHaveBeenCalled();
    if (status === 405) expect(response.headers.get('allow')).toBe('POST');
  });

  it('accepts a same-origin Sec-Fetch-Site without Origin, and allowedOrigins', async () => {
    const {auth} = setup();
    const noOrigin = request('/api/auth/login', {
      method: 'POST',
      headers: {'sec-fetch-site': 'same-origin', 'content-type': 'application/json'},
      body: '{"idToken":"good-id"}',
    });
    expect((await auth.loginHandler(noOrigin)).status).toBe(200);
    const proxied = setup({allowedOrigins: ['https://public.example']}).auth;
    expect((await proxied.loginHandler(login({idToken: 'good-id'}, {origin: 'https://public.example'}))).status).toBe(
      200,
    );
    expect((await proxied.loginHandler(login({idToken: 'good-id'}))).status).toBe(403);
  });

  it('enforces maxAuthAgeSeconds', async () => {
    const {auth} = setup({maxAuthAgeSeconds: 300});
    expect((await auth.loginHandler(login({idToken: 'good-id'}))).status).toBe(200);
    const old = await auth.loginHandler(login({idToken: 'old-id'}));
    expect(old.status).toBe(401);
    expect((await old.json()).error.code).toBe('auth/recent-sign-in-required');
  });

  it('answers 500 auth/internal-error for unexpected backend failures', async () => {
    const {auth} = setup(
      {},
      fakeBackend({
        createSessionCookie: async () => {
          throw new Error('boom');
        },
      }),
    );
    const response = await auth.loginHandler(login({idToken: 'good-id'}));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toEqual({code: 'auth/internal-error', message: 'boom'});
  });

  it('requires an App Check token when appCheck is set', async () => {
    const fetch = vi.fn(async () => new Response('{"keys":[]}'));
    const {auth} = setup({appCheck: {projectNumber: '123'}, fetch});
    const missing = await auth.loginHandler(login({idToken: 'good-id'}));
    expect(missing.status).toBe(401);
    expect((await missing.json()).error.code).toBe('app-check/missing-token');
    const invalid = await auth.loginHandler(login({idToken: 'good-id'}, {'x-firebase-appcheck': 'garbage'}));
    expect((await invalid.json()).error.code).toBe('app-check/invalid-token');
    // Checked before the body is read.
    const badBody = await auth.loginHandler(login({}));
    expect((await badBody.json()).error.code).toBe('app-check/missing-token');
    const optional = setup({appCheck: {projectNumber: '123', requireOnLogin: false}, fetch}).auth;
    expect((await optional.loginHandler(login({idToken: 'good-id'}))).status).toBe(200);
  });
});

describe('logoutHandler', () => {
  function logout(cookie?: string, headers: Record<string, string> = {}) {
    return request('/api/auth/logout', {
      method: 'POST',
      headers: {origin: ORIGIN, ...(cookie ? {cookie: `__session=${cookie}`} : {}), ...headers},
    });
  }

  it('deletes the cookie and does not revoke by default', async () => {
    const {auth, backend} = setup();
    const response = await auth.logoutHandler(logout('good-cookie'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({signedOut: true});
    expect(response.headers.get('set-cookie')).toContain('__session=; Max-Age=0');
    expect(backend.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('revokes with revokeOnLogout, skips revoking for a dead cookie, and reports a failed revoke', async () => {
    const {auth, backend} = setup({revokeOnLogout: true});
    await auth.logoutHandler(logout('good-cookie'));
    expect(backend.revokeRefreshTokens).toHaveBeenCalledWith('user-1');
    vi.mocked(backend.revokeRefreshTokens).mockClear();
    expect((await auth.logoutHandler(logout('expired'))).status).toBe(200);
    expect(backend.revokeRefreshTokens).not.toHaveBeenCalled();
    vi.mocked(backend.revokeRefreshTokens).mockRejectedValueOnce(
      new FirebaseAuthError('auth/credential-required', 'no sa'),
    );
    const failed = await auth.logoutHandler(logout('good-cookie'));
    expect(failed.status).toBe(500);
    expect(failed.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('refuses cross-site logouts', async () => {
    const {auth} = setup();
    const response = await auth.logoutHandler(logout('good-cookie', {origin: 'https://evil.example'}));
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('options', () => {
  it('validates cookie settings and needs a projectId or backend', () => {
    expect(() => createFirebaseAuth({backend: fakeBackend(), cookie: {maxAge: 60}})).toThrow(RangeError);
    expect(() => createFirebaseAuth({backend: fakeBackend(), cookie: {maxAge: 15 * 86400}})).toThrow(RangeError);
    expect(() => createFirebaseAuth({backend: fakeBackend(), cookie: {sameSite: 'none', secure: false}})).toThrow(
      RangeError,
    );
    expect(() => createFirebaseAuth({backend: fakeBackend(), cookie: {name: 'bad name'}})).toThrow(RangeError);
    expect(() => createFirebaseAuth({})).toThrow(FirebaseAuthError);
    expect(createFirebaseAuth({projectId: 'demo'}).cookie.name).toBe('__session');
  });

  it('verifyAppCheck needs the appCheck option', async () => {
    const {auth} = setup();
    await expect(auth.verifyAppCheck(request('/'))).rejects.toMatchObject({code: 'auth/invalid-request'});
  });
});
