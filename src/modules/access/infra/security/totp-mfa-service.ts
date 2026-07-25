import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { MfaService } from '../../application/ports/mfa-service.js';

interface Dependencies {
  mfaEncryptionKey: string;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

function encodeBase32(value: Buffer): string {
  let bits = '';
  let result = '';

  for (const byte of value) {
    bits += byte.toString(2).padStart(8, '0');
  }

  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, '0');
    result += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }

  return result;
}

function decodeBase32(value: string): Buffer {
  let bits = '';

  for (const character of value.replace(/=+$/u, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new Error('Segredo MFA inválido.');
    }
    bits += index.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateHotp(secret: string, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function generateTotpCode(secret: string, now = new Date()): string {
  const counter = Math.floor(now.getTime() / 1_000 / TOTP_STEP_SECONDS);
  return generateHotp(secret, counter);
}

export class TotpMfaService implements MfaService {
  private readonly encryptionKey: Buffer;

  public constructor({ mfaEncryptionKey }: Dependencies) {
    this.encryptionKey = createHash('sha256').update(mfaEncryptionKey).digest();
  }

  public generateSecret(): string {
    return encodeBase32(randomBytes(20));
  }

  public generateRecoveryCodes(): string[] {
    return Array.from({ length: 8 }, () => {
      const value = randomBytes(6).toString('hex').toUpperCase();
      return `${value.slice(0, 6)}-${value.slice(6)}`;
    });
  }

  public encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  public decrypt(value: string): string {
    const [version, ivEncoded, tagEncoded, ciphertextEncoded] = value.split('.');
    if (
      version !== 'v1' ||
      !ivEncoded ||
      !tagEncoded ||
      !ciphertextEncoded
    ) {
      throw new Error('Valor criptografado inválido.');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(ivEncoded, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  public verifyTotp(secret: string, code: string, now = new Date()): boolean {
    if (!/^\d{6}$/u.test(code)) {
      return false;
    }

    const counter = Math.floor(now.getTime() / 1_000 / TOTP_STEP_SECONDS);
    const supplied = Buffer.from(code);

    return [-1, 0, 1].some((offset) => {
      const expected = Buffer.from(generateHotp(secret, counter + offset));
      return expected.length === supplied.length && timingSafeEqual(expected, supplied);
    });
  }

  public hash(value: string): string {
    return createHash('sha256').update(value.trim()).digest('hex');
  }

  public buildOtpAuthUri(secret: string, accountName: string, issuer: string): string {
    const label = encodeURIComponent(`${issuer}:${accountName}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
  }
}
