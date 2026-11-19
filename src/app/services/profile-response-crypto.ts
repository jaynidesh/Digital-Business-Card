export interface EncryptedProfileResponse {
  version: number;
  algorithm: string;
  serverPublicKey: string;
  salt: string;
  iv: string;
  ciphertext: string;
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

export async function createResponseKey(): Promise<{ privateKey: CryptoKey; publicKey: string }> {
  if (!globalThis.crypto?.subtle) throw new Error('Secure HTTPS connection required');
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const bytes = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: btoa(String.fromCharCode(...bytes)) };
}

export async function decryptProfileResponse<T>(envelope: EncryptedProfileResponse, privateKey: CryptoKey, path: string): Promise<T> {
  if (envelope.version !== 1 || envelope.algorithm !== 'ECDH-P256-HKDF-SHA256-A256GCM') {
    throw new Error('Unsupported encrypted response');
  }
  const salt = decode(envelope.salt);
  const iv = decode(envelope.iv);
  const ciphertext = decode(envelope.ciphertext);
  if (salt.length !== 32 || iv.length !== 12 || ciphertext.length < 16) throw new Error('Invalid encrypted response');
  const peer = await crypto.subtle.importKey('spki', decode(envelope.serverPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const context = new TextEncoder().encode(`sbm-profile-response-v1:${path}`);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: context }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: context, tagLength: 128 }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
