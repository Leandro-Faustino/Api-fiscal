import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { ValidationError } from '../../../../shared/domain/app-error.js';
import type { CertificateInspector } from '../../application/ports/certificate-inspector.js';
import type { CertificateInspection } from '../../domain/digital-certificate.js';

function commonName(
  attributes: forge.pki.CertificateField[],
  fallback: string,
): string {
  const attribute = attributes.find(
    (candidate) => candidate.shortName === 'CN' || candidate.name === 'commonName',
  );
  const value = attribute?.value;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function matchesPrivateKey(
  certificate: forge.pki.Certificate,
  privateKeyBags: forge.pkcs12.Bag[],
): boolean {
  const publicKey = certificate.publicKey;
  if (
    Buffer.isBuffer(publicKey) ||
    !('n' in publicKey) ||
    !('e' in publicKey)
  ) {
    return false;
  }

  return privateKeyBags.some((bag) => {
    const privateKey = bag.key;
    return Boolean(
      privateKey &&
        privateKey.n.compareTo(publicKey.n) === 0 &&
        privateKey.e.compareTo(publicKey.e) === 0,
    );
  });
}

export class Pkcs12CertificateInspector implements CertificateInspector {
  public inspect(bundle: Buffer, password: string): CertificateInspection {
    try {
      const asn1 = forge.asn1.fromDer(bundle.toString('binary'));
      const pkcs12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
      const certificateBagOid = forge.pki.oids.certBag;
      const shroudedKeyBagOid = forge.pki.oids.pkcs8ShroudedKeyBag;
      const keyBagOid = forge.pki.oids.keyBag;
      if (!certificateBagOid || !shroudedKeyBagOid || !keyBagOid) {
        throw new Error('Identificadores PKCS#12 indisponíveis.');
      }
      const certificateBags =
        pkcs12.getBags({ bagType: certificateBagOid })[certificateBagOid] ?? [];
      const privateKeyBags = [
        ...(pkcs12.getBags({ bagType: shroudedKeyBagOid })[shroudedKeyBagOid] ?? []),
        ...(pkcs12.getBags({ bagType: keyBagOid })[keyBagOid] ?? []),
      ];

      if (certificateBags.length === 0 || privateKeyBags.length === 0) {
        throw new Error('O pacote não contém certificado e chave privada.');
      }

      const certificateBag =
        certificateBags.find((bag: forge.pkcs12.Bag) => {
          const constraints = bag.cert?.getExtension('basicConstraints') as
            | { cA?: boolean }
            | undefined;
          return (
            bag.cert &&
            constraints?.cA !== true &&
            matchesPrivateKey(bag.cert, privateKeyBags)
          );
        });
      const certificate = certificateBag?.cert;

      if (!certificate) {
        throw new Error('Certificado final e chave privada correspondente não encontrados.');
      }

      const der = forge.asn1
        .toDer(forge.pki.certificateToAsn1(certificate))
        .getBytes();

      return {
        fingerprintSha256: createHash('sha256')
          .update(Buffer.from(der, 'binary'))
          .digest('hex'),
        serialNumber: certificate.serialNumber.toUpperCase(),
        subjectCommonName: commonName(certificate.subject.attributes, 'Titular não informado'),
        issuerCommonName: commonName(certificate.issuer.attributes, 'Emissor não informado'),
        validFrom: new Date(certificate.validity.notBefore),
        validUntil: new Date(certificate.validity.notAfter),
      };
    } catch {
      throw new ValidationError(
        'O arquivo A1 ou a senha são inválidos.',
        { code: 'INVALID_PKCS12_CERTIFICATE' },
      );
    }
  }
}
