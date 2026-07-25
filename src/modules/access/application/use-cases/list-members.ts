import type { Member } from '../../domain/access.js';
import type { AccessRepository } from '../ports/access-repository.js';

interface Dependencies {
  accessRepository: AccessRepository;
}

export class ListMembersUseCase {
  private readonly accessRepository: AccessRepository;

  public constructor({ accessRepository }: Dependencies) {
    this.accessRepository = accessRepository;
  }

  public async execute(tenantId: string): Promise<Member[]> {
    return this.accessRepository.listMembers(tenantId);
  }
}
