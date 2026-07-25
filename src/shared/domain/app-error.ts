export class AppError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class NotFoundError extends AppError {
  public constructor(message: string, code = 'NOT_FOUND') {
    super(message, code, 404);
  }
}

export class ConflictError extends AppError {
  public constructor(message: string, code = 'CONFLICT') {
    super(message, code, 409);
  }
}

export class UnauthorizedError extends AppError {
  public constructor(message = 'Autenticação necessária.', code = 'UNAUTHORIZED') {
    super(message, code, 401);
  }
}

export class ForbiddenError extends AppError {
  public constructor(message = 'Você não tem permissão para executar esta operação.') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class ExternalServiceError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'EXTERNAL_SERVICE_UNAVAILABLE', 503, details);
  }
}
