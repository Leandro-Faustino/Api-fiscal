import type {
  ProcessEcacJobsResult,
  ProcessEcacJobsUseCase,
} from '../../application/use-cases/process-ecac-jobs.js';

export type EcacWorkerLogContext = Record<
  string,
  string | number | boolean | null
>;

export interface EcacWorkerLogger {
  info(context: EcacWorkerLogContext, message: string): void;
  error(context: EcacWorkerLogContext, message: string): void;
}

interface Dependencies {
  processEcacJobsUseCase: Pick<ProcessEcacJobsUseCase, 'executeScheduled'>;
  logger: EcacWorkerLogger;
  pollIntervalMs: number;
  batchSize: number;
  lockTtlMs: number;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function safeErrorContext(error: unknown): EcacWorkerLogContext {
  if (!(error instanceof Error)) {
    return { errorType: 'unknown' };
  }

  const code =
    'code' in error &&
    (typeof error.code === 'string' || typeof error.code === 'number')
      ? String(error.code).slice(0, 80)
      : null;
  return {
    errorType: error.name.slice(0, 80),
    errorCode: code,
  };
}

export class EcacScheduledWorker {
  private readonly processor: Pick<ProcessEcacJobsUseCase, 'executeScheduled'>;
  private readonly logger: EcacWorkerLogger;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly lockTtlMs: number;
  private controller: AbortController | null = null;

  public constructor({
    processEcacJobsUseCase,
    logger,
    pollIntervalMs,
    batchSize,
    lockTtlMs,
  }: Dependencies) {
    this.processor = processEcacJobsUseCase;
    this.logger = logger;
    this.pollIntervalMs = pollIntervalMs;
    this.batchSize = batchSize;
    this.lockTtlMs = lockTtlMs;
  }

  public async runCycle(): Promise<ProcessEcacJobsResult | null> {
    const startedAt = Date.now();
    try {
      const result = await this.processor.executeScheduled(
        this.batchSize,
        this.lockTtlMs,
      );
      this.logger.info(
        {
          ...result,
          durationMs: Date.now() - startedAt,
        },
        'ecac.worker.cycle.completed',
      );
      return result;
    } catch (error: unknown) {
      this.logger.error(
        {
          ...safeErrorContext(error),
          durationMs: Date.now() - startedAt,
        },
        'ecac.worker.cycle.failed',
      );
      return null;
    }
  }

  public async run(): Promise<void> {
    if (this.controller !== null) {
      throw new Error('O worker e-CAC já está em execução.');
    }

    const controller = new AbortController();
    this.controller = controller;
    this.logger.info(
      {
        pollIntervalMs: this.pollIntervalMs,
        batchSize: this.batchSize,
        lockTtlMs: this.lockTtlMs,
      },
      'ecac.worker.started',
    );

    try {
      while (!controller.signal.aborted) {
        await this.runCycle();
        await wait(this.pollIntervalMs, controller.signal);
      }
    } finally {
      this.controller = null;
      this.logger.info({}, 'ecac.worker.stopped');
    }
  }

  public stop(): void {
    this.controller?.abort();
  }
}
