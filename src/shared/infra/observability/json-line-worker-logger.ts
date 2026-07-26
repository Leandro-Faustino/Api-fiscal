import type {
  EcacWorkerLogContext,
  EcacWorkerLogger,
} from '../../../modules/ecac/infra/workers/ecac-scheduled-worker.js';

function serialize(
  level: 'info' | 'error',
  context: EcacWorkerLogContext,
  message: string,
): string {
  return JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...context,
  });
}

export class JsonLineWorkerLogger implements EcacWorkerLogger {
  public info(context: EcacWorkerLogContext, message: string): void {
    process.stdout.write(`${serialize('info', context, message)}\n`);
  }

  public error(context: EcacWorkerLogContext, message: string): void {
    process.stderr.write(`${serialize('error', context, message)}\n`);
  }
}
