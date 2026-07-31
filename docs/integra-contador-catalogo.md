# Integra Contador — cobertura do catálogo e estratégia de teste

> ⚠️ **Como esta página foi levantada.** O ambiente de desenvolvimento usado na
> apuração não tem acesso de saída ao domínio
> `apicenter.estaleiro.serpro.gov.br`, onde fica a documentação oficial. O
> conteúdo abaixo vem de busca sobre as páginas públicas do SERPRO, não da
> leitura direta do catálogo. **Identificadores de serviço e nomes de campo
> precisam ser conferidos na documentação vigente antes de virar adaptador** —
> a mesma regra que a seção 11 do plano de produto aplica a número tributário.

## O que muda no plano de produto

O F03 promete "situação cadastral, certidões federais/estaduais/municipais/
trabalhistas, caixa postal de intimações, malha fiscal, e-processos e
PRONAMPE". O Integra Contador **não cobre esse conjunto inteiro**. Ele reúne
cerca de dez soluções e mais de oitenta serviços, organizados por sistema da
Receita — e certidão não é uma delas.

| Promessa do F03 | Fonte | Situação |
|---|---|---|
| Caixa postal de intimações | Integra Caixa Postal | Indicador implementado; lista e detalhe disponíveis no catálogo |
| Situação fiscal / pendências | Integra SITFIS | Implementado — devolve **PDF**, não dado estruturado |
| e-Processos | Integra e-Processo | Disponível no catálogo |
| Situação cadastral | Consulta cadastral de CNPJ | Já coberto pelo F52 por outro adaptador |
| **Certidões federais (CND)** | **API Consulta CND — produto separado do SERPRO** | Exige contrato e adaptador próprios |
| **Certidões estaduais, municipais e trabalhistas** | Fontes por UF, por município e o CNDT do TST | **Sem fonte única; nenhuma delas está no Integra Contador** |
| **Malha fiscal** | Sem serviço dedicado localizado | O relatório do SITFIS é o mais próximo, em PDF |
| **PRONAMPE** | Sem serviço localizado no catálogo | Rever a promessa ou encontrar a fonte |

**Consequência comercial, não só técnica:** "certidões federais/estaduais/
municipais/trabalhistas" no material do Control é uma promessa que hoje depende
de pelo menos três integrações fora do Integra Contador — uma delas paga à
parte, outra pulverizada em milhares de municípios. É o mesmo tipo de limitação
estrutural que o plano já reconhece para o ISS no F47, e merece o mesmo
tratamento: comunicar o escopo real antes de vender.

## Serviços relevantes para as próximas fatias

Identificadores levantados em fontes públicas — **conferir antes de codificar**:

| Sistema | Serviço | Uso no produto |
|---|---|---|
| `CAIXAPOSTAL` | `INNOVAMSG63` | Indicador de novas mensagens — **implementado** |
| `CAIXAPOSTAL` | `MSGCONTRIBUINTE61` | Lista de mensagens do contribuinte |
| `CAIXAPOSTAL` | `OBTERMSG62` | Detalhe de uma mensagem |
| `SITFIS` | `SOLICITARPROTOCOLO91`, `RELATORIOSITFIS92` | Relatório de situação fiscal — **implementado** |
| `EPROCESSO` | `CONSPROCPORINTER271` | Processos por interessado |

Outras soluções do catálogo alimentam etapas posteriores do roadmap, não o F03:
Integra SN e Integra MEI (F38 a F42), Integra DCTFWeb (F46), Integra
Parcelamento (F44), Integra SICALC e Integra Pagamento (F45), Integra
Procurações (F04).

## Estratégia de teste

O adaptador tem três camadas de verificação, da mais barata para a mais cara:

### 1. Contrato do envelope, sem rede

Testes unitários com a porta `SerproHttpTransport` substituída por um duplo.
Cobrem envelope enviado, parsing, códigos de erro, retentativa em `401`,
descarte de buffers sensíveis e o fluxo em duas fases do SITFIS. É onde cada
novo serviço deve ser especificado primeiro.

### 2. Ambiente de demonstração do SERPRO

O Integra Contador publica um ambiente de demonstração em
`https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1`, com
cenários fixos por sistema (SITFIS, PGDAS-D, PGMEI, DTE, e-Processo,
Procurações, PAGTOWEB, entre outros) e um Bearer de demonstração publicado na
própria documentação. Nele o cabeçalho `jwt_token` não é exigido e **não há
mTLS**: nenhum certificado real precisa sair do cofre.

O adaptador entra em modo demonstração quando `SERPRO_TRIAL_BEARER` está
definido:

| Variável | Uso |
|---|---|
| `SERPRO_TRIAL_BEARER` | Token de demonstração publicado pelo SERPRO |
| `SERPRO_API_BASE_URL` | Precisa apontar para `/integra-contador-trial/` |

A validação de ambiente recusa as duas combinações perigosas: Bearer de
demonstração com `NODE_ENV=production`, e Bearer de demonstração apontando para
a URL de produção. Em modo demonstração o adaptador não chama o endpoint de
autenticação, não abre o certificado do cofre, omite `jwt_token` e não repete a
consulta em `401` — um `401` ali significa token de demonstração errado, não
sessão expirada.

Para explorar um serviço **antes** de existir adaptador, há duas chamadas
avulsas que não tocam banco, cofre nem certificado. O arquivo
`.env.trial.example` traz o token público de demonstração e os CNPJs dos
cenários:

```bash
set -a && source .env.trial.example && set +a

# um serviço específico
npm run smoke:serpro-trial -- CAIXAPOSTAL MSGCONTRIBUINTE61 1.0

# a lista de serviços candidatos às próximas fatias, em um relatório único
npm run probe:serpro-trial > probe.json
```

A sondagem não precisa passar para ser útil: uma recusa por campo obrigatório
ausente **nomeia o campo** que o adaptador precisa enviar. É assim que o
contrato de um serviço novo vira teste da camada 1.

### 3. Contrato real, com certificado

Só depois do contrato assinado: conexão configurada em
`PUT /v1/control/ecac/serpro-connection`, certificado e-CNPJ no cofre,
procuração válida e um CNPJ da própria carteira. Esse é o único caminho que
exercita OAuth2 com mTLS ponta a ponta, e deve ficar restrito a um ambiente
com dados reais e auditoria ligada.

## Ordem sugerida das próximas fatias do F03

1. **Caixa Postal completa** (`MSGCONTRIBUINTE61` e `OBTERMSG62`). É a única
   lacuna do F03 que está no catálogo, tem cenário de demonstração e converte
   direto na promessa "zero intimação perdida". O indicador atual diz *que
   existe* mensagem nova; ele não diz *qual*.
2. **e-Processo** (`CONSPROCPORINTER271`), mesma mecânica, mesmo modo de teste.
3. **Certidões**, como decisão de produto antes de decisão técnica: contratar a
   API Consulta CND para a federal e definir explicitamente o que o produto
   promete sobre estaduais, municipais e trabalhistas.

Cada novo tipo de consulta reaproveita fila, detecção de mudanças, alertas,
notificações e monitoramento recorrente sem alteração estrutural: entra um
valor de enum e um adaptador.
