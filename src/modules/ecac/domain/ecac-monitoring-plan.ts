import type { EcacQueryType } from './ecac-radar.js';

export type EcacMonitoringPlanStatus = 'ACTIVE' | 'PAUSED';

export const MINIMUM_MONITORING_INTERVAL_MINUTES = 60;
export const MAXIMUM_MONITORING_INTERVAL_MINUTES = 44_640;
export const MONITORING_FAILURES_BEFORE_PAUSE = 5;

export interface EcacMonitoringPlan {
  id: string;
  tenantId: string;
  companyId: string;
  powerOfAttorneyId: string;
  queryType: EcacQueryType;
  status: EcacMonitoringPlanStatus;
  intervalMinutes: number;
  maxAttempts: number;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastBatchId: string | null;
  lastFailureAt: Date | null;
  lastFailureCode: string | null;
  consecutiveFailures: number;
  triggeredRuns: number;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClaimedEcacMonitoringPlan {
  id: string;
  lockToken: string;
  tenantId: string;
  companyId: string;
  powerOfAttorneyId: string;
  queryType: EcacQueryType;
  intervalMinutes: number;
  maxAttempts: number;
  consecutiveFailures: number;
  scheduledFor: Date;
  createdById: string;
}

/**
 * Avança a agenda em múltiplos inteiros do intervalo até passar de `now`.
 *
 * Manter a grade original preserva o horário escolhido pelo contador. Descartar
 * as janelas vencidas evita que uma indisponibilidade longa do portal vire uma
 * rajada de consultas retroativas quando o serviço voltar (RNF-01).
 */
export function computeNextMonitoringRun(
  scheduledFor: Date,
  intervalMinutes: number,
  now: Date,
): Date {
  const intervalMs = intervalMinutes * 60_000;
  const elapsed = now.getTime() - scheduledFor.getTime();
  const skippedWindows = elapsed < 0 ? 0 : Math.floor(elapsed / intervalMs) + 1;
  return new Date(scheduledFor.getTime() + skippedWindows * intervalMs);
}

/**
 * Chave idempotente do disparo automático.
 *
 * O plano e a janela agendada identificam o lote. Dois agendadores que reivindiquem
 * a mesma janela produzem a mesma chave e o segundo recebe o lote já criado.
 */
export function monitoringRequestKey(planId: string, scheduledFor: Date): string {
  return `monitor:${planId}:${scheduledFor.toISOString()}`;
}
