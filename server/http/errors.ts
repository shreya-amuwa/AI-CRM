import type { PostgrestError } from '@supabase/supabase-js';
import { ZodError } from 'zod';
import type { ApiErrorBody, ErrorCode } from '../../shared/contracts.js';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  ACCOUNT_INACTIVE: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  VALIDATION_ERROR: 422,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503
};

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Please sign in to continue.',
  ACCOUNT_INACTIVE: 'Your account is not active.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  METHOD_NOT_ALLOWED: 'Method not allowed.',
  CONFLICT: 'The request conflicts with existing data.',
  VALIDATION_ERROR: 'The request contains invalid data.',
  INTERNAL: 'Something went wrong. Please try again.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.'
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: unknown
  ) {
    super(message || DEFAULT_MESSAGES[code]);
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }

  toBody(): ApiErrorBody {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

/** Messages raised by our SQL functions start with an application code. */
const DB_MESSAGE_PREFIX = /^(FORBIDDEN|NOT_FOUND|CONFLICT|VALIDATION_ERROR): (.+)$/s;

/**
 * Map a PostgREST/Postgres error to an AppError without leaking database
 * internals (table names, constraint names, SQL) to the client.
 */
export function fromDatabaseError(error: PostgrestError | null | undefined): AppError {
  if (!error) return new AppError('INTERNAL');
  const prefixed = DB_MESSAGE_PREFIX.exec(error.message || '');
  if (prefixed) return new AppError(prefixed[1] as ErrorCode, prefixed[2]);

  switch (error.code) {
    case '42501':
      return new AppError('FORBIDDEN');
    case '23505':
      return new AppError('CONFLICT', 'A record with these details already exists.');
    case '23503':
      return new AppError('CONFLICT', 'This record is referenced by other data or references missing data.');
    case '23514':
    case '23502':
    case '22P02':
    case '22001':
      return new AppError('VALIDATION_ERROR');
    case 'PGRST116':
      return new AppError('NOT_FOUND');
    case 'PGRST301':
    case 'PGRST302':
      return new AppError('UNAUTHENTICATED');
    default:
      console.error('[api] unmapped database error', { code: error.code, message: error.message });
      return new AppError('INTERNAL');
  }
}

export function fromZodError(error: ZodError): AppError {
  return new AppError(
    'VALIDATION_ERROR',
    error.issues[0]?.message || undefined,
    error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
  );
}
