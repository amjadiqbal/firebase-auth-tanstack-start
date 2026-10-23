export interface SessionCookieOptions {
  /**
   * Cookie name. Defaults to `__session`, the only cookie Firebase Hosting passes through to Cloud Functions and
   * Cloud Run.
   */
  name?: string;
  /** Lifetime in seconds, 300 (5 minutes) to 1,209,600 (14 days). Defaults to 432,000 (5 days). */
  maxAge?: number;
  /**
   * Sets `Secure`. Defaults to `true`. Chromium accepts Secure cookies on `http://localhost`; if your browser drops
   * the cookie during plain-HTTP local development, set it to `false` there (never in production).
   */
  secure?: boolean;
  /** Defaults to `lax`. `none` requires `secure: true`. */
  sameSite?: 'lax' | 'strict' | 'none';
  /** Defaults to `/`. */
  path?: string;
  domain?: string;
}

export type ResolvedCookieOptions = Required<Omit<SessionCookieOptions, 'domain'>> & {domain?: string};

export const MIN_SESSION_SECONDS = 5 * 60;
export const MAX_SESSION_SECONDS = 14 * 24 * 60 * 60;

export function resolveCookieOptions(options: SessionCookieOptions = {}): ResolvedCookieOptions {
  const resolved: ResolvedCookieOptions = {
    name: options.name ?? '__session',
    maxAge: options.maxAge ?? 5 * 24 * 60 * 60,
    secure: options.secure ?? true,
    sameSite: options.sameSite ?? 'lax',
    path: options.path ?? '/',
    domain: options.domain,
  };
  if (resolved.maxAge < MIN_SESSION_SECONDS || resolved.maxAge > MAX_SESSION_SECONDS) {
    throw new RangeError(`cookie.maxAge must be between ${MIN_SESSION_SECONDS} and ${MAX_SESSION_SECONDS} seconds.`);
  }
  if (resolved.sameSite === 'none' && !resolved.secure) {
    throw new RangeError('cookie.sameSite "none" requires cookie.secure.');
  }
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(resolved.name)) throw new RangeError('cookie.name is not a valid name.');
  return resolved;
}

const SAME_SITE = {lax: 'Lax', strict: 'Strict', none: 'None'} as const;

/** A `Set-Cookie` value: always `HttpOnly`, so page scripts can never read the session. */
export function serializeSessionCookie(value: string, options: ResolvedCookieOptions, maxAge = options.maxAge): string {
  const parts = [`${options.name}=${value}`, `Max-Age=${maxAge}`, `Path=${options.path}`, 'HttpOnly'];
  if (maxAge === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${SAME_SITE[options.sameSite]}`);
  return parts.join('; ');
}

export function clearSessionCookie(options: ResolvedCookieOptions): string {
  return serializeSessionCookie('', options, 0);
}

/** Reads one cookie from a `Cookie` header. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      return value === '' ? undefined : value;
    }
  }
  return undefined;
}
