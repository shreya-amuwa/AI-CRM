import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * What is known about the request being served, available to code that has no access to the HTTP context (the database client
 * forwards the request id so audit rows can be tied back to the request that caused them).
 */
export interface RequestInfo {
  requestId: string;
  ip: string;
}

export const requestInfo = new AsyncLocalStorage<RequestInfo>();
