export interface MfaService {
  generateSecret(): string;
  generateRecoveryCodes(): string[];
  encrypt(value: string): string;
  decrypt(value: string): string;
  verifyTotp(secret: string, code: string, now?: Date): boolean;
  hash(value: string): string;
  buildOtpAuthUri(secret: string, accountName: string, issuer: string): string;
}
