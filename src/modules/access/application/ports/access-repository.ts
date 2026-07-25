import type {
  AccessSession,
  AuthContext,
  Invitation,
  Member,
  MembershipRole,
} from '../../domain/access.js';

export interface LoginRecord extends AccessSession {
  passwordHash: string;
  userStatus: 'ACTIVE' | 'BLOCKED';
  membershipStatus: 'ACTIVE' | 'SUSPENDED';
}

export interface InvitationAcceptanceRecord extends Invitation {
  tenantSlug: string;
  existingUserId: string | null;
  existingUserPasswordHash: string | null;
  existingUserStatus: 'ACTIVE' | 'BLOCKED' | null;
}

export interface RegisterTenantInput {
  tenantName: string;
  tenantSlug: string;
  userName: string;
  email: string;
  passwordHash: string;
}

export interface CreateInvitationInput {
  tenantId: string;
  createdById: string;
  email: string;
  role: MembershipRole;
  tokenHash: string;
  expiresAt: Date;
}

export interface AcceptInvitationInput {
  invitationId: string;
  userId: string | null;
  userName: string;
  email: string;
  passwordHash: string | null;
}

export interface AccessRepository {
  registerTenant(input: RegisterTenantInput): Promise<AccessSession>;
  findLoginRecord(email: string, tenantSlug: string): Promise<LoginRecord | null>;
  recordSuccessfulLogin(userId: string, tenantId: string): Promise<void>;
  findAuthContext(
    userId: string,
    membershipId: string,
    tenantId: string,
    securityVersion: number,
  ): Promise<AuthContext | null>;
  hasPendingInvitation(tenantId: string, email: string): Promise<boolean>;
  createInvitation(input: CreateInvitationInput): Promise<Invitation>;
  findInvitationByTokenHash(tokenHash: string): Promise<InvitationAcceptanceRecord | null>;
  acceptInvitation(input: AcceptInvitationInput): Promise<AccessSession>;
  listMembers(tenantId: string): Promise<Member[]>;
}
