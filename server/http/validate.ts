import type { ZodTypeAny, z } from 'zod';
import { fromZodError } from './errors.js';

/** Centralised validation: every controller input passes through here. */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw fromZodError(result.error);
  return result.data;
}
