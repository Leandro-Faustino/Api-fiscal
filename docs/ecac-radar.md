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
7. Falhas transitórias recebem backoff exponencial; falhas definitivas encerram
   somente o job afetado.
8. O lote termina como `SUCCEEDED`, `PARTIAL` ou `FAILED`.

## Privacidade e segurança

- O `tenantId` sempre vem do JWT.
- Chaves estrangeiras compostas impedem vínculos entre escritórios.
- Procuração e certificado são revalidados no momento do processamento.
- O certificado e sua senha não trafegam pelo caso de uso do Radar.
- A resposta bruta do provedor não é persistida.
- Erros ficam limitados a mensagens sanitizadas de até 500 caracteres.
- Eventos relevantes geram auditoria sem conteúdo fiscal bruto.

## Permissões

| Papel | Consultar | Solicitar lote | Processar manualmente |
|---|---:|---:|---:|
| `OWNER` | Sim | Sim | Sim |
| `ADMIN` | Sim | Sim | Sim |
| `ACCOUNTANT` | Sim | Sim | Não |
| `VIEWER` | Sim | Não | Não |

O endpoint manual de processamento existe para esta primeira fatia. Em produção,
ele deverá ser substituído por um worker autenticado de infraestrutura, com
agendamento, observabilidade e limites globais por provedor.

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

`TAX_STATUS` e `DEBTS` permanecem bloqueados no adaptador real até a próxima
fatia. O SITFIS exige solicitar protocolo, respeitar o tempo de espera e emitir
o relatório; essa máquina de estados será persistida, sem manter um processo
HTTP aberto ou criar espera ativa no worker.
