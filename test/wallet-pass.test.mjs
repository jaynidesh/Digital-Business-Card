import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createPrivateKey, generateKeyPairSync, verify } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplePass, createGoogleSaveUrl } from '../server/wallet-pass.mjs';
import * as walletPass from '../server/wallet-pass.mjs';

const exec = promisify(execFile);
const profiles = JSON.parse(readFileSync(new URL('../data/mock-profiles.json', import.meta.url), 'utf8'));
const profile = profiles[0];

test('Google pass includes public contact details and links from the profile fixture', () => {
  const pass = walletPass.buildGooglePassObject(profile, {
    issuerId: '123456789', publicBaseUrl: 'https://contacts.example.test'
  });
  const fields = Object.fromEntries(pass.textModulesData.map(({ id, body }) => [id, body]));
  assert.equal(pass.cardTitle.defaultValue.value, profile.company);
  assert.equal(pass.header.defaultValue.value, profile.displayName);
  assert.equal(pass.subheader.defaultValue.value, profile.jobTitle);
  assert.equal(fields.row2left, profile.mobileDisplay);
  assert.equal(fields.row2right, `${profile.office} ext. ${profile.extension}`);
  assert.equal(fields.row3left, profile.email);
  assert.equal(fields.row3right, profile.department);
  assert.equal(fields.role, profile.jobTitle);
  assert.equal(fields.website, profile.websiteDisplay);
  assert.equal(fields.address, profile.address);
  assert.equal(fields.whatsapp, profile.whatsapp);
  assert.ok(pass.textModulesData.length <= 10);
  const links = Object.fromEntries(pass.linksModuleData.uris.map(({ id, uri }) => [id, uri]));
  assert.equal(links.contact, `https://contacts.example.test/contact/${profile.publicToken}`);
  assert.equal(links.mobile, `tel:${profile.mobile}`);
  assert.equal(links.office, `tel:${profile.office}`);
  assert.equal(links.email, `mailto:${profile.email}`);
  assert.equal(links.website, profile.website);
  assert.equal(links.whatsapp, 'https://wa.me/23052524786');
  assert.equal(links.social_0, profile.socials[0].url);
  assert.ok(pass.linksModuleData.uris.length <= 10);
  assert.equal(JSON.stringify(pass).includes(profile.staffToken), false);
  assert.equal('heroImage' in pass, false);
});

test('Google pass omits unavailable WhatsApp and social links', () => {
  const pass = walletPass.buildGooglePassObject(profiles[1], {
    issuerId: '123456789', publicBaseUrl: 'https://contacts.example.test'
  });
  assert.equal(pass.textModulesData.some(({ id }) => id === 'whatsapp'), false);
  assert.equal(pass.linksModuleData.uris.some(({ id }) => id.startsWith('social_') || id === 'whatsapp'), false);
});

test('Google link contains a signed pass for the matching public URL', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const url = createGoogleSaveUrl(profile, {
    issuerId: '123456789',
    clientEmail: 'wallet@example.test',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicBaseUrl: 'https://contacts.example.test'
  });
  assert.match(url, /^https:\/\/pay\.google\.com\/gp\/v\/save\//);
  assert.ok(url.length < 1800, `Save link should stay under 1800 characters (was ${url.length})`);
  const jwt = url.split('/').at(-1);
  const [header, payload, signature] = jwt.split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')), true);
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(claims.iss, 'wallet@example.test');
  assert.equal(claims.payload.genericClasses, undefined);
  assert.deepEqual(claims.payload.genericObjects, [{
    id: walletPass.buildGooglePassObject(profile, { issuerId: '123456789', publicBaseUrl: 'https://contacts.example.test' }).id,
    classId: '123456789.staff_contact'
  }]);
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
