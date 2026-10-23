import {decodeJwt, importSPKI, jwtVerify} from 'jose';
import {beforeAll, describe, expect, it, vi} from 'vitest';

import {FirebaseAuthError} from '../src/errors';
import {ID_TOKEN_CERTS_URL, restBackend, SESSION_COOKIE_CERTS_URL} from '../src/rest-backend';
import {
  type Call,
  fakeFetch,
  idTokenClaims,
  jsonResponse,
  makeKey,
  now,
  PROJECT_ID,
  serviceAccountPem,
  sessionClaims,
  sign,
  type TestKey,
  unsigned,
} from './helpers';

let google: TestKey;
let other: TestKey;

beforeAll(async () => {
  google = await makeKey('google-1');
  other = await makeKey('other-1');
});

function certs(maxAge = 3600) {
  return () => jsonResponse({[google.kid]: google.certPem}, {headers: {'cache-control': `public, max-age=${maxAge}`}});
}

function backendWithCerts(extra: Record<string, (call: Call) => Response | Promise<Response>> = {}) {
  const fetch = fakeFetch({[ID_TOKEN_CERTS_URL]: certs(), [SESSION_COOKIE_CERTS_URL]: certs(), ...extra});
  return {fetch, backend: restBackend({projectId: PROJECT_ID, fetch})};
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(FirebaseAuthError);
    return (error as FirebaseAuthError).code;
  }
  throw new Error('expected a rejection');
}

