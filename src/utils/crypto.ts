import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EncryptedValue } from '../memory/types';

const APP_SALT = Buffer.from('ai-vision/preflight/v1', 'utf8');

function readStableOsSecret(): Buffer {
  if (process.env.AI_VISION_CRYPTO_SECRET) {
    return Buffer.from(process.env.AI_VISION_CRYPTO_SECRET, 'utf8');
  }

  const candidates = [
    '/etc/machine-id',
    '/var/lib/dbus/machine-id',
    path.join(os.homedir(), '.config', 'machine-id'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const value = fs.readFileSync(candidate, 'utf8').trim();
      if (value) return Buffer.from(value, 'utf8');
    }
  }

  return Buffer.from(`${os.hostname()}:${os.userInfo().username}`, 'utf8');
}

function deriveKey(purpose: string): Buffer {
  const ikm = readStableOsSecret();
  return Buffer.from(crypto.hkdfSync('sha256', ikm, APP_SALT, Buffer.from(purpose, 'utf8'), 32));
}

function keyIdForPurpose(purpose: string): string {
  return crypto
    .createHash('sha256')
    .update(readStableOsSecret())
    .update(APP_SALT)
    .update(purpose)
    .digest('hex')
    .slice(0, 16);
}

export function encryptText(plaintext: string, purpose = 'preflight'): EncryptedValue {
  const key = deriveKey(purpose);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    algorithm: 'aes-256-gcm',
    keyId: keyIdForPurpose(purpose),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    createdAt: new Date().toISOString(),
  };
}

export function decryptText(payload: EncryptedValue, purpose = 'preflight'): string {
  const key = deriveKey(purpose);
  const decipher = crypto.createDecipheriv(
    payload.algorithm,
    key,
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
