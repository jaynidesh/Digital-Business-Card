import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createResponseKey, decryptProfileResponse } from '../src/app/services/profile-response-crypto.ts';

const path = '/api/v1/public/contact/pppppppppppppppppppppppp';
function encrypt(publicKey, configPath = '') {
  return JSON.parse(execFileSync('php', ['-r',
    'require "server-php/src/ResponseEncryption.php"; echo json_encode(SBMWallet\\encryptProfilePayload("{\\"displayName\\":\\"Test Contact\\"}", $argv[1], $argv[2], $argv[3] ?: null));',
    publicKey, path, configPath], { encoding: 'utf8' }));
}

test('PHP response decrypts with Web Crypto; wrong key, route and tampering fail', async () => {
  const key = await createResponseKey();
  assert.equal(key.privateKey.extractable, false);
  const envelope = encrypt(key.publicKey);
  assert.ok(!JSON.stringify(envelope).includes('Test Contact'));
  assert.deepEqual(await decryptProfileResponse(envelope, key.privateKey, path), { displayName: 'Test Contact' });
  const other = await createResponseKey();
  await assert.rejects(decryptProfileResponse(envelope, other.privateKey, path));
  await assert.rejects(decryptProfileResponse(envelope, key.privateKey, path + 'x'));
  const bytes = Buffer.from(envelope.ciphertext, 'base64'); bytes[0] ^= 1;
  await assert.rejects(decryptProfileResponse({ ...envelope, ciphertext: bytes.toString('base64') }, key.privateKey, path));
  await assert.rejects(decryptProfileResponse({ ...envelope, version: 2 }, key.privateKey, path));
  const next = encrypt(key.publicKey);
  assert.notEqual(envelope.serverPublicKey, next.serverPublicKey);
  assert.notEqual(envelope.iv, next.iv);
});

test('PHP rejects malformed or non-EC recipient keys', () => {
  assert.throws(() => encrypt('invalid-key'));
});

test('HTTP contact routes require encrypted POST and keep manifests readable without login', async () => {
  const { mkdtemp, mkdir, cp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createServer } = await import('node:net');
  const { spawn } = await import('node:child_process');
  const root = await mkdtemp(join(tmpdir(), 'sbm-encrypted-http-'));
  let server;
  try {
    await mkdir(join(root, 'api/public'), { recursive: true });
    await cp('server-php/src', join(root, 'api/src'), { recursive: true });
    await cp('server-php/public/index.php', join(root, 'api/public/index.php'));
    const profile = { publicToken: 'p'.repeat(24), staffToken: 's'.repeat(24), displayName: 'Wire Test' };
    await writeFile(join(root, 'input.json'), JSON.stringify([profile]));
    execFileSync('php', ['server-php/tools/encrypt-profiles.php', join(root, 'input.json'), join(root, 'api/private')]);
    const socket = createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', join(root, 'api/public'), join(root, 'api/public/index.php')], { env: { PATH: process.env.PATH } });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('PHP server did not start')), 5000);
      server.once('error', error => { clearTimeout(timeout); reject(error); });
      server.stderr.on('data', data => { if (data.toString().includes('Development Server')) { clearTimeout(timeout); resolve(); } });
    });
    const origin = `http://127.0.0.1:${port}`;
    for (const kind of ['public', 'staff']) {
      const route = `/api/v1/${kind}/contact/${profile[kind === 'public' ? 'publicToken' : 'staffToken']}`;
      assert.equal((await fetch(origin + route)).status, 405);
      const key = await createResponseKey();
      const response = await fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, clientPublicKey: key.publicKey }) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const text = await response.text();
      assert.ok(!text.includes('Wire Test'));
      const decoded = await decryptProfileResponse(JSON.parse(text), key.privateKey, route);
      assert.equal(decoded.displayName, 'Wire Test');
      assert.ok(!('staffToken' in decoded));
      assert.equal((await fetch(origin + route, { method: 'POST', body: '{}' })).status, 400);
      assert.equal((await fetch(origin + route, { method: 'POST', body: 'x'.repeat(1025) })).status, 400);
      assert.equal((await fetch(origin + route + '/manifest')).status, 200);
    }
  } finally {
    if (server && server.exitCode === null) {
      await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
    }
    await rm(root, { recursive: true, force: true });
  }
});


test('unreadable explicit OpenSSL configuration fails with an actionable error', async () => {
  const key = await createResponseKey();
  assert.throws(() => encrypt(key.publicKey, '/missing/sbm-openssl.cnf'), error => {
    assert.match(String(error.stdout), /OpenSSL configuration file is not readable/);
    return true;
  });
});

test('response encryption accepts an explicit OpenSSL configuration', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'sbm-openssl-config-'));
  try {
    const config = join(dir, 'openssl.cnf');
    await writeFile(config, '[req]\ndefault_bits = 2048\ndistinguished_name = req_dn\n[req_dn]\n');
    const key = await createResponseKey();
    assert.deepEqual(await decryptProfileResponse(encrypt(key.publicKey, config), key.privateKey, path), { displayName: 'Test Contact' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
