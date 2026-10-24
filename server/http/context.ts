import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * What is known about the request being served, available to code that has no access to the HTTP context (the database client
 * forwards the request id so audit rows can be tied back to the request that caused them).
 */
export interface RequestInfo {
  requestId: string;
  ip: string;
  /**
   * The department and function a Department Head asked to work in (headers x-active-department / x-active-division, already shape-checked).
   * They are forwarded to the database, which accepts them only when the Super Admin authorised that pair; they are never trusted here.
   */
  scope?: { department?: string; division?: string };
}

export const requestInfo = new AsyncLocalStorage<RequestInfo>();
