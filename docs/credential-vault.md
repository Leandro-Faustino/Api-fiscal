# Modelo de segurança do cofre F04

Esta primeira fatia armazena certificados digitais A1 para uso futuro por
integrações fiscais. O cofre não implementa acesso ao e-CAC e não armazena senha
pessoal do gov.br.

## Fluxo de entrada

1. Somente `OWNER` ou `ADMIN` autenticado com MFA envia o PKCS#12 e sua senha.
2. A API valida estrutura, senha, certificado final e presença da chave privada.
3. Titular, emissor, serial, impressão SHA-256 e validade são extraídos do arquivo.
4. Pacote e senha são cifrados separadamente com AES-256-GCM.
5. O contexto autenticado da cifra inclui escritório, certificado e finalidade.
6. Certificado, escopos de CNPJ e auditoria são gravados na mesma transação.

## Propriedades garantidas

- O payload cifrado não é reutilizável em outro escritório ou campo sem falhar a
  autenticação GCM.
- A API de leitura retorna somente metadados.
- A associação certificado–empresa possui chave estrangeira composta por
  `tenant_id`, impedindo escopo entre escritórios também no banco.
- Revogação é lógica e auditada; o registro não é apagado.
- Arquivo inválido e senha incorreta produzem a mesma resposta.
- Novas gravações usam exclusivamente a chave ativa.
- Chaves anteriores ficam disponíveis somente para leitura durante a recifragem.
- A recifragem é idempotente, limitada por lote e auditada por certificado.
- Responsáveis são membros ativos do escritório; perfis somente leitura não podem
  receber responsabilidade operacional.
- Procurações ficam vinculadas à empresa, ao responsável e, quando aplicável, a
  um certificado A1 ativo e já autorizado para o mesmo CNPJ.
- Alertas de certificado e procuração são persistidos com marcos de 30, 15, 7 e
  1 dia, além do vencimento, e são deduplicados no banco.
- Reconhecer um alerta ou revogar uma procuração preserva o histórico e gera
  auditoria.

## Rotação de chave

1. Registrar uma nova chave como versão ativa e manter a versão anterior no
   keyring somente de leitura.
2. Reiniciar a aplicação e executar
   `POST /v1/control/credentials/certificates/rotate-key` em lotes de até 100.
3. Repetir enquanto `hasMore=true`.
4. Confirmar no banco que não há certificados com a versão antiga.
5. Remover a chave anterior da configuração e do provedor somente após essa
   conferência.

Uma atualização concorrente não sobrescreve conteúdo já recifrado: a persistência
compara a versão esperada antes de trocar os dois campos cifrados.

## Limites antes de produção

- O keyring ainda é fornecido por variáveis de ambiente. Certificados reais
  exigem KMS ou HSM, política de acesso da infraestrutura e backup seguro.
- O uso interno do certificado por integrações futuras deverá emitir uma
  autorização curta, registrar cada abertura e nunca disponibilizar bytes ao
  navegador.
- O disparo de e-mail e WhatsApp ainda depende do canal de notificações da F34.
  Nesta fase, os alertas ficam disponíveis pela API e a varredura pode ser
  acionada por endpoint protegido ou por um job futuro.
