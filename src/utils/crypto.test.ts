import { decryptText, encryptText } from './crypto';

describe('crypto helpers', () => {
  const previousSecret = process.env.AI_VISION_CRYPTO_SECRET;

  beforeAll(() => {
    process.env.AI_VISION_CRYPTO_SECRET = 'test-secret-material';
  });

  afterAll(() => {
    process.env.AI_VISION_CRYPTO_SECRET = previousSecret;
  });

  it('round-trips encrypted text', () => {
    const payload = encryptText('top-secret', 'preflight:test');
    expect(payload.ciphertext).not.toContain('top-secret');
    expect(decryptText(payload, 'preflight:test')).toBe('top-secret');
  });
});
