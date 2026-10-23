import {redirect} from '@tanstack/react-router';

import {FirebaseAuthError} from './errors';

export interface RequireAuthOptions<User> {
  /** Where to send signed-out visitors, for example `/login`. */
  redirectTo: string;
  /**
   * Search parameter that carries the page the visitor wanted, so the login page can send them back. Defaults to
   * `redirect`; `false` leaves it out.
   */
  searchParam?: string | false;
  /** Extra check on the signed-in user, for example a custom claim. */
  authorize?: (user: User) => boolean;
  /**
   * Where to send signed-in users that `authorize` refuses. Without it, the guard throws a `FirebaseAuthError` with
   * code `auth/forbidden` for the route's error component.
   */
  forbiddenTo?: string;
}

export interface GuardArgs<User> {
  context: {user?: User | null};
  location: {href: string};
}

/**
 * A `beforeLoad` for routes that need a signed-in user. It reads `context.user` (put there by the root route) and
 * returns `{ user }`, so child routes see a non-null `context.user`.
 *
 * ```ts
 * export const Route = createFileRoute('/_authed')({ beforeLoad: requireAuth({ redirectTo: '/login' }) })
 * ```
 */
export function requireAuth<User = {uid: string}>(options: RequireAuthOptions<User>) {
  const param = options.searchParam ?? 'redirect';
  return ({context, location}: GuardArgs<User>): {user: User} => {
    const user = context.user;
    if (!user) {
      throw redirect({to: options.redirectTo, search: param === false ? undefined : {[param]: location.href}} as never);
    }
    if (options.authorize && !options.authorize(user)) {
      if (options.forbiddenTo) throw redirect({to: options.forbiddenTo} as never);
      throw new FirebaseAuthError('auth/forbidden', 'You are not allowed to see this page.');
    }
    return {user};
  };
}
