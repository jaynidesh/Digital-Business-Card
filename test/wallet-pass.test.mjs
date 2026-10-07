import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, generateKeyPairSync, verify } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplePass, createGoogleSaveUrl } from '../server/wallet-pass.mjs';

const exec = promisify(execFile);
const profile = {
  publicToken: 'hGr_tQ2piuR4eNgLkK94CIXh',
  displayName: 'Nourani Madarbux',
  jobTitle: 'Head IT Infrastructure',
  department: 'SBM Technology',
  company: 'SBM Bank (Mauritius) Ltd',
  mobile: '+23052524786',
  office: '+2302021558',
  email: 'nourani.madarbux@sbmgroup.mu',
  website: 'https://www.sbmgroup.mu/'
};

test('Google link contains a signed pass for the matching public URL', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const url = createGoogleSaveUrl(profile, {
    issuerId: '123456789',
    clientEmail: 'wallet@example.test',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicBaseUrl: 'https://contacts.example.test'
  });
  assert.match(url, /^https:\/\/pay\.google\.com\/gp\/v\/save\//);
  const jwt = url.split('/').at(-1);
  const [header, payload, signature] = jwt.split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')), true);
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(claims.iss, 'wallet@example.test');
  assert.equal(claims.payload.genericObjects[0].barcode.value, `https://contacts.example.test/contact/${profile.publicToken}`);
  assert.equal(claims.payload.genericObjects[0].header.defaultValue.value, profile.displayName);
});

test('Apple pass is a signed pkpass archive containing this contact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sbm-wallet-test-'));
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=Wallet Test']);
  const pass = await createApplePass(profile, {
    passTypeId: 'pass.mu.sbm.contact',
    teamId: 'TEAM123456',
    certificatePath: cert,
    privateKeyPath: key,
    wwdrCertificatePath: cert,
    publicBaseUrl: 'https://contacts.example.test'
  });
  assert.equal(pass.subarray(0, 2).toString(), 'PK');
  const zip = join(dir, 'contact.pkpass');
  await writeFile(zip, pass);
  const { stdout: passJson } = await exec('unzip', ['-p', zip, 'pass.json']);
  const { stdout: manifestJson } = await exec('unzip', ['-p', zip, 'manifest.json']);
  const metadata = JSON.parse(passJson);
  const manifest = JSON.parse(manifestJson);
  assert.equal(metadata.barcodes[0].message, `https://contacts.example.test/contact/${profile.publicToken}`);
  assert.equal(manifest['pass.json'], createHash('sha1').update(passJson).digest('hex'));
  const manifestPath = join(dir, 'manifest.json');
  const signaturePath = join(dir, 'signature');
  await writeFile(manifestPath, manifestJson);
  const { stdout: signature } = await exec('unzip', ['-p', zip, 'signature'], { encoding: 'buffer' });
  await writeFile(signaturePath, signature);
  await exec('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', signaturePath, '-content', manifestPath, '-noverify', '-out', join(dir, 'verified.json')]);
  assert.equal((await readFile(join(dir, 'verified.json'), 'utf8')), manifestJson);
});

test('Apple pass signs with a password-protected PEM key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sbm-wallet-encrypted-test-'));
  try {
    const key = join(dir, 'key.pem');
    const cert = join(dir, 'cert.pem');
    const password = 'test-passphrase';
    await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=Wallet Test']);
    const encrypted = createPrivateKey(await readFile(key)).export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: password });
    await writeFile(key, encrypted, { mode: 0o600 });
    const pass = await createApplePass(profile, {
      passTypeId: 'pass.mu.sbm.contact',
      teamId: 'TEAM123456',
      certificatePath: cert,
      privateKeyPath: key,
      wwdrCertificatePath: cert,
      privateKeyPassword: password,
      publicBaseUrl: 'https://contacts.example.test'
    });
    const zip = join(dir, 'contact.pkpass');
    await writeFile(zip, pass);
    const { stdout: entryNames } = await exec('unzip', ['-Z1', zip]);
    assert.doesNotMatch(entryNames, /signing-key\.pem/);
    const manifestPath = join(dir, 'manifest.json');
    const signaturePath = join(dir, 'signature');
    await writeFile(manifestPath, (await exec('unzip', ['-p', zip, 'manifest.json'])).stdout);
    await writeFile(signaturePath, (await exec('unzip', ['-p', zip, 'signature'], { encoding: 'buffer' })).stdout);
    await exec('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', signaturePath, '-content', manifestPath, '-noverify', '-out', join(dir, 'verified.json')]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
