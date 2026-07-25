import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../../domain/app-error.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      });
    }

    if ('validation' in error && error.validation) {
      return reply.status(400).send({
        error: {
          code: 'REQUEST_VALIDATION_ERROR',
          message: 'Os dados enviados são inválidos.',
          details: error.validation,
          requestId: request.id,
        },
      });
    }

    request.log.error({ err: error }, 'Unhandled request error');

    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Ocorreu um erro interno.',
        requestId: request.id,
      },
    });
  });
}
