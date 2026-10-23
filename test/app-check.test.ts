import {SignJWT} from 'jose';
import {beforeAll, describe, expect, it} from 'vitest';

import {APP_CHECK_JWKS_URL, appCheckVerifier} from '../src/app-check';
import {fakeFetch, jsonResponse, makeKey, now, type TestKey} from './helpers';

let key: TestKey;
let stranger: TestKey;

beforeAll(async () => {
  key = await makeKey('app-check-1');
  stranger = await makeKey('stranger');
});

const PROJECT_NUMBER = '123456789';

function token(claims: Record<string, unknown> = {}, signer = key, header: Record<string, unknown> = {}) {
  return new SignJWT({
    iss: `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,
    aud: [`projects/${PROJECT_NUMBER}`, 'projects/demo-project'],
    sub: '1:123456789:web:abc',
    iat: now() - 5,
    exp: now() + 3600,
    ...claims,
  })
    .setProtectedHeader({alg: 'RS256', typ: 'JWT', kid: key.kid, ...header})
    .sign(signer.privateKey);
}

function verifier() {
  const fetch = fakeFetch({[APP_CHECK_JWKS_URL]: () => jsonResponse({keys: [key.jwk]})});
  return {fetch, verify: appCheckVerifier({projectNumber: PROJECT_NUMBER, fetch})};
}

describe('appCheckVerifier', () => {
  it('verifies a token and returns the app ID, caching the keys', async () => {
    const {verify, fetch} = verifier();
    expect((await verify(await token())).appId).toBe('1:123456789:web:abc');
    await verify(await token());
    expect(fetch.calls).toHaveLength(1);
  });

  it.each([
    ['another project number in aud', {aud: ['projects/999']}],
    ['another issuer', {iss: 'https://firebaseappcheck.googleapis.com/999'}],
    ['an expired token', {exp: now() - 10}],
    ['no subject', {sub: ''}],
  ])('refuses %s as app-check/invalid-token', async (_, claims) => {
    const {verify} = verifier();
    await expect(verify(await token(claims))).rejects.toMatchObject({code: 'app-check/invalid-token'});
  });

  it('refuses a wrong signature, a wrong typ and garbage; a missing token is app-check/missing-token', async () => {
    const {verify} = verifier();
    await expect(verify(await token({}, stranger))).rejects.toMatchObject({code: 'app-check/invalid-token'});
    await expect(verify(await token({}, key, {typ: 'at+jwt'}))).rejects.toMatchObject({
      code: 'app-check/invalid-token',
    });
    await expect(verify('garbage')).rejects.toMatchObject({code: 'app-check/invalid-token'});
    await expect(verify(null)).rejects.toMatchObject({code: 'app-check/missing-token', status: 401});
  });

  it('reports a failed key download as auth/internal-error', async () => {
    const verify = appCheckVerifier({
      projectNumber: PROJECT_NUMBER,
      fetch: fakeFetch({[APP_CHECK_JWKS_URL]: () => new Response('', {status: 503})}),
    });
    await expect(verify(await token())).rejects.toMatchObject({code: 'auth/internal-error'});
  });
});
