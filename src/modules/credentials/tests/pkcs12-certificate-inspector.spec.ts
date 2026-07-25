import { describe, expect, it } from 'vitest';
import { Pkcs12CertificateInspector } from '../infra/security/pkcs12-certificate-inspector.js';
import { createTestPkcs12 } from './pkcs12-fixture.js';

describe('leitura de certificado PKCS#12', () => {
  it('valida chave privada e extrai metadados do A1', () => {
    const fixture = createTestPkcs12();
    const inspector = new Pkcs12CertificateInspector();
    const metadata = inspector.inspect(
      Buffer.from(fixture.base64, 'base64'),
      fixture.password,
    );

    expect(metadata).toMatchObject({
      fingerprintSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      serialNumber: '01AB',
      subjectCommonName: fixture.subjectCommonName,
      issuerCommonName: fixture.issuerCommonName,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2028-01-01T00:00:00.000Z'),
    });
  });

  it('não diferencia senha errada de arquivo inválido', () => {
    const fixture = createTestPkcs12();
    const inspector = new Pkcs12CertificateInspector();

    expect(() =>
      inspector.inspect(Buffer.from(fixture.base64, 'base64'), 'senha-errada'),
    ).toThrow('O arquivo A1 ou a senha são inválidos.');
    expect(() => inspector.inspect(Buffer.from('invalido'), fixture.password)).toThrow(
      'O arquivo A1 ou a senha são inválidos.',
    );
  });
});
