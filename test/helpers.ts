import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import {type CryptoKey, exportJWK, exportPKCS8, generateKeyPair, SignJWT} from 'jose';

export const PROJECT_ID = 'demo-project';

const ALG = {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'} as const;

export interface TestKey {
  kid: string;
  privateKey: CryptoKey;
  certPem: string;
  jwk: Record<string, unknown>;
}

/** An RSA key with a self-signed certificate, generated per test run (no key material is committed). */
export async function makeKey(kid: string): Promise<TestKey> {
  const keys = (await crypto.subtle.generateKey(
    {...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1])},
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: `CN=${kid}`,
    notBefore: new Date(Date.now() - 86_400_000),
    notAfter: new Date(Date.now() + 86_400_000),
    signingAlgorithm: ALG,
    keys,
  });
  const jwk = {...(await exportJWK(keys.publicKey)), kid, alg: 'RS256', use: 'sig'};
  return {kid, privateKey: keys.privateKey, certPem: cert.toString('pem'), jwk};
}

export const now = () => Math.floor(Date.now() / 1000);

export function idTokenClaims(overrides: Record<string, unknown> = {}) {
  const t = now();
  return {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: 'user-1',
    user_id: 'user-1',
    iat: t - 10,
    exp: t + 3600,
    auth_time: t - 10,
    email: 'ada@example.com',
    email_verified: true,
    firebase: {sign_in_provider: 'password', identities: {email: ['ada@example.com']}},
    ...overrides,
  };
}

export function sessionClaims(overrides: Record<string, unknown> = {}) {
  return idTokenClaims({iss: `https://session.firebase.google.com/${PROJECT_ID}`, ...overrides});
}

/** Builds a JWT with arbitrary claims (no validation, so tests can make broken tokens). */
export async function sign(key: TestKey, claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({alg: 'RS256', kid: key.kid, typ: 'JWT', ...header})
    .sign(key.privateKey);
}

/** An unsigned token like the Auth Emulator issues. */
export function unsigned(claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({alg: 'none', typ: 'JWT'})}.${encode(claims)}.`;
}

export async function serviceAccountPem() {
  const {privateKey} = await generateKeyPair('RS256', {extractable: true});
  return exportPKCS8(privateKey);
}

export interface Call {
  url: string;
  init?: RequestInit;
}

/** A `fetch` that answers from a route table and records every call. */
export function fakeFetch(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({url, init});
    const route = routes[url];
    if (!route) return new Response(`no route for ${url}`, {status: 599});
    return route({url, init});
  };
  return Object.assign(fn as typeof fetch, {calls});
}

export const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {...init, headers: {'content-type': 'application/json', ...init.headers}});
