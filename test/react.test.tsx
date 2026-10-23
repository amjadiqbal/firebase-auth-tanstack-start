// @vitest-environment jsdom
import {act, renderHook, waitFor} from '@testing-library/react';
import type {Auth, User} from 'firebase/auth';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const firebase = vi.hoisted(() => {
  let listener: ((user: unknown) => void) | undefined;
  return {
    emit: (user: unknown) => listener?.(user),
    onIdTokenChanged: vi.fn((_auth: unknown, next: (user: unknown) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    }),
    signOut: vi.fn(async () => {
      listener?.(null);
    }),
  };
});
vi.mock('firebase/auth', () => ({onIdTokenChanged: firebase.onIdTokenChanged, signOut: firebase.signOut}));

import {SessionSyncError, useFirebaseUser} from '../src/react';

const auth = {} as Auth;
const fetchMock = vi.fn<typeof fetch>();

function user(uid: string): User {
  return {uid, getIdToken: async () => `token-of-${uid}`} as unknown as User;
}

function calls() {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
    headers: init?.headers as Record<string, string>,
  }));
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response('{}', {status: 200}));
  vi.stubGlobal('fetch', fetchMock);
  firebase.signOut.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useFirebaseUser', () => {
  it('is loading until Firebase reports, then signed in', async () => {
    const {result} = renderHook(() => useFirebaseUser(auth, {serverUser: {uid: 'u1'}}));
    expect(result.current.status).toBe('loading');
    act(() => firebase.emit(user('u1')));
    expect(result.current.status).toBe('signed-in');
    expect(result.current.user?.uid).toBe('u1');
    await waitFor(() => expect(result.current.syncing).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the ID token to the login route when the server has no session, then calls onSessionChange', async () => {
    const onSessionChange = vi.fn();
    renderHook(() => useFirebaseUser(auth, {serverUser: null, onSessionChange}));
    act(() => firebase.emit(user('u1')));
    await waitFor(() => expect(onSessionChange).toHaveBeenCalledTimes(1));
    expect(calls()).toEqual([
      {url: '/api/auth/login', body: {idToken: 'token-of-u1'}, headers: {'content-type': 'application/json'}},
    ]);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({method: 'POST', credentials: 'same-origin'});
  });

  it('logs in again when the browser switches to another user', async () => {
    renderHook(() => useFirebaseUser(auth, {serverUser: {uid: 'u1'}}));
    act(() => firebase.emit(user('u2')));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(calls()[0]!.body).toEqual({idToken: 'token-of-u2'});
  });

  it('posts to the logout route when the browser is signed out but the server has a session', async () => {
    const onSessionChange = vi.fn();
    renderHook(() => useFirebaseUser(auth, {serverUser: {uid: 'u1'}, logoutUrl: '/auth/out', onSessionChange}));
    act(() => firebase.emit(null));
    await waitFor(() => expect(onSessionChange).toHaveBeenCalled());
    expect(calls().map((c) => c.url)).toEqual(['/auth/out']);
  });

  it('does nothing when both sides are signed out', async () => {
    const {result} = renderHook(() => useFirebaseUser(auth, {serverUser: null}));
    act(() => firebase.emit(null));
    expect(result.current.status).toBe('signed-out');
    await waitFor(() => expect(result.current.syncing).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renews the session when the server user goes away while the browser is signed in', async () => {
    let serverUser: {uid: string} | null = {uid: 'u1'};
    const {rerender} = renderHook(() => useFirebaseUser(auth, {serverUser}));
    act(() => firebase.emit(user('u1')));
    expect(fetchMock).not.toHaveBeenCalled();
    serverUser = null;
    rerender();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(calls()[0]!.url).toBe('/api/auth/login');
  });

  it('sends an App Check token with logins', async () => {
    renderHook(() =>
      useFirebaseUser(auth, {serverUser: null, loginUrl: '/in', getAppCheckToken: async () => 'app-check-token'}),
    );
    act(() => firebase.emit(user('u1')));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(calls()[0]!.headers['x-firebase-appcheck']).toBe('app-check-token');
  });

  it('exposes the error code of a failed login and clears it after a success', async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({error: {code: 'auth/recent-sign-in-required', message: 'Sign in again'}}), {
          status: 401,
        }),
    );
    const {result} = renderHook(() => useFirebaseUser(auth, {serverUser: null}));
    act(() => firebase.emit(user('u1')));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(SessionSyncError));
    expect(result.current.error).toMatchObject({code: 'auth/recent-sign-in-required', status: 401});
    act(() => firebase.emit(user('u1')));
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it('signOut() deletes the server session first, then signs out of Firebase, without a second logout', async () => {
    const onSessionChange = vi.fn();
    const {result} = renderHook(() => useFirebaseUser(auth, {serverUser: {uid: 'u1'}, onSessionChange}));
    act(() => firebase.emit(user('u1')));
    await act(() => result.current.signOut());
    expect(calls().map((c) => c.url)).toEqual(['/api/auth/logout']);
    expect(firebase.signOut).toHaveBeenCalledWith(auth);
    expect(onSessionChange).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('signed-out');
  });

  it('without serverUser, syncs on every load', async () => {
    renderHook(() => useFirebaseUser(auth));
    act(() => firebase.emit(null));
    await waitFor(() => expect(calls().map((c) => c.url)).toEqual(['/api/auth/logout']));
  });
});
