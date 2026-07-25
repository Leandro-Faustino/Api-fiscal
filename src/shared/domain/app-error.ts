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

export class ExternalServiceError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'EXTERNAL_SERVICE_UNAVAILABLE', 503, details);
  }
}
