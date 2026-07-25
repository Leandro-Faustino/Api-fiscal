import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../shared/domain/app-error.js';
import { Cnpj } from '../domain/cnpj.js';

describe('Cnpj', () => {
  it('normaliza um CNPJ formatado e válido', () => {
    const cnpj = Cnpj.create('11.222.333/0001-81');

    expect(cnpj.value).toBe('11222333000181');
  });

  it.each(['', '123', '00000000000000', '11222333000180'])(
    'rejeita o CNPJ inválido %s',
    (value) => {
      expect(() => Cnpj.create(value)).toThrow(ValidationError);
    },
  );
});
