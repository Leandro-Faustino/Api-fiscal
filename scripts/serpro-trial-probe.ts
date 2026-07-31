/**
 * Sondagem dos serviços candidatos às próximas fatias do Radar e-CAC.
 *
 * Roda uma lista fixa de serviços no ambiente de demonstração e escreve um
 * relatório JSON único. O objetivo não é passar: é **descobrir o contrato**.
 * Uma recusa por campo obrigatório ausente é resultado útil — ela nomeia o
 * campo que o adaptador precisa enviar.
 *
 * Uso:
 *   set -a && source .env.trial.example && set +a
 *   npm run probe:serpro-trial > probe.json
 */
import { NativeSerproHttpTransport } from '../src/modules/ecac/infra/http/native-serpro-http-transport.js';

/** Os cinco tipos de endpoint do Integra Contador. */
type IntegraContadorPath =
  | '/Apoiar'
  | '/Consultar'
  | '/Declarar'
  | '/Emitir'
  | '/Monitorar';

interface Probe {
  label: string;
  path: IntegraContadorPath;
  system: string;
  service: string;
  systemVersion: string;
  data: string;
}

const probes: Probe[] = [
  {
    label: 'Caixa Postal — indicador de novas mensagens (já implementado)',
    path: '/Consultar',
    system: 'CAIXAPOSTAL',
    service: 'INNOVAMSG63',
    systemVersion: '1.0',
    data: '',
  },
  {
    label: 'Caixa Postal — lista de mensagens do contribuinte',
    path: '/Consultar',
    system: 'CAIXAPOSTAL',
    service: 'MSGCONTRIBUINTE61',
    systemVersion: '1.0',
    data: '',
  },
  {
    label: 'Caixa Postal — detalhe de uma mensagem',
    path: '/Consultar',
    system: 'CAIXAPOSTAL',
    service: 'OBTERMSG62',
    systemVersion: '1.0',
    data: '',
  },
  {
    label: 'e-Processo — processos por interessado',
    path: '/Consultar',
    system: 'EPROCESSO',
    service: 'CONSPROCPORINTER271',
    systemVersion: '1.0',
    data: '',
  },
];

const baseUrl = (
  process.env.SERPRO_API_BASE_URL ??
  'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1'
).replace(/\/+$/u, '');
const bearer = process.env.SERPRO_TRIAL_BEARER ?? '';
const timeoutMs = Number(process.env.SERPRO_TIMEOUT_MS ?? 15_000);
const contractorCnpj = process.env.SERPRO_TRIAL_CONTRACTOR_CNPJ ?? '00000000000000';
const requesterCnpj = process.env.SERPRO_TRIAL_REQUESTER_CNPJ ?? '00000000000000';
const taxpayerCnpj = process.env.SERPRO_TRIAL_TAXPAYER_CNPJ ?? '00000000000000';

if (!bearer) {
  console.error('Defina SERPRO_TRIAL_BEARER (veja .env.trial.example).');
  process.exit(2);
}

if (!baseUrl.includes('/integra-contador-trial/')) {
  console.error('Esta sondagem só aponta para o ambiente de demonstração.');
  process.exit(2);
}

const transport = new NativeSerproHttpTransport();
const report: unknown[] = [];

for (const probe of probes) {
  const body = JSON.stringify({
    contratante: { numero: contractorCnpj, tipo: 2 },
    autorPedidoDados: { numero: requesterCnpj, tipo: 2 },
    contribuinte: { numero: taxpayerCnpj, tipo: 2 },
    pedidoDados: {
      idSistema: probe.system,
      idServico: probe.service,
      versaoSistema: probe.systemVersion,
      dados: probe.data,
    },
  });

  try {
    const response = await transport.request({
      url: `${baseUrl}${probe.path}`,
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
      },
      body,
      timeoutMs,
    });
    report.push({
      label: probe.label,
      service: `${probe.system}/${probe.service}`,
      request: body,
      status: response.status,
      body: response.body.slice(0, 8_000),
    });
  } catch (error: unknown) {
    report.push({
      label: probe.label,
      service: `${probe.system}/${probe.service}`,
      request: body,
      error: error instanceof Error ? error.message : 'falha desconhecida',
    });
  }
}

console.log(JSON.stringify({ baseUrl, probes: report }, null, 2));
