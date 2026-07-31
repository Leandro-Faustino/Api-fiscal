/**
 * Chamada real contra o ambiente de demonstração do Integra Contador.
 *
 * Não substitui os testes automatizados: serve para conferir alcance de rede,
 * TLS, formato do envelope e o contrato de resposta de um serviço antes de
 * escrevê-lo como adaptador. Não usa banco, cofre nem certificado.
 *
 * Uso:
 *   SERPRO_TRIAL_BEARER=<token-de-demonstracao> \
 *   npm run smoke:serpro-trial -- CAIXAPOSTAL INNOVAMSG63 1.0
 */
import { NativeSerproHttpTransport } from '../src/modules/ecac/infra/http/native-serpro-http-transport.js';

const baseUrl = (
  process.env.SERPRO_API_BASE_URL ??
  'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1'
).replace(/\/+$/u, '');
const bearer = process.env.SERPRO_TRIAL_BEARER ?? '';
const timeoutMs = Number(process.env.SERPRO_TIMEOUT_MS ?? 15_000);
const path = process.env.SERPRO_TRIAL_PATH ?? '/Consultar';
const contractorCnpj = process.env.SERPRO_TRIAL_CONTRACTOR_CNPJ ?? '00000000000000';
const requesterCnpj = process.env.SERPRO_TRIAL_REQUESTER_CNPJ ?? '00000000000000';
const taxpayerCnpj = process.env.SERPRO_TRIAL_TAXPAYER_CNPJ ?? '00000000000000';

const [system, service, systemVersion = '1.0', data = ''] = process.argv.slice(2);

if (!bearer) {
  console.error(
    'Defina SERPRO_TRIAL_BEARER com o token de demonstração publicado na documentação do SERPRO.',
  );
  process.exit(2);
}

if (!baseUrl.includes('/integra-contador-trial/')) {
  console.error(
    'Este script só aponta para o ambiente de demonstração. Ajuste SERPRO_API_BASE_URL.',
  );
  process.exit(2);
}

if (!system || !service) {
  console.error('Uso: npm run smoke:serpro-trial -- <idSistema> <idServico> [versao] [dados]');
  process.exit(2);
}

const body = JSON.stringify({
  contratante: { numero: contractorCnpj, tipo: 2 },
  autorPedidoDados: { numero: requesterCnpj, tipo: 2 },
  contribuinte: { numero: taxpayerCnpj, tipo: 2 },
  pedidoDados: {
    idSistema: system,
    idServico: service,
    versaoSistema: systemVersion,
    dados: data,
  },
});

const transport = new NativeSerproHttpTransport();
const response = await transport.request({
  url: `${baseUrl}${path}`,
  method: 'POST',
  headers: {
    accept: 'application/json',
    authorization: `Bearer ${bearer}`,
    'content-type': 'application/json',
  },
  body,
  timeoutMs,
});

console.log(
  JSON.stringify(
    {
      request: { url: `${baseUrl}${path}`, system, service, systemVersion },
      status: response.status,
      body: response.body.slice(0, 4_000),
    },
    null,
    2,
  ),
);

process.exitCode = response.status >= 200 && response.status < 300 ? 0 : 1;
