export type MembershipRole = 'OWNER' | 'ADMIN' | 'ACCOUNTANT' | 'VIEWER';

export type MembershipStatus = 'ACTIVE' | 'SUSPENDED';

export type UserStatus = 'ACTIVE' | 'BLOCKED';

export interface AuthContext {
  userId: string;
  membershipId: string;
  tenantId: string;
  tenantSlug: string;
  role: MembershipRole;
  email: string;
  name: string;
  securityVersion: number;
  mfaEnabled: boolean;
}

export interface AccessSession extends AuthContext {
  tenantName: string;
}

export interface Member {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: Date;
}

export interface Invitation {
  id: string;
  tenantId: string;
  email: string;
  role: MembershipRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}
