import { describe, expect, it, vi } from 'vitest';
import type { ProcessEcacJobsResult } from '../application/use-cases/process-ecac-jobs.js';
import {
  EcacScheduledWorker,
  type EcacWorkerLogger,
} from '../infra/workers/ecac-scheduled-worker.js';

const emptySummary: ProcessEcacJobsResult = {
  claimed: 0,
  succeeded: 0,
  deferred: 0,
  retryScheduled: 0,
  failed: 0,
  leaseLost: 0,
};

function logger(): EcacWorkerLogger {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

describe('worker agendado do Radar e-CAC', () => {
  it('executa um ciclo com limites globais e registra somente métricas', async () => {
    const workerLogger = logger();
    const executeScheduled = vi.fn(async () => ({
      ...emptySummary,
      claimed: 2,
      succeeded: 1,
      deferred: 1,
    }));
    const worker = new EcacScheduledWorker({
      processEcacJobsUseCase: { executeScheduled },
      logger: workerLogger,
      pollIntervalMs: 30_000,
      batchSize: 25,
      lockTtlMs: 600_000,
    });

    await expect(worker.runCycle()).resolves.toMatchObject({
      claimed: 2,
      succeeded: 1,
      deferred: 1,
    });
    expect(executeScheduled).toHaveBeenCalledWith(25, 600_000);
    expect(workerLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        claimed: 2,
        succeeded: 1,
        deferred: 1,
        durationMs: expect.any(Number),
      }),
      'ecac.worker.cycle.completed',
    );
  });

  it('continua operável após falha e não registra a mensagem interna', async () => {
    const workerLogger = logger();
    const executeScheduled = vi.fn(async () => {
      throw new Error('conteúdo sensível do banco');
    });
    const worker = new EcacScheduledWorker({
      processEcacJobsUseCase: { executeScheduled },
      logger: workerLogger,
      pollIntervalMs: 30_000,
      batchSize: 25,
      lockTtlMs: 600_000,
    });

    await expect(worker.runCycle()).resolves.toBeNull();
    expect(workerLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: 'Error',
        errorCode: null,
      }),
      'ecac.worker.cycle.failed',
    );
    expect(JSON.stringify(vi.mocked(workerLogger.error).mock.calls)).not.toContain(
      'conteúdo sensível',
    );
  });

  it('não sobrepõe ciclos e encerra depois do ciclo atual', async () => {
    const workerLogger = logger();
    let completeCycle!: (result: ProcessEcacJobsResult) => void;
    const pendingCycle = new Promise<ProcessEcacJobsResult>((resolve) => {
      completeCycle = resolve;
    });
    const executeScheduled = vi.fn(async () => pendingCycle);
    const worker = new EcacScheduledWorker({
      processEcacJobsUseCase: { executeScheduled },
      logger: workerLogger,
      pollIntervalMs: 30_000,
      batchSize: 25,
      lockTtlMs: 600_000,
    });

    const running = worker.run();
    await vi.waitFor(() => expect(executeScheduled).toHaveBeenCalledTimes(1));
    worker.stop();
    completeCycle(emptySummary);
    await running;

    expect(executeScheduled).toHaveBeenCalledTimes(1);
    expect(workerLogger.info).toHaveBeenCalledWith({}, 'ecac.worker.stopped');
  });
});