describe('restBackend: ID tokens', () => {
  it('verifies a token signed by a Google key and returns the claims with uid', async () => {
    const {backend} = backendWithCerts();
    const decoded = await backend.verifyIdToken(await sign(google, idTokenClaims({role: 'admin'})), false);
    expect(decoded.uid).toBe('user-1');
    expect(decoded.email).toBe('ada@example.com');
    expect(decoded.role).toBe('admin');
  });

  it.each([
    ['wrong audience', {aud: 'other-project'}],
    ['wrong issuer', {iss: 'https://securetoken.google.com/other-project'}],
    ['session cookie issuer', {iss: `https://session.firebase.google.com/${PROJECT_ID}`}],
    ['empty subject', {sub: ''}],
    ['subject over 128 characters', {sub: 'x'.repeat(129)}],
    ['auth_time in the future', {auth_time: now() + 600}],
    ['iat in the future', {iat: now() + 600}],
  ])('refuses a token with %s as auth/invalid-id-token', async (_, overrides) => {
    const {backend} = backendWithCerts();
    expect(await codeOf(backend.verifyIdToken(await sign(google, idTokenClaims(overrides)), false))).toBe(
      'auth/invalid-id-token',
    );
  });

  it('refuses an expired token as auth/id-token-expired', async () => {
    const {backend} = backendWithCerts();
    const token = await sign(google, idTokenClaims({iat: now() - 7200, exp: now() - 3600}));
    expect(await codeOf(backend.verifyIdToken(token, false))).toBe('auth/id-token-expired');
  });

  it('allows clock skew with clockToleranceSeconds', async () => {
    const fetch = fakeFetch({[ID_TOKEN_CERTS_URL]: certs()});
    const backend = restBackend({projectId: PROJECT_ID, fetch, clockToleranceSeconds: 60});
    const token = await sign(google, idTokenClaims({exp: now() - 30, iat: now() + 30}));
    await expect(backend.verifyIdToken(token, false)).resolves.toMatchObject({uid: 'user-1'});
  });

  it('refuses a bad signature, an unknown kid, a missing kid, another algorithm and garbage', async () => {
    const {backend} = backendWithCerts();
    const forged = await sign(other, idTokenClaims(), {kid: google.kid});
    expect(await codeOf(backend.verifyIdToken(forged, false))).toBe('auth/invalid-id-token');
    expect(await codeOf(backend.verifyIdToken(await sign(other, idTokenClaims()), false))).toBe(
      'auth/invalid-id-token',
    );
    expect(await codeOf(backend.verifyIdToken(await sign(google, idTokenClaims(), {kid: undefined}), false))).toBe(
      'auth/invalid-id-token',
    );
    expect(await codeOf(backend.verifyIdToken(unsigned(idTokenClaims()), false))).toBe('auth/invalid-id-token');
    expect(await codeOf(backend.verifyIdToken('not-a-jwt', false))).toBe('auth/invalid-id-token');
    expect(await codeOf(backend.verifyIdToken('', false))).toBe('auth/invalid-id-token');
  });

  it('caches Google keys for the Cache-Control max-age and fetches again after it', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    try {
      const fetch = fakeFetch({[ID_TOKEN_CERTS_URL]: certs(100)});
      const backend = restBackend({projectId: PROJECT_ID, fetch});
      await backend.verifyIdToken(await sign(google, idTokenClaims()), false);
      await backend.verifyIdToken(await sign(google, idTokenClaims()), false);
      expect(fetch.calls).toHaveLength(1);
      vi.setSystemTime(Date.now() + 101_000);
      await backend.verifyIdToken(await sign(google, idTokenClaims()), false);
      expect(fetch.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('downloads the keys again for an unknown kid (Google rotated them), at most once a minute', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    try {
      let rotated = false;
      const fetch = fakeFetch({
        [ID_TOKEN_CERTS_URL]: () =>
          jsonResponse(rotated ? {[other.kid]: other.certPem} : {[google.kid]: google.certPem}, {
            headers: {'cache-control': 'max-age=3600'},
          }),
      });
      const backend = restBackend({projectId: PROJECT_ID, fetch});
      await backend.verifyIdToken(await sign(google, idTokenClaims()), false);
      rotated = true;
      const rotatedToken = await sign(other, idTokenClaims());
      // Within a minute of the last download: refused without asking Google again.
      expect(await codeOf(backend.verifyIdToken(rotatedToken, false))).toBe('auth/invalid-id-token');
      expect(fetch.calls).toHaveLength(1);
      vi.setSystemTime(Date.now() + 61_000);
      await expect(backend.verifyIdToken(rotatedToken, false)).resolves.toMatchObject({uid: 'user-1'});
      expect(fetch.calls).toHaveLength(2);
      // A kid that is still unknown right after that download is refused without another one.
      expect(await codeOf(backend.verifyIdToken(await sign(google, idTokenClaims()), false))).toBe(
        'auth/invalid-id-token',
      );
      expect(fetch.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fetches the keys on every check when Google sends no max-age', async () => {
    const fetch = fakeFetch({[ID_TOKEN_CERTS_URL]: () => jsonResponse({[google.kid]: google.certPem})});
    const backend = restBackend({projectId: PROJECT_ID, fetch});
    await backend.verifyIdToken(await sign(google, idTokenClaims()), false);
    await backend.verifyIdToken(await sign(google, idTokenClaims()), false);
    expect(fetch.calls).toHaveLength(2);
  });

  it('reports a failed key download as auth/internal-error and retries next time', async () => {
    let fail = true;
    const fetch = fakeFetch({
      [ID_TOKEN_CERTS_URL]: () => (fail ? new Response('down', {status: 503}) : certs()()),
    });
    const backend = restBackend({projectId: PROJECT_ID, fetch});
    const token = await sign(google, idTokenClaims());
    expect(await codeOf(backend.verifyIdToken(token, false))).toBe('auth/internal-error');
    fail = false;
    await expect(backend.verifyIdToken(token, false)).resolves.toMatchObject({uid: 'user-1'});
  });
});

describe('restBackend: session cookies', () => {
  it('verifies a session cookie against the session cookie keys and issuer', async () => {
    const {backend, fetch} = backendWithCerts();
    await expect(backend.verifySessionCookie(await sign(google, sessionClaims()), false)).resolves.toMatchObject({
      uid: 'user-1',
    });
    expect(fetch.calls.map((c) => c.url)).toEqual([SESSION_COOKIE_CERTS_URL]);
  });

  it('refuses an ID token passed as a session cookie, and an expired cookie', async () => {
    const {backend} = backendWithCerts();
    expect(await codeOf(backend.verifySessionCookie(await sign(google, idTokenClaims()), false))).toBe(
      'auth/invalid-session-cookie',
    );
    expect(await codeOf(backend.verifySessionCookie(await sign(google, sessionClaims({exp: now() - 1})), false))).toBe(
      'auth/session-cookie-expired',
    );
  });
});

describe('restBackend: Identity Toolkit calls with a service account', () => {
  async function setup(lookup: unknown = {users: [{localId: 'user-1'}]}) {
    const pem = await serviceAccountPem();
    const api = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}`;
    const fetch = fakeFetch({
      [SESSION_COOKIE_CERTS_URL]: certs(),
      [ID_TOKEN_CERTS_URL]: certs(),
      'https://oauth2.googleapis.com/token': () => jsonResponse({access_token: 'ya29.test', expires_in: 3600}),
      [`${api}:createSessionCookie`]: () => jsonResponse({sessionCookie: 'cookie-value'}),
      [`${api}/accounts:lookup`]: () => jsonResponse(lookup),
      [`${api}/accounts:update`]: () => jsonResponse({localId: 'user-1'}),
    });
    const backend = restBackend({
      projectId: PROJECT_ID,
      fetch,
      serviceAccount: {clientEmail: 'sa@demo-project.iam.gserviceaccount.com', privateKey: pem.replace(/\n/g, '\\n')},
    });
    return {backend, fetch, pem, api};
  }

  it('creates a session cookie with a signed service account assertion and caches the access token', async () => {
    const {backend, fetch, api} = await setup();
    expect(await backend.createSessionCookie('id-token', 600)).toBe('cookie-value');
    await backend.createSessionCookie('id-token', 600);

    const tokenCalls = fetch.calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token');
    expect(tokenCalls).toHaveLength(1);
    const form = new URLSearchParams(String(tokenCalls[0]!.init?.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const assertion = decodeJwt(form.get('assertion')!);
    expect(assertion).toMatchObject({
      iss: 'sa@demo-project.iam.gserviceaccount.com',
      aud: 'https://oauth2.googleapis.com/token',
    });
    expect(String(assertion.scope)).toContain('https://www.googleapis.com/auth/identitytoolkit');

    const create = fetch.calls.find((c) => c.url === `${api}:createSessionCookie`)!;
    expect(new Headers(create.init?.headers).get('authorization')).toBe('Bearer ya29.test');
    expect(JSON.parse(String(create.init?.body))).toEqual({idToken: 'id-token', validDuration: 600});
  });

  it('signs the assertion with the service account key', async () => {
    const {backend, fetch, pem} = await setup();
    await backend.createSessionCookie('id-token', 600);
    const form = new URLSearchParams(String(fetch.calls.find((c) => c.url.includes('oauth2'))!.init?.body));
    const {createPublicKey} = await import('node:crypto');
    const spki = createPublicKey(pem).export({type: 'spki', format: 'pem'}).toString();
    await expect(jwtVerify(form.get('assertion')!, await importSPKI(spki, 'RS256'))).resolves.toBeTruthy();
  });

  it('revokes by setting validSince to now', async () => {
    const {backend, fetch, api} = await setup();
    await backend.revokeRefreshTokens('user-1');
    const body = JSON.parse(String(fetch.calls.find((c) => c.url === `${api}/accounts:update`)!.init?.body));
    expect(body.localId).toBe('user-1');
    expect(Math.abs(body.validSince - now())).toBeLessThanOrEqual(2);
  });

  it('checkRevoked: passes, then refuses revoked, disabled and deleted users', async () => {
    const cookie = async () => sign(google, sessionClaims({auth_time: now() - 100}));
    await expect((await setup()).backend.verifySessionCookie(await cookie(), true)).resolves.toBeTruthy();
    const revoked = await setup({users: [{localId: 'user-1', validSince: String(now() - 50)}]});
    expect(await codeOf(revoked.backend.verifySessionCookie(await cookie(), true))).toBe('auth/session-cookie-revoked');
    const idRevoked = await setup({users: [{localId: 'user-1', validSince: String(now())}]});
    expect(await codeOf(idRevoked.backend.verifyIdToken(await sign(google, idTokenClaims()), true))).toBe(
      'auth/id-token-revoked',
    );
    const disabled = await setup({users: [{localId: 'user-1', disabled: true}]});
    expect(await codeOf(disabled.backend.verifySessionCookie(await cookie(), true))).toBe('auth/user-disabled');
    const gone = await setup({});
    expect(await codeOf(gone.backend.verifySessionCookie(await cookie(), true))).toBe('auth/user-not-found');
  });

  it('maps Identity Toolkit errors', async () => {
    const api = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}`;
    const fetch = fakeFetch({
      'https://oauth2.googleapis.com/token': () => jsonResponse({access_token: 't', expires_in: 3600}),
      [`${api}:createSessionCookie`]: () => jsonResponse({error: {message: 'INVALID_ID_TOKEN'}}, {status: 400}),
      [`${api}/accounts:update`]: () => jsonResponse({error: {message: 'QUOTA_EXCEEDED'}}, {status: 429}),
    });
    const backend = restBackend({
      projectId: PROJECT_ID,
      fetch,
      serviceAccount: {clientEmail: 'sa@x', privateKey: await serviceAccountPem()},
    });
    expect(await codeOf(backend.createSessionCookie('bad', 600))).toBe('auth/invalid-id-token');
    expect(await codeOf(backend.revokeRefreshTokens('user-1'))).toBe('auth/internal-error');
  });

  it('without a service account, refuses calls that need one with auth/credential-required', async () => {
    const {backend} = backendWithCerts();
    expect(await codeOf(backend.createSessionCookie('id-token', 600))).toBe('auth/credential-required');
    expect(await codeOf(backend.revokeRefreshTokens('user-1'))).toBe('auth/credential-required');
    expect(await codeOf(backend.verifySessionCookie(await sign(google, sessionClaims()), true))).toBe(
      'auth/credential-required',
    );
  });
});

describe('restBackend: Auth Emulator', () => {
  const host = '127.0.0.1:9099';
  const api = `http://${host}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}`;

  it('accepts unsigned tokens, checks claims, and always looks the user up with the owner token', async () => {
    const fetch = fakeFetch({[`${api}/accounts:lookup`]: () => jsonResponse({users: [{localId: 'user-1'}]})});
    const backend = restBackend({projectId: PROJECT_ID, emulatorHost: host, fetch});
    await expect(backend.verifyIdToken(unsigned(idTokenClaims()), false)).resolves.toMatchObject({uid: 'user-1'});
    expect(fetch.calls).toHaveLength(1);
    expect(new Headers(fetch.calls[0]!.init?.headers).get('authorization')).toBe('Bearer owner');
    expect(await codeOf(backend.verifyIdToken(unsigned(idTokenClaims({aud: 'x'})), false))).toBe(
      'auth/invalid-id-token',
    );
    expect(await codeOf(backend.verifySessionCookie(unsigned(sessionClaims({exp: now() - 5})), false))).toBe(
      'auth/session-cookie-expired',
    );
  });

  it('refuses signed tokens in emulator mode', async () => {
    const backend = restBackend({projectId: PROJECT_ID, emulatorHost: host, fetch: fakeFetch({})});
    expect(await codeOf(backend.verifyIdToken(await sign(google, idTokenClaims()), false))).toBe(
      'auth/invalid-id-token',
    );
  });

  it('creates session cookies on the emulator without a service account', async () => {
    const fetch = fakeFetch({[`${api}:createSessionCookie`]: () => jsonResponse({sessionCookie: 'emulated'})});
    const backend = restBackend({projectId: PROJECT_ID, emulatorHost: host, fetch});
    expect(await backend.createSessionCookie('id-token', 300)).toBe('emulated');
  });

  it('needs a projectId', () => {
    expect(() => restBackend({projectId: ''})).toThrow(FirebaseAuthError);
  });
});
