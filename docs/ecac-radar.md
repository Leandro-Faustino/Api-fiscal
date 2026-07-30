# Radar e-CAC — fundação F03

O primeiro corte do Radar e-CAC separa o domínio fiscal do provedor externo. A
aplicação conhece lotes, jobs, autorizações, protocolos e achados; o contrato
específico do Integra Contador fica em um adaptador substituível.

## Fluxo

1. O contador solicita um lote com uma chave idempotente e até 100 alvos.
2. Cada alvo informa a empresa e uma procuração vinculada.
3. A API valida escritório, vigência, serviços, certificado e escopo de CNPJ.
4. Um job independente é criado para cada empresa.
5. O processador reivindica jobs vencidos por lock otimista.
6. Sucessos armazenam protocolo, hash e achados normalizados.
7. A conclusão compara os achados com o último estado aceito da mesma empresa e
   do mesmo tipo de consulta.
8. Falhas transitórias recebem backoff exponencial; falhas definitivas encerram
   somente o job afetado.
9. O lote termina como `SUCCEEDED`, `PARTIAL` ou `FAILED`.

## Mudanças e alertas

Cada achado recebe duas impressões SHA-256:

- `findingKey`: identidade estável formada por código e referência do provedor;
  quando não há referência, o título normalizado é usado;
- `contentHash`: versão da categoria, título, descrição e severidade.

A primeira observação de uma pendência abre um alerta `NEW`. Consultas
posteriores preservam o mesmo alerta:

- conteúdo alterado reabre o alerta como `CHANGED`, mesmo se já reconhecido;
- desaparecimento da pendência muda o alerta para `RESOLVED`;
- reaparecimento muda o mesmo alerta para `REOPENED`;
- ausência de mudança apenas atualiza o horário da última observação.

A API lista alertas por empresa, consulta, severidade e estado em
`GET /v1/control/ecac/alerts`. Um alerta aberto pode ser reconhecido em
`POST /v1/control/ecac/alerts/:alertId/acknowledge`. Reconhecimento e mudanças
automáticas são isolados por escritório e auditados.

Cada usuário pode configurar canais de notificação do Radar e-CAC em
`PUT /v1/control/ecac/notification-preferences/:channel`. O primeiro corte
suporta `IN_APP` e `EMAIL`, severidade mínima e inclusão opcional de eventos
`RESOLVED`. Quando um alerta muda, a mesma transação cria eventos deduplicados em
`ecac_alert_notification_events` para usuários ativos cujas preferências aceitam
aquele tipo de mudança. A API lista a caixa de saída do usuário em
`GET /v1/control/ecac/notification-events`, com filtros por canal, status,
empresa, tipo de consulta, severidade, período de agendamento e limite de
retorno. Também permite marcar a entrega interna em
`POST /v1/control/ecac/notification-events/:eventId/deliver`. Para painéis e
suporte operacional, `GET /v1/control/ecac/notification-events/summary` resume
os eventos do usuário por status e canal, incluindo próxima pendência, última
entrega e última falha.

O worker de notificações processa essa caixa de saída em um processo separado.
Eventos `IN_APP` são entregues internamente. Eventos `EMAIL` chamam uma API HTTP
de envio quando `ECAC_EMAIL_PROVIDER=http`; com o provedor desabilitado, a falha
é terminal e auditável, sem retry inútil.

Cada job recebe uma sequência monotônica no PostgreSQL. Um cursor por empresa e
tipo de consulta usa essa sequência para impedir regressão do estado quando uma
resposta antiga termina depois de uma nova. A reconciliação usa um lock
transacional do PostgreSQL por fluxo; a conclusão do job, os achados, os alertas
e o cursor são gravados atomicamente.

## Privacidade e segurança

- O `tenantId` sempre vem do JWT.
- Chaves estrangeiras compostas impedem vínculos entre escritórios.
- Procuração e certificado são revalidados no momento do processamento.
- O certificado e sua senha não trafegam pelo caso de uso do Radar.
- A resposta bruta do provedor não é persistida.
- Alertas contêm apenas o achado normalizado e hashes, nunca o envelope bruto.
- Erros ficam limitados a mensagens sanitizadas de até 500 caracteres.
- Eventos relevantes geram auditoria sem conteúdo fiscal bruto.

## Permissões

| Papel | Consultar | Solicitar lote | Processar manualmente |
|---|---:|---:|---:|
| `OWNER` | Sim | Sim | Sim |
| `ADMIN` | Sim | Sim | Sim |
| `ACCOUNTANT` | Sim | Sim | Não |
| `VIEWER` | Sim | Não | Não |

O endpoint manual de processamento permanece como fallback administrativo. O
processamento normal em produção é feito por um processo separado:

```bash
npm run start:ecac-worker
```

