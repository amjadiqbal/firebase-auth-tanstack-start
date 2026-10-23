import {getApps, initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {describe, expect, it} from 'vitest';

import {firebaseAdminBackend} from '../../src/admin';
import {FirebaseAuthError} from '../../src/errors';
import {restBackend} from '../../src/rest-backend';
import type {FirebaseAuthBackend} from '../../src/types';

const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT ?? 'demo-fats-ci';
if (!host) throw new Error('Run with scripts/test-emulator.sh (FIREBASE_AUTH_EMULATOR_HOST is not set).');

const api = `http://${host}/identitytoolkit.googleapis.com/v1`;

async function call(path: string, body: unknown, owner = false) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...(owner ? {authorization: 'Bearer owner'} : {})},
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(json));
  return json as Record<string, string>;
}

/** A new user signed in through the emulator's REST API, as the Firebase JS SDK does. */
async function signUp() {
  const email = `u${Math.random().toString(36).slice(2)}@example.com`;
  const result = await call('/accounts:signUp?key=demo-key', {email, password: 'secret123', returnSecureToken: true});
  return {uid: result.localId as string, idToken: result.idToken as string, email};
}

const updateUser = (body: Record<string, unknown>) => call(`/projects/${projectId}/accounts:update`, body, true);

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(FirebaseAuthError);
    return (error as FirebaseAuthError).code;
  }
  throw new Error('expected a rejection');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const backends: [string, () => FirebaseAuthBackend][] = [
  ['restBackend', () => restBackend({projectId, emulatorHost: host})],
  ['firebaseAdminBackend', () => firebaseAdminBackend(getAuth(getApps()[0] ?? initializeApp({projectId})))],
];

describe.each(backends)('%s against the Auth Emulator', (_, make) => {
  const backend = make();

  it('verifies an ID token, makes a session cookie from it and verifies the cookie', async () => {
    const user = await signUp();
    expect((await backend.verifyIdToken(user.idToken, false)).uid).toBe(user.uid);
    const cookie = await backend.createSessionCookie(user.idToken, 300);
    const decoded = await backend.verifySessionCookie(cookie, false);
    expect(decoded.uid).toBe(user.uid);
    expect(decoded.email).toBe(user.email);
    expect(decoded.iss).toBe(`https://session.firebase.google.com/${projectId}`);
  });

  it('carries custom claims into the session cookie', async () => {
    const user = await signUp();
    await updateUser({localId: user.uid, customAttributes: JSON.stringify({role: 'admin'})});
    const fresh = await call('/accounts:signInWithPassword?key=demo-key', {
      email: user.email,
      password: 'secret123',
      returnSecureToken: true,
    });
    const cookie = await backend.createSessionCookie(fresh.idToken as string, 300);
    expect((await backend.verifySessionCookie(cookie, false)).role).toBe('admin');
  });

  it('refuses a revoked cookie after revokeRefreshTokens', async () => {
    const user = await signUp();
    const cookie = await backend.createSessionCookie(user.idToken, 300);
    await sleep(1100); // validSince has one-second resolution
    await backend.revokeRefreshTokens(user.uid);
    expect(await codeOf(backend.verifySessionCookie(cookie, true))).toBe('auth/session-cookie-revoked');
    expect(await codeOf(backend.verifyIdToken(user.idToken, true))).toBe('auth/id-token-revoked');
  });

  it('refuses disabled and deleted users', async () => {
    const disabled = await signUp();
    const cookie = await backend.createSessionCookie(disabled.idToken, 300);
    await updateUser({localId: disabled.uid, disableUser: true});
    expect(await codeOf(backend.verifySessionCookie(cookie, true))).toBe('auth/user-disabled');

    const deleted = await signUp();
    const deletedCookie = await backend.createSessionCookie(deleted.idToken, 300);
    await call(`/projects/${projectId}/accounts:delete`, {localId: deleted.uid}, true);
    expect(await codeOf(backend.verifySessionCookie(deletedCookie, true))).toBe('auth/user-not-found');
  });

  it('refuses garbage and refuses to make a cookie from it', async () => {
    expect(await codeOf(backend.verifyIdToken('garbage', false))).toBe('auth/invalid-id-token');
    expect(await codeOf(backend.verifySessionCookie('garbage', false))).toBe('auth/invalid-session-cookie');
    expect(await codeOf(backend.createSessionCookie('garbage', 300))).toBe('auth/invalid-id-token');
  });
});
