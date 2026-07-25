import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { PasswordHasher } from '../../application/ports/password-hasher.js';

const KEY_LENGTH = 64;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: COST,
        r: BLOCK_SIZE,
        p: PARALLELIZATION,
        maxmem: MAX_MEMORY,
      },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(key);
      },
    );
  });
}

export class ScryptPasswordHasher implements PasswordHasher {
  public async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await deriveKey(password, salt);

    return [
      'scrypt',
      COST,
      BLOCK_SIZE,
      PARALLELIZATION,
      salt.toString('base64url'),
      derivedKey.toString('base64url'),
    ].join('$');
  }

  public async verify(password: string, encodedHash: string): Promise<boolean> {
    const [algorithm, cost, blockSize, parallelization, encodedSalt, encodedKey] =
      encodedHash.split('$');

    if (
      algorithm !== 'scrypt' ||
      Number(cost) !== COST ||
      Number(blockSize) !== BLOCK_SIZE ||
      Number(parallelization) !== PARALLELIZATION ||
      !encodedSalt ||
      !encodedKey
    ) {
      return false;
    }

    const storedKey = Buffer.from(encodedKey, 'base64url');
    const derivedKey = await deriveKey(password, Buffer.from(encodedSalt, 'base64url'));

    return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
  }
}
