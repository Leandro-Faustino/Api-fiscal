import { describe, expect, it } from 'vitest';
import { canInviteRole, hasPermission } from '../domain/permissions.js';

describe('permissões por papel', () => {
  it('permite consulta de empresas para todos os papéis', () => {
    expect(hasPermission('OWNER', 'companies:read')).toBe(true);
    expect(hasPermission('ADMIN', 'companies:read')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'companies:read')).toBe(true);
    expect(hasPermission('VIEWER', 'companies:read')).toBe(true);
  });

  it('mantém escrita e gestão fora do papel de consulta', () => {
    expect(hasPermission('VIEWER', 'companies:write')).toBe(false);
    expect(hasPermission('VIEWER', 'members:read')).toBe(false);
    expect(hasPermission('VIEWER', 'members:invite')).toBe(false);
  });

  it('nunca permite transferir propriedade por convite comum', () => {
    expect(canInviteRole('OWNER', 'OWNER')).toBe(false);
  });
});
