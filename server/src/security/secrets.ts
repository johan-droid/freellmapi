import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;

function getMasterKey(): Buffer {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(`Invalid ENCRYPTION_MASTER_KEY: expected ${KEY_BYTES} bytes after base64 decoding.`);
    }
    return key;
  }

  const legacyHex = process.env.ENCRYPTION_KEY;
  if (legacyHex && /^[0-9a-fA-F]{64}$/.test(legacyHex)) {
    return Buffer.from(legacyHex, 'hex');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_MASTER_KEY is required in production for provider-account secret storage.');
  }

  return crypto.createHash('sha256').update('freellmapi-development-master-key').digest();
}

export function encryptSecret(plainText: string): { encrypted: string; iv: string; authTag: string; hint: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    hint: maskSecret(plainText),
  };
}

export function decryptSecret(encrypted: string, iv: string, authTag: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, getMasterKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function maskSecret(value: string): string {
  const clean = value.trim();
  if (clean.length <= 8) return `****${clean.slice(-4)}`;
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}