O worker reivindica jobs vencidos globalmente, sem retirar o `tenantId` das
operações seguintes. O lote máximo, o intervalo e o TTL da posse são definidos
por `ECAC_WORKER_BATCH_SIZE`, `ECAC_WORKER_POLL_INTERVAL_MS` e
`ECAC_WORKER_LOCK_TTL_MS`.

Cada reivindicação recebe um token aleatório. Conclusão, adiamento, falha e
checkpoint SITFIS só são persistidos se o token ainda for o atual. Isso permite
recuperar jobs abandonados sem aceitar a conclusão atrasada de outro processo.
Os ciclos nunca se sobrepõem dentro da mesma instância, e `SIGINT`/`SIGTERM`
interrompem novas consultas depois que o ciclo atual termina.

Os logs do worker são JSON por linha e contêm apenas duração e contadores
(`claimed`, `succeeded`, `deferred`, `retryScheduled`, `failed` e `leaseLost`).
Mensagens internas de banco ou do provedor não são registradas.

## Adaptador Integra Contador

A conexão é configurada por escritório em
`PUT /v1/control/ecac/serpro-connection` e referencia um certificado A1 ativo do
cofre. A API persiste somente:

- CNPJ contratante e CNPJ autor do pedido;
- identificador do certificado contratante;
- Consumer Key e Consumer Secret cifradas com o keyring do cofre;
- metadados de configuração, situação e auditoria.

O adaptador segue o fluxo oficial do SERPRO:

1. abre a autenticação OAuth2 usando o certificado e-CNPJ via mTLS;
2. envia `client_credentials`, Basic Auth e `role-type: TERCEIROS`;
3. mantém Bearer e JWT apenas em memória até pouco antes da expiração;
4. renova uma vez quando a API devolve `401`;
5. envia Bearer e `jwt_token` na consulta do Integra Contador;
6. apaga os buffers descriptografados de PFX, senha e credenciais após o uso;
7. registra o uso do certificado sem tokens nem conteúdo fiscal.

O primeiro serviço real é o indicador de novas mensagens da Caixa Postal
`CAIXAPOSTAL/INNOVAMSG63`, usado pela consulta `MAILBOX`. A resposta é reduzida
ao código do serviço, ao indicador `0`, `1` ou `2` e a um achado normalizado. O
corpo bruto não é salvo.

A rotação do keyring também cobre a conexão SERPRO em
`POST /v1/control/ecac/serpro-connection/rotate-key`. A Consumer Key e a
Consumer Secret são recifradas na mesma atualização condicional, e a auditoria
registra apenas as versões anterior e nova.

`TAX_STATUS` usa o SITFIS `2.0` em duas chamadas. O serviço
`SITFIS/SOLICITARPROTOCOLO91` cria o protocolo em `/Apoiar`; depois,
`SITFIS/RELATORIOSITFIS92` recupera o relatório em `/Emitir`. Entre as chamadas:

- o protocolo fica cifrado em um checkpoint vinculado ao job e ao escritório;
- o job volta para `RETRY_SCHEDULED` sem consumir a franquia de falhas;
- o worker respeita `tempoEspera` em milissegundos e o `ETag` dos retornos
  `202`, `204` e `304`;
- uma resposta `ER05` apaga o protocolo anterior e reinicia por `/Apoiar`;
- o PDF é validado, reduzido a SHA-256 e tamanho e apagado da memória;
- o checkpoint e o job são concluídos na mesma transação;
- o conteúdo bruto do relatório não é salvo nem devolvido pela API.

Até a implementação do cofre documental F02, o Radar registra apenas o achado
normalizado `SITFIS_REPORT_PROCESSED`. Protocolos ainda ativos podem ser
recifrados em lotes por `POST /v1/control/ecac/sitfis/rotate-key`.

`DEBTS` permanece bloqueado até a seleção e implementação do serviço oficial
correspondente.

Para desenvolvimento local do worker, use `npm run dev:ecac-worker`. A API e o
worker são processos independentes e compartilham somente a fila persistida no
PostgreSQL.

Para desenvolvimento local do worker de notificações, use
`npm run dev:ecac-notification-worker`. As variáveis de entrega por e-mail são:

| Variável | Padrão | Uso |
|---|---:|---|
| `ECAC_EMAIL_PROVIDER` | `disabled` | Use `http` para habilitar envio externo |
| `ECAC_EMAIL_HTTP_URL` | vazio | Endpoint HTTPS de envio |
| `ECAC_EMAIL_HTTP_AUTHORIZATION` | vazio | Valor do cabeçalho `Authorization` |
| `ECAC_EMAIL_FROM` | vazio | Remetente usado nas notificações |
| `ECAC_EMAIL_SUBJECT_PREFIX` | `[API Fiscal]` | Prefixo do assunto |
| `ECAC_EMAIL_TIMEOUT_MS` | `10000` | Timeout de conexão e envio |
