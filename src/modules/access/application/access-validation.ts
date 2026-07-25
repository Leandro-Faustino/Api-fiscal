import { ValidationError } from '../../../shared/domain/app-error.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();

  if (!EMAIL_PATTERN.test(normalized)) {
    throw new ValidationError('Informe um e-mail válido.');
  }

  return normalized;
}

export function normalizeTenantSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();

  if (!SLUG_PATTERN.test(normalized) || normalized.length < 3 || normalized.length > 60) {
    throw new ValidationError(
      'O identificador do escritório deve ter de 3 a 60 caracteres, usando letras minúsculas, números e hífens.',
    );
  }

  return normalized;
}

export function validatePassword(password: string): void {
  if (
    password.length < 12 ||
    password.length > 128 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password)
  ) {
    throw new ValidationError(
      'A senha deve ter de 12 a 128 caracteres e incluir letra maiúscula, letra minúscula e número.',
    );
  }
}

export function validateName(name: string, field: string): string {
  const normalized = name.trim();

  if (normalized.length < 2 || normalized.length > 120) {
    throw new ValidationError(`${field} deve ter de 2 a 120 caracteres.`);
  }

  return normalized;
}
