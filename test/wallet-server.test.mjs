import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createWalletServer } from '../server/server.mjs';
import { createGoogleSaveUrl } from '../server/wallet-pass.mjs';

const token = JSON.parse(readFileSync(new URL('../data/mock-profiles.json', import.meta.url), 'utf8'))[0].publicToken;
const exec = promisify(execFile);

async function withServer(config, check, dependencies) {
  const server = createWalletServer(config, dependencies);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await check(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('wallet routes reject unknown contacts and report missing credentials', async () => {
  await withServer({ publicBaseUrl: 'https://contacts.example.test' }, async base => {
    const unknown = await fetch(`${base}/api/v1/public/contact/unknown-token/wallet/apple`);
    assert.equal(unknown.status, 404);
    const unavailable = await fetch(`${base}/api/v1/public/contact/${token}/wallet/apple`);
    assert.equal(unavailable.status, 503);
  });
});

test('Google route redirects to a signed save link for a known contact', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let syncedProfile;
  await withServer({
    publicBaseUrl: 'https://contacts.example.test',
    google: {
      issuerId: '123456789', clientEmail: 'wallet@example.test',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' })
    }
  }, async base => {
    const response = await fetch(`${base}/api/v1/public/contact/${token}/wallet/google`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.match(response.headers.get('location'), /^https:\/\/pay\.google\.com\/gp\/v\/save\//);
    assert.equal(syncedProfile?.publicToken, token);
  }, { googlePass: async (profile, config) => {
    syncedProfile = profile;
    return createGoogleSaveUrl(profile, config);
  } });
});

test('Apple route serves a signed pass archive with the Wallet MIME type', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sbm-wallet-http-test-'));
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  const wwdr = join(dir, 'wwdr.pem');
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=Wallet Test']);
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'wwdr-key.pem'), '-out', wwdr, '-days', '1', '-subj', '/CN=WWDR Test']);
  await withServer({
    publicBaseUrl: 'https://contacts.example.test',
    apple: {
      passTypeId: 'pass.mu.sbm.contact', teamId: 'TEAM123456',
      certificatePath: cert, privateKeyPath: key, wwdrCertificatePath: wwdr
    }
  }, async base => {
    const response = await fetch(`${base}/api/v1/public/contact/${token}/wallet/apple`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/vnd.apple.pkpass');
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  });
});
