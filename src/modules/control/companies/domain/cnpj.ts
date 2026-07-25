import { ValidationError } from '../../../../shared/domain/app-error.js';

export class Cnpj {
  private constructor(public readonly value: string) {}

  public static create(rawValue: string): Cnpj {
    const value = rawValue.replace(/\D/g, '');

    if (!Cnpj.isValid(value)) {
      throw new ValidationError('CNPJ inválido.', { field: 'cnpj' });
    }

    return new Cnpj(value);
  }

  public static isValid(value: string): boolean {
    if (!/^\d{14}$/.test(value) || /^(\d)\1{13}$/.test(value)) {
      return false;
    }

    const calculateDigit = (base: string, weights: number[]): number => {
      const sum = base
        .split('')
        .reduce((total, digit, index) => total + Number(digit) * (weights[index] ?? 0), 0);
      const remainder = sum % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    };

    const firstDigit = calculateDigit(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const secondDigit = calculateDigit(
      `${value.slice(0, 12)}${firstDigit}`,
      [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
    );

    return value.endsWith(`${firstDigit}${secondDigit}`);
  }
}
