export interface SealedCredential {
  ciphertext: string;
  keyVersion: number;
}

export interface CredentialCipher {
  seal(plaintext: Buffer, context: string): SealedCredential;
  open(ciphertext: string, context: string): Buffer;
  getActiveKeyVersion(): number;
}
