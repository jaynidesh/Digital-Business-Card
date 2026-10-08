import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, verify } from 'node:crypto';
import * as googleWallet from '../server/google-wallet.mjs';

const profile = JSON.parse(readFileSync(new URL('../data/mock-profiles.json', import.meta.url), 'utf8'))[0];
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config = {
  issuerId: '123456789',
  clientEmail: 'wallet@example.test',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  publicBaseUrl: 'https://contacts.example.test'
};

function mockGoogle(existing) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    const method = options?.method || 'GET';
    calls.push({ path, method, body: options?.body ?? null, headers: options?.headers });
    if (path === '/token') return new Response(JSON.stringify({ access_token: 'test-access-token' }), { status: 200 });
    if (method === 'GET') return new Response('', { status: existing ? 200 : 404 });
    return new Response('{}', { status: 200 });
  };
  return { calls, fetchImpl };
}

test('new Google pass is stored through the API before returning a short signed save link', async () => {
  const { calls, fetchImpl } = mockGoogle(false);
  const url = await googleWallet.ensureGooglePass(profile, config, fetchImpl);
  assert.ok(url.length < 1800);
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path.split('/').slice(0, 4).join('/')}`), [
    'POST /token',
    'GET /walletobjects/v1/genericClass',
    'POST /walletobjects/v1/genericClass',
    'GET /walletobjects/v1/genericObject',
    'POST /walletobjects/v1/genericObject'
  ]);
  const tokenAssertion = new URLSearchParams(calls[0].body).get('assertion');
  assert.ok(tokenAssertion);
  const assertion = tokenAssertion.split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${assertion[0]}.${assertion[1]}`), publicKey, Buffer.from(assertion[2], 'base64url')), true);
  assert.equal(JSON.parse(Buffer.from(assertion[1], 'base64url')).scope, 'https://www.googleapis.com/auth/wallet_object.issuer');
  assert.equal(JSON.parse(calls[2].body).id, '123456789.staff_contact');
  const pass = JSON.parse(calls[4].body);
  assert.equal(pass.header.defaultValue.value, profile.displayName);
  assert.equal(pass.textModulesData.find(({ id }) => id === 'address').body, profile.address);
  assert.equal(pass.linksModuleData.uris.find(({ id }) => id === 'whatsapp').uri, `https://wa.me/${profile.whatsapp.replace(/\D/g, '')}`);
  assert.equal(calls[4].headers.Authorization, 'Bearer test-access-token');
  const jwt = url.split('/').at(-1).split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${jwt[0]}.${jwt[1]}`), publicKey, Buffer.from(jwt[2], 'base64url')), true);
  assert.deepEqual(JSON.parse(Buffer.from(jwt[1], 'base64url')).payload.genericObjects, [{ id: pass.id, classId: pass.classId }]);
});

test('existing Google pass is updated with current profile details', async () => {
  const { calls, fetchImpl } = mockGoogle(true);
  await googleWallet.ensureGooglePass(profile, config, fetchImpl);
  assert.deepEqual(calls.map(({ method, path }) => `${method} ${path.split('/').slice(0, 4).join('/')}`), [
    'POST /token',
    'GET /walletobjects/v1/genericClass',
    'GET /walletobjects/v1/genericObject',
    'PATCH /walletobjects/v1/genericObject'
  ]);
  assert.equal(JSON.parse(calls[3].body).textModulesData.find(({ id }) => id === 'mobile').body, profile.mobileDisplay);
});

test('Google API rejection stops issuance', async () => {
  const fetchImpl = async () => new Response('{}', { status: 403 });
  await assert.rejects(googleWallet.ensureGooglePass(profile, config, fetchImpl), /Google OAuth token request failed: 403/);
});
