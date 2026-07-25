import forge from 'node-forge';

export interface TestPkcs12 {
  base64: string;
  password: string;
  subjectCommonName: string;
  issuerCommonName: string;
}

export function createTestPkcs12(): TestPkcs12 {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 512, e: 0x10001 });
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = '01AB';
  certificate.validity.notBefore = new Date('2026-01-01T00:00:00.000Z');
  certificate.validity.notAfter = new Date('2028-01-01T00:00:00.000Z');

  const subjectCommonName = 'Empresa Teste Ltda:11222333000181';
  const issuerCommonName = 'Autoridade Certificadora Teste';
  certificate.setSubject([{ name: 'commonName', value: subjectCommonName }]);
  certificate.setIssuer([{ name: 'commonName', value: issuerCommonName }]);
  certificate.setExtensions([
    {
      name: 'basicConstraints',
      cA: false,
    },
  ]);
  certificate.sign(keys.privateKey, forge.md.sha256.create());

  const password = 'senha-certificado';
  const pfx = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], password, {
    algorithm: '3des',
    friendlyName: 'A1 Teste',
  });

  return {
    base64: Buffer.from(forge.asn1.toDer(pfx).getBytes(), 'binary').toString('base64'),
    password,
    subjectCommonName,
    issuerCommonName,
  };
}
