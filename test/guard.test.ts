import {isRedirect} from '@tanstack/react-router';
import {describe, expect, it} from 'vitest';

import {requireAuth} from '../src/guard';

const location = {href: '/dashboard?tab=2'};

function thrown(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('requireAuth', () => {
  it('returns { user } for a signed-in user', () => {
    const user = {uid: 'u1'};
    expect(requireAuth({redirectTo: '/login'})({context: {user}, location})).toEqual({user});
  });

  it('redirects signed-out visitors with the page they wanted', () => {
    const error = thrown(() => requireAuth({redirectTo: '/login'})({context: {user: null}, location})) as {
      options: {to: string; search: unknown};
    };
    expect(isRedirect(error)).toBe(true);
    expect(error.options.to).toBe('/login');
    expect(error.options.search).toEqual({redirect: '/dashboard?tab=2'});
  });

  it('uses a custom search parameter, or none', () => {
    const named = thrown(() => requireAuth({redirectTo: '/login', searchParam: 'next'})({context: {}, location})) as {
      options: {search: unknown};
    };
    expect(named.options.search).toEqual({next: '/dashboard?tab=2'});
    const none = thrown(() => requireAuth({redirectTo: '/login', searchParam: false})({context: {}, location})) as {
      options: {search: unknown};
    };
    expect(none.options.search).toBeUndefined();
  });

  it('refuses users that authorize rejects: redirect with forbiddenTo, else auth/forbidden', () => {
    const user = {uid: 'u1', claims: {role: 'viewer'}};
    const authorize = (u: typeof user) => u.claims.role === 'admin';
    const redirected = thrown(() =>
      requireAuth({redirectTo: '/login', authorize, forbiddenTo: '/no-access'})({context: {user}, location}),
    ) as {options: {to: string}};
    expect(isRedirect(redirected)).toBe(true);
    expect(redirected.options.to).toBe('/no-access');
    expect(thrown(() => requireAuth({redirectTo: '/login', authorize})({context: {user}, location}))).toMatchObject({
      code: 'auth/forbidden',
    });
  });
});
