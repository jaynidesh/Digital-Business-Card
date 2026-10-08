import { createSign } from 'node:crypto';
import { buildGooglePassObject, createGoogleSaveUrl } from './wallet-pass.mjs';

const tokenUrl = 'https://oauth2.googleapis.com/token';
const walletApi = 'https://walletobjects.googleapis.com/walletobjects/v1';
const walletScope = 'https://www.googleapis.com/auth/wallet_object.issuer';

function signJwt(claims, privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url');
  return `${input}.${signature}`;
}

async function accessToken(config, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt({ iss: config.clientEmail, scope: walletScope, aud: tokenUrl, iat: now, exp: now + 3600 }, config.privateKey);
  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Google OAuth token request failed: ${response.status}`);
  const body = await response.json();
  if (!body.access_token) throw new Error('Google OAuth token response did not contain an access token');
  return body.access_token;
}

export async function ensureGooglePass(profile, config, fetchImpl = fetch) {
  if (!config?.issuerId || !config.clientEmail || !config.privateKey || !config.publicBaseUrl) {
    throw new Error('Google Wallet is not configured');
  }
  const object = buildGooglePassObject(profile, config);
  const token = await accessToken(config, fetchImpl);
  const request = (method, path, body) => fetchImpl(`${walletApi}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000)
  });
  const requireSuccess = (response, operation) => {
    if (!response.ok) throw new Error(`Google Wallet ${operation} failed: ${response.status}`);
  };

  const classPath = `/genericClass/${encodeURIComponent(object.classId)}`;
  const classResponse = await request('GET', classPath);
  if (classResponse.status === 404) {
    const created = await request('POST', '/genericClass', { id: object.classId });
    if (!created.ok && created.status !== 409) requireSuccess(created, 'class creation');
  } else {
    requireSuccess(classResponse, 'class lookup');
  }

  const objectPath = `/genericObject/${encodeURIComponent(object.id)}`;
  const objectResponse = await request('GET', objectPath);
  const { id, classId, ...updates } = object;
  if (objectResponse.status === 404) {
    const created = await request('POST', '/genericObject', object);
    if (created.status === 409) requireSuccess(await request('PATCH', objectPath, updates), 'object update');
    else requireSuccess(created, 'object creation');
  } else {
    requireSuccess(objectResponse, 'object lookup');
    requireSuccess(await request('PATCH', objectPath, updates), 'object update');
  }
  return createGoogleSaveUrl(profile, config);
}
