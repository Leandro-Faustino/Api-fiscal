import type { MembershipRole } from './access.js';

export type Permission =
  | 'companies:read'
  | 'companies:write'
  | 'credentials:read'
  | 'credentials:write'
  | 'members:read'
  | 'members:invite';

const rolePermissions: Record<MembershipRole, ReadonlySet<Permission>> = {
  OWNER: new Set([
    'companies:read',
    'companies:write',
    'credentials:read',
    'credentials:write',
    'members:read',
    'members:invite',
  ]),
  ADMIN: new Set([
    'companies:read',
    'companies:write',
    'credentials:read',
    'credentials:write',
    'members:read',
    'members:invite',
  ]),
  ACCOUNTANT: new Set(['companies:read', 'companies:write', 'credentials:read']),
  VIEWER: new Set(['companies:read']),
};

export function hasPermission(role: MembershipRole, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}

export function canInviteRole(actorRole: MembershipRole, invitedRole: MembershipRole): boolean {
  if (invitedRole === 'OWNER') {
    return false;
  }

  if (invitedRole === 'ADMIN') {
    return actorRole === 'OWNER';
  }

  return actorRole === 'OWNER' || actorRole === 'ADMIN';
}
