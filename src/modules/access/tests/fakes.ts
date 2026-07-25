import type {
  AccessSession,
  AuthContext,
  Invitation,
  Member,
} from '../domain/access.js';
import type {
  AcceptInvitationInput,
  AccessRepository,
  CreateInvitationInput,
  InvitationAcceptanceRecord,
  LoginRecord,
  RegisterTenantInput,
} from '../application/ports/access-repository.js';

export const sessionFixture: AccessSession = {
  userId: '10000000-0000-4000-8000-000000000001',
  membershipId: '20000000-0000-4000-8000-000000000001',
  tenantId: '30000000-0000-4000-8000-000000000001',
  tenantName: 'Escritório Teste',
  tenantSlug: 'escritorio-teste',
  role: 'OWNER',
  email: 'owner@example.com',
  name: 'Owner Teste',
};

export class FakeAccessRepository implements AccessRepository {
  public registerTenantInput: RegisterTenantInput | null = null;
  public registerTenantResult = sessionFixture;
  public loginRecord: LoginRecord | null = null;
  public successfulLogin: { userId: string; tenantId: string } | null = null;
  public pendingInvitation = false;
  public createInvitationInput: CreateInvitationInput | null = null;
  public invitationAcceptanceRecord: InvitationAcceptanceRecord | null = null;
  public acceptInvitationInput: AcceptInvitationInput | null = null;
  public members: Member[] = [];

  public async registerTenant(input: RegisterTenantInput): Promise<AccessSession> {
    this.registerTenantInput = input;
    return this.registerTenantResult;
  }

  public async findLoginRecord(): Promise<LoginRecord | null> {
    return this.loginRecord;
  }

  public async recordSuccessfulLogin(userId: string, tenantId: string): Promise<void> {
    this.successfulLogin = { userId, tenantId };
  }

  public async findAuthContext(): Promise<AuthContext | null> {
    return this.loginRecord;
  }

  public async hasPendingInvitation(): Promise<boolean> {
    return this.pendingInvitation;
  }

  public async createInvitation(input: CreateInvitationInput): Promise<Invitation> {
    this.createInvitationInput = input;
    return {
      id: '40000000-0000-4000-8000-000000000001',
      tenantId: input.tenantId,
      email: input.email,
      role: input.role,
      expiresAt: input.expiresAt,
      acceptedAt: null,
      createdAt: new Date(),
    };
  }

  public async findInvitationByTokenHash(): Promise<InvitationAcceptanceRecord | null> {
    return this.invitationAcceptanceRecord;
  }

  public async acceptInvitation(input: AcceptInvitationInput): Promise<AccessSession> {
    this.acceptInvitationInput = input;
    return sessionFixture;
  }

  public async listMembers(): Promise<Member[]> {
    return this.members;
  }
}
