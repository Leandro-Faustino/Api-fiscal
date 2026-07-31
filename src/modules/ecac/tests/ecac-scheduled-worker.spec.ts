import { describe, expect, it, vi } from 'vitest';
import type { ProcessEcacJobsResult } from '../application/use-cases/process-ecac-jobs.js';
import type { RunEcacMonitoringResult } from '../application/use-cases/run-ecac-monitoring.js';
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

const emptyMonitoringSummary: RunEcacMonitoringResult = {
  claimed: 0,
  triggered: 0,
  failed: 0,
  paused: 0,
  leaseLost: 0,
};

function logger(): EcacWorkerLogger {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

function monitor(result: RunEcacMonitoringResult = emptyMonitoringSummary) {
  return {
    executeScheduled: vi.fn(
      async (_limit: number, _lockTtlMs: number) => result,
    ),
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
      runEcacMonitoringUseCase: monitor(),
      logger: workerLogger,
      pollIntervalMs: 30_000,
      batchSize: 25,
      monitoringBatchSize: 25,
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
      runEcacMonitoringUseCase: monitor(),
      logger: workerLogger,
      pollIntervalMs: 30_000,
      batchSize: 25,
      monitoringBatchSize: 25,
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
      runEcacMonitoringUseCase: monitor(),
      logger: workerLogger,
      pollIntervalMs: 30_000,
      batchSize: 25,
      monitoringBatchSize: 25,
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

  it('enfileira os planos vencidos antes de processar a fila', async () => {
    const workerLogger = logger();
    const monitoring = monitor({
      ...emptyMonitoringSummary,
      claimed: 3,
      triggered: 2,
      failed: 1,
    });
    const worker = new EcacScheduledWorker({
      processEcacJobsUseCase: { executeScheduled: vi.fn(async () => emptySummary) },
      runEcacMonitoringUseCase: monitoring,
      logger: workerLogger,
      pollIntervalMs: 30_000,
      batchSize: 25,
      monitoringBatchSize: 10,
      lockTtlMs: 600_000,
    });

    await expect(worker.runMonitoringCycle()).resolves.toMatchObject({
      claimed: 3,
      triggered: 2,
      failed: 1,
    });
    expect(monitoring.executeScheduled).toHaveBeenCalledWith(10, 600_000);
    expect(workerLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ triggered: 2, durationMs: expect.any(Number) }),
      'ecac.monitor.cycle.completed',
    );
  });

  it('mantém o processamento da fila quando o agendamento falha', async () => {
    const workerLogger = logger();
    const executeScheduled = vi.fn(async () => emptySummary);
    const worker = new EcacScheduledWorker({
      processEcacJobsUseCase: { executeScheduled },
      runEcacMonitoringUseCase: {
        executeScheduled: vi.fn(async () => {
          throw new Error('falha ao reivindicar planos');
        }),
      },
      logger: workerLogger,
      pollIntervalMs: 30_000,
      batchSize: 25,
      monitoringBatchSize: 25,
      lockTtlMs: 600_000,
    });

    await expect(worker.runMonitoringCycle()).resolves.toBeNull();
    await expect(worker.runCycle()).resolves.toMatchObject({ claimed: 0 });
    expect(workerLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ errorType: 'Error' }),
      'ecac.monitor.cycle.failed',
    );
    expect(executeScheduled).toHaveBeenCalledTimes(1);
  });
});
