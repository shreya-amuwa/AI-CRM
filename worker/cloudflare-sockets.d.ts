/** Workers runtime modules used by worker/entry.ts: "cloudflare:sockets" (connect) and "cloudflare:workers" (env). */
declare module 'cloudflare:sockets' {
  export function connect(address: { hostname: string; port: number }, options?: { secureTransport?: 'on' | 'off' | 'starttls'; allowHalfOpen?: boolean }): unknown;
}

/** The Worker's bindings at module scope (see worker/entry.ts). */
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
