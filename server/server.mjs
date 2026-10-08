import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplePass } from './wallet-pass.mjs';
import { ensureGooglePass } from './google-wallet.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profiles = JSON.parse(readFileSync(resolve(root, 'data/mock-profiles.json'), 'utf8'));
const byPublicToken = new Map(profiles.map(profile => [profile.publicToken, profile]));
const route = /^\/api\/v1\/public\/contact\/([A-Za-z0-9_-]{20,})\/wallet\/(apple|google)$/;

function send(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

export function createWalletServer(config, { googlePass = ensureGooglePass } = {}) {
  return createServer(async (req, res) => {
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
    const match = new URL(req.url, 'http://localhost').pathname.match(route);
    if (!match) return send(res, 404, 'Not found');
    const [, token, platform] = match;
    const profile = byPublicToken.get(token);
    if (!profile) return send(res, 404, 'Contact not found');
    if (!config.publicBaseUrl || !config[platform]) return send(res, 503, 'Wallet pass is not configured');

    try {
      if (platform === 'google') {
        const location = await googlePass(profile, { ...config.google, publicBaseUrl: config.publicBaseUrl });
        res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        return res.end();
      }
      const pass = await createApplePass(profile, { ...config.apple, publicBaseUrl: config.publicBaseUrl });
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': 'attachment; filename="contact.pkpass"',
        'Content-Length': pass.length,
        'Cache-Control': 'no-store'
      });
      res.end(pass);
    } catch (error) {
      console.error('Wallet pass generation failed:', error);
      send(res, 500, 'Could not create wallet pass');
    }
  });
}

function configFromEnv() {
  const accountPath = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON;
  const account = accountPath ? JSON.parse(readFileSync(resolve(accountPath), 'utf8')) : null;
  return {
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    google: account && process.env.GOOGLE_WALLET_ISSUER_ID ? {
      issuerId: process.env.GOOGLE_WALLET_ISSUER_ID,
      clientEmail: account.client_email,
      privateKey: account.private_key
    } : null,
    apple: process.env.APPLE_PASS_TYPE_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_PASS_CERT_PEM &&
      process.env.APPLE_PASS_KEY_PEM && process.env.APPLE_WWDR_CERT_PEM ? {
        passTypeId: process.env.APPLE_PASS_TYPE_ID,
        teamId: process.env.APPLE_TEAM_ID,
        certificatePath: resolve(process.env.APPLE_PASS_CERT_PEM),
        privateKeyPath: resolve(process.env.APPLE_PASS_KEY_PEM),
        wwdrCertificatePath: resolve(process.env.APPLE_WWDR_CERT_PEM),
        privateKeyPassword: process.env.APPLE_PASS_KEY_PASSWORD
      } : null
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createWalletServer(configFromEnv());
  const port = Number(process.env.WALLET_PORT || 4400);
  const host = process.env.WALLET_HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Wallet service listening on http://${host}:${port}`));
}
