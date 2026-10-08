import { createHash, createPrivateKey, createSign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const assets = join(dirname(fileURLToPath(import.meta.url)), 'assets');

function contactUrl(profile, publicBaseUrl) {
  return new URL(`/contact/${encodeURIComponent(profile.publicToken)}`, publicBaseUrl).toString();
}

function localized(value) {
  return { defaultValue: { language: 'en-US', value } };
}

function googleIds(profile, issuerId) {
  return {
    classId: `${issuerId}.staff_contact`,
    objectId: `${issuerId}.contact_${createHash('sha256').update(profile.publicToken).digest('hex').slice(0, 32)}`
  };
}

function webUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

export function buildGooglePassObject(profile, { issuerId, publicBaseUrl }) {
  const { classId, objectId } = googleIds(profile, issuerId);
  const url = contactUrl(profile, publicBaseUrl);
  const textModulesData = [];
  const links = [{ id: 'contact', uri: url, description: 'Open contact card' }];
  const text = (id, header, value) => {
    if (typeof value === 'string' && value.trim()) textModulesData.push({ id, header, body: value.trim() });
  };
  const link = (id, description, uri) => {
    if (uri) links.push({ id, uri, description });
  };

  text('row2left', 'Mobile', profile.mobileDisplay || profile.mobile);
  text('row2right', 'Office', profile.office ? `${profile.office}${profile.extension ? ` ext. ${profile.extension}` : ''}` : '');
  text('row3left', 'Email', profile.email);
  text('row3right', 'Department', profile.department);
  text('role', 'Role', profile.jobTitle);
  text('website', 'Website', profile.websiteDisplay || profile.website);
  text('address', 'Address', profile.address);
  text('whatsapp', 'WhatsApp', profile.whatsapp);

  link('mobile', 'Call mobile', profile.mobile ? `tel:${profile.mobile}` : null);
  link('office', 'Call office', profile.office ? `tel:${profile.office}` : null);
  link('email', 'Send email', profile.email ? `mailto:${profile.email}` : null);
  link('website', 'Visit website', webUrl(profile.website));
  link('address', 'View address on map', profile.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.address)}` : null);
  const whatsapp = profile.whatsapp?.replace(/\D/g, '');
  link('whatsapp', 'Message on WhatsApp', whatsapp ? `https://wa.me/${whatsapp}` : null);
  for (const [index, social] of (profile.socials || []).entries()) {
    if (links.length >= 10) break;
    link(`social_${index}`, social.label, webUrl(social.url));
  }

  return {
    id: objectId,
    classId,
    state: 'ACTIVE',
    cardTitle: localized(profile.company),
    header: localized(profile.displayName),
    subheader: localized(profile.jobTitle),
    hexBackgroundColor: '#1E3868',
    barcode: { type: 'QR_CODE', value: url },
    textModulesData,
    linksModuleData: { uris: links }
  };
}

export function createGoogleSaveUrl(profile, config) {
  const { issuerId, clientEmail, privateKey, publicBaseUrl } = config;
  if (!issuerId || !clientEmail || !privateKey || !publicBaseUrl) throw new Error('Google Wallet is not configured');
  const { classId, objectId } = googleIds(profile, issuerId);
  const claims = {
    iss: clientEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [new URL(publicBaseUrl).origin],
    payload: {
      genericObjects: [{ id: objectId, classId }]
    }
  };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url');
  return `https://pay.google.com/gp/v/save/${input}.${signature}`;
}

export async function createApplePass(profile, config) {
  const { passTypeId, teamId, certificatePath, privateKeyPath, wwdrCertificatePath, publicBaseUrl, privateKeyPassword } = config;
  if (![passTypeId, teamId, certificatePath, privateKeyPath, wwdrCertificatePath, publicBaseUrl].every(Boolean)) {
    throw new Error('Apple Wallet is not configured');
  }
  const url = contactUrl(profile, publicBaseUrl);
  const serialNumber = createHash('sha256').update(profile.publicToken).digest('hex').slice(0, 32);
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: passTypeId,
    serialNumber,
    teamIdentifier: teamId,
    organizationName: profile.company,
    description: `${profile.displayName} contact card`,
    logoText: profile.company,
    backgroundColor: 'rgb(255,255,255)',
    foregroundColor: 'rgb(30,56,104)',
    labelColor: 'rgb(212,174,98)',
    generic: {
      primaryFields: [{ key: 'name', label: 'CONTACT', value: profile.displayName }],
      secondaryFields: [{ key: 'title', label: 'ROLE', value: profile.jobTitle }],
      auxiliaryFields: [{ key: 'department', label: 'DEPARTMENT', value: profile.department }],
      backFields: [
        { key: 'mobile', label: 'Mobile', value: profile.mobile },
        { key: 'office', label: 'Office', value: profile.office },
        { key: 'email', label: 'Email', value: profile.email },
        { key: 'website', label: 'Website', value: profile.website },
        { key: 'card', label: 'Digital contact card', value: url }
      ]
    },
    barcodes: [{ format: 'PKBarcodeFormatQR', message: url, messageEncoding: 'iso-8859-1', altText: 'Scan contact card' }]
  };
  const work = await mkdtemp(join(tmpdir(), 'sbm-pkpass-'));
  try {
    let signingKeyPath = privateKeyPath;
    if (privateKeyPassword) {
      // OpenSSL CMS cannot read encrypted PEM keys reliably here; keep the decrypted key in the private work directory only.
      const key = createPrivateKey({ key: await readFile(privateKeyPath), passphrase: privateKeyPassword });
      signingKeyPath = join(work, 'signing-key.pem');
      await writeFile(signingKeyPath, key.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    }
    const names = ['pass.json', 'icon.png', 'icon@2x.png', 'logo.png', 'logo@2x.png'];
    await writeFile(join(work, 'pass.json'), JSON.stringify(pass));
    for (const name of names.slice(1)) await writeFile(join(work, name), await readFile(join(assets, name)));
    const manifest = {};
    for (const name of names) manifest[name] = createHash('sha1').update(await readFile(join(work, name))).digest('hex');
    await writeFile(join(work, 'manifest.json'), JSON.stringify(manifest));
    const args = ['cms', '-sign', '-binary', '-in', 'manifest.json', '-signer', certificatePath, '-inkey', signingKeyPath,
      '-certfile', wwdrCertificatePath, '-outform', 'DER', '-out', 'signature', '-nosmimecap'];
    await exec('openssl', args, { cwd: work });
    await exec('zip', ['-q', '-X', 'contact.pkpass', ...names, 'manifest.json', 'signature'], { cwd: work });
    return await readFile(join(work, 'contact.pkpass'));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
