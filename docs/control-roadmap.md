# Roadmap técnico do Control

O plano Control é grande demais para uma única entrega. A implementação será feita por fatias verticais, sempre com API, persistência, auditoria, documentação e testes.

| Etapa | Capacidades | Resultado |
|---|---|---|
| 0 | F52, F33 básica e RNF-03 | Cadastro multiempresa, auditoria e base para parâmetros por vigência |
| Fundação de acesso | Autenticação, usuários, escritórios, vínculos e RBAC | Contexto autenticado e isolamento por escritório sem `tenantId` controlado pelo cliente |
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

## Fundação de acesso concluída

- Cadastro público cria escritório, proprietário e vínculo em uma única transação.
- Login emite JWT curto com contexto de escritório.
- Refresh token é rotativo, armazenado somente como hash e revogado por família
  quando há tentativa de reutilização.
- Logout revoga a família da sessão.
- Rotas públicas de autenticação possuem rate limiting.
- Cada requisição protegida revalida usuário e vínculo ativos no banco.
- Convites têm token de uso único armazenado como hash e validade parametrizada.
- Papéis: proprietário, administrador, contador e consulta.
- F52 deriva escritório e autor do contexto autenticado.

## Próxima entrega recomendada

Implementar recuperação segura de senha e MFA para papéis privilegiados antes de
disponibilizar a autenticação publicamente. Também substituir o armazenamento em
memória do rate limiting por Redis quando houver mais de uma instância e definir a
limpeza/retenção de sessões expiradas. Depois disso, iniciar a Etapa 1 com importação
idempotente de documentos.
