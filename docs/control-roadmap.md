# Roadmap técnico do Control

O plano Control é grande demais para uma única entrega. A implementação será feita por fatias verticais, sempre com API, persistência, auditoria, documentação e testes.

| Etapa | Capacidades | Resultado |
|---|---|---|
| 0 | F52, F33 básica e RNF-03 | Cadastro multiempresa, auditoria e base para parâmetros por vigência |
| 1 | F01, F02 e F06 arquivo | Captura/importação, cofre e exportação contábil |
| 2 | F03 e F04 | Radar e-CAC e gestão segura de acessos |
| 3 | F34, F44, F45, F46 e F51 | Prazos, guias, parcelamentos, declarações e orçamento |
| 4 | F38 a F42 | Operação do Simples Nacional com regras versionadas |
| 5 | F31, F47 básica e F07 indicador | IRPF essencial, relatório de ISS e diagnóstico de classificação |

## Decisões obrigatórias

- As regras fiscais não serão constantes no código. Cada parâmetro terá vigência, jurisdição, fonte e hash da fonte.
- Credenciais e certificados não serão armazenados como texto aberto. O desenho de F04 deverá prever cofre de segredos e rotação.
- Captura de portais governamentais será assíncrona e idempotente, com fila resiliente e reprocessamento.
- Operações multiempresa sempre exigirão o identificador do escritório e autorização no contexto autenticado.
- Cadastro automático por CNPJ usa uma porta de integração substituível. O primeiro adaptador usa BrasilAPI; antes de produção será necessário definir SLA, limites e fornecedor principal/contingência.

## Próxima entrega recomendada

Adicionar autenticação, usuários, vínculos com escritórios e autorização por papel. Isso fecha a fundação necessária antes de persistir certificados, procurações, documentos fiscais ou dados de IRPF.
