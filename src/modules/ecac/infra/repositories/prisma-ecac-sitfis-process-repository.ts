import type { PrismaClient } from '@prisma/client';
import type {
  EcacSitfisProcessRepository,
  EncryptedSitfisProtocol,
  ResetSitfisProtocolInput,
  RotateSitfisProtocolInput,
  SaveSitfisCheckpointInput,
} from '../../application/ports/ecac-sitfis-process-repository.js';
import type { EcacSitfisProcess } from '../../domain/ecac-sitfis-process.js';

interface Dependencies {
  prismaClient: PrismaClient;
}

export class PrismaEcacSitfisProcessRepository
  implements EcacSitfisProcessRepository
{
  private readonly prisma: PrismaClient;

  public constructor({ prismaClient }: Dependencies) {
    this.prisma = prismaClient;
  }

  public async find(
    tenantId: string,
    jobId: string,
  ): Promise<EcacSitfisProcess | null> {
    return this.prisma.ecacSitfisProcess.findUnique({
      where: { tenantId_jobId: { tenantId, jobId } },
    });
  }

  public async saveCheckpointWithAudit(
    input: SaveSitfisCheckpointInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const job = await transaction.ecacSyncJob.findFirst({
        where: {
          id: input.jobId,
          tenantId: input.tenantId,
          companyId: input.companyId,
          queryType: 'TAX_STATUS',
          status: 'PROCESSING',
          lockToken: input.lockToken,
        },
        select: { id: true },
      });
      if (!job) {
        return;
      }

      await transaction.ecacSitfisProcess.upsert({
        where: {
          tenantId_jobId: {
            tenantId: input.tenantId,
            jobId: input.jobId,
          },
        },
        create: {
          id: input.id,
          tenantId: input.tenantId,
          jobId: input.jobId,
          companyId: input.companyId,
          status: input.status,
          encryptedProtocol: input.encryptedProtocol,
          protocolKeyVersion: input.protocolKeyVersion,
          protocolHash: input.protocolHash,
          nextAttemptAt: input.nextAttemptAt,
          providerStatus: input.providerStatus,
        },
        update: {
          status: input.status,
          encryptedProtocol: input.encryptedProtocol,
          protocolKeyVersion: input.protocolKeyVersion,
          protocolHash: input.protocolHash,
          nextAttemptAt: input.nextAttemptAt,
          providerStatus: input.providerStatus,
          reportHash: null,
          completedAt: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: null,
          action:
            input.status === 'AWAITING_REPORT'
              ? 'ecac.sitfis.protocol_received'
              : 'ecac.sitfis.protocol_wait_scheduled',
          entityType: 'ecac_sync_job',
          entityId: input.jobId,
          metadata: {
            companyId: input.companyId,
            status: input.status,
            providerStatus: input.providerStatus,
            nextAttemptAt: input.nextAttemptAt.toISOString(),
            hasProtocol: input.encryptedProtocol !== null,
            occurredAt: input.occurredAt.toISOString(),
          },
        },
      });
    });
  }

  public async resetProtocolWithAudit(
    input: ResetSitfisProtocolInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const process = await transaction.ecacSitfisProcess.findUnique({
        where: {
          tenantId_jobId: {
            tenantId: input.tenantId,
            jobId: input.jobId,
          },
        },
      });
      if (!process || process.status === 'COMPLETED') {
        return;
      }

      const lease = await transaction.ecacSyncJob.count({
        where: {
          id: input.jobId,
          tenantId: input.tenantId,
          status: 'PROCESSING',
          lockToken: input.lockToken,
        },
      });
      if (lease !== 1) {
        return;
      }

      await transaction.ecacSitfisProcess.update({
        where: { id: process.id },
        data: {
          status: 'AWAITING_PROTOCOL',
          encryptedProtocol: null,
          protocolKeyVersion: null,
          protocolHash: null,
          nextAttemptAt: input.nextAttemptAt,
          providerStatus: input.providerStatus,
        },
      });
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: null,
          action: 'ecac.sitfis.protocol_reset',
          entityType: 'ecac_sync_job',
          entityId: input.jobId,
          metadata: {
            companyId: process.companyId,
            providerStatus: input.providerStatus,
            nextAttemptAt: input.nextAttemptAt.toISOString(),
            occurredAt: input.occurredAt.toISOString(),
          },
        },
      });
    });
  }

  public async listEncryptedForRotation(
    tenantId: string,
    targetKeyVersion: number,
    limit: number,
  ): Promise<EncryptedSitfisProtocol[]> {
    const rows = await this.prisma.ecacSitfisProcess.findMany({
      where: {
        tenantId,
        status: 'AWAITING_REPORT',
        encryptedProtocol: { not: null },
        protocolKeyVersion: { not: targetKeyVersion },
      },
      select: {
        id: true,
        jobId: true,
        encryptedProtocol: true,
        protocolKeyVersion: true,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.flatMap((row) =>
      row.encryptedProtocol !== null && row.protocolKeyVersion !== null
        ? [
            {
              id: row.id,
              jobId: row.jobId,
              encryptedProtocol: row.encryptedProtocol,
              protocolKeyVersion: row.protocolKeyVersion,
            },
          ]
        : [],
    );
  }

  public async rotateEncryptionWithAudit(
    input: RotateSitfisProtocolInput,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const update = await transaction.ecacSitfisProcess.updateMany({
        where: {
          id: input.processId,
          tenantId: input.tenantId,
          status: 'AWAITING_REPORT',
          protocolKeyVersion: input.expectedKeyVersion,
        },
        data: {
          encryptedProtocol: input.encryptedProtocol,
          protocolKeyVersion: input.targetKeyVersion,
        },
      });
      if (update.count === 0) {
        return false;
      }
      await transaction.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorId: input.actorId,
          action: 'ecac.sitfis.protocol_key_rotated',
          entityType: 'ecac_sync_job',
          entityId: input.jobId,
          metadata: {
            processId: input.processId,
            previousKeyVersion: input.expectedKeyVersion,
            targetKeyVersion: input.targetKeyVersion,
          },
        },
      });
      return true;
    });
  }
}
