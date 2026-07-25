import {
  EcacGatewayError,
  type EcacGateway,
  type EcacGatewayResult,
  type QueryEcacInput,
} from '../../application/ports/ecac-gateway.js';

export class UnconfiguredEcacGateway implements EcacGateway {
  public async query(_input: QueryEcacInput): Promise<EcacGatewayResult> {
    throw new EcacGatewayError(
      'O provedor do Integra Contador ainda não foi configurado.',
      'ECAC_PROVIDER_NOT_CONFIGURED',
      true,
    );
  }
}
