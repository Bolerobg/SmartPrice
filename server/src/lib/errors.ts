import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Нужен е вход в профила.') =>
  new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Нямаш права за това действие.') =>
  new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'Не е намерено.') => new AppError(404, 'not_found', msg);
export const conflict = (msg: string) => new AppError(409, 'conflict', msg);
export const tooLarge = (msg: string) => new AppError(413, 'payload_too_large', msg);
export const unavailable = (msg: string) => new AppError(503, 'unavailable', msg);

export function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof AppError) {
    return reply.status(err.statusCode).send({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
  }
  if (err instanceof ZodError) {
    return reply.status(422).send({
      error: {
        code: 'validation_failed',
        message: 'Подадените данни са невалидни.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  const pgErr = err as { code?: string; constraint?: string; detail?: string };
  if (pgErr?.code === '23505') {
    return reply.status(409).send({
      error: {
        code: 'duplicate',
        message: 'Вече съществува такъв запис.',
        details: pgErr.constraint,
      },
    });
  }
  if (pgErr?.code === '23503') {
    return reply.status(400).send({
      error: { code: 'bad_reference', message: 'Липсва свързан запис.', details: pgErr.detail },
    });
  }
  if (pgErr?.code === '23514') {
    return reply.status(422).send({
      error: {
        code: 'constraint_failed',
        message: 'Данните не спазват правилата на базата.',
        details: pgErr.constraint,
      },
    });
  }
  // eslint-disable-next-line no-console
  console.error('[api] неочаквана грешка:', err);
  return reply.status(500).send({
    error: { code: 'internal_error', message: 'Вътрешна грешка на сървъра.' },
  });
}
