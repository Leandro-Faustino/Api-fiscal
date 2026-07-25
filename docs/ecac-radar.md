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
