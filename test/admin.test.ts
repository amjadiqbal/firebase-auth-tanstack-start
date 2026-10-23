import type {Auth} from 'firebase-admin/auth';
import {describe, expect, it, vi} from 'vitest';

import {firebaseAdminBackend} from '../src/admin';

function adminError(code: string) {
  return Object.assign(new Error(code), {code});
}

function fakeAuth(overrides: Record<string, unknown> = {}) {
  return {
    verifyIdToken: vi.fn(async () => ({uid: 'user-1', sub: 'user-1'})),
    verifySessionCookie: vi.fn(async () => ({uid: 'user-1', sub: 'user-1'})),
    createSessionCookie: vi.fn(async () => 'cookie'),
    revokeRefreshTokens: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('firebaseAdminBackend', () => {
  it('calls the Admin SDK with the same arguments, converting seconds to milliseconds', async () => {
    const auth = fakeAuth();
    const backend = firebaseAdminBackend(auth as unknown as Auth);
    await backend.verifyIdToken('id', true);
    expect(auth.verifyIdToken).toHaveBeenCalledWith('id', true);
    await backend.verifySessionCookie('cookie', false);
    expect(auth.verifySessionCookie).toHaveBeenCalledWith('cookie', false);
    expect(await backend.createSessionCookie('id', 300)).toBe('cookie');
    expect(auth.createSessionCookie).toHaveBeenCalledWith('id', {expiresIn: 300_000});
    await backend.revokeRefreshTokens('user-1');
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('user-1');
  });

  it('maps Admin SDK error codes', async () => {
    const backend = firebaseAdminBackend(
      fakeAuth({
        verifyIdToken: vi.fn(async (token: string) => {
          throw adminError(token);
        }),
        verifySessionCookie: vi.fn(async (cookie: string) => {
          throw adminError(cookie);
        }),
        revokeRefreshTokens: vi.fn(async () => {
          throw new Error('network');
        }),
      }) as unknown as Auth,
    );
    await expect(backend.verifyIdToken('auth/id-token-expired', false)).rejects.toMatchObject({
      code: 'auth/id-token-expired',
    });
    await expect(backend.verifyIdToken('auth/argument-error', false)).rejects.toMatchObject({
      code: 'auth/invalid-id-token',
    });
    await expect(backend.verifySessionCookie('auth/argument-error', false)).rejects.toMatchObject({
      code: 'auth/invalid-session-cookie',
    });
    await expect(backend.verifySessionCookie('auth/session-cookie-revoked', true)).rejects.toMatchObject({
      code: 'auth/session-cookie-revoked',
    });
    await expect(backend.verifySessionCookie('auth/user-disabled', true)).rejects.toMatchObject({
      code: 'auth/user-disabled',
    });
    await expect(backend.revokeRefreshTokens('u')).rejects.toMatchObject({code: 'auth/internal-error'});
  });
});
