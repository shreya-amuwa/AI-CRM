/** The part of the Workers runtime module "cloudflare:sockets" the Worker uses (see worker/entry.ts). */
declare module 'cloudflare:sockets' {
  export function connect(address: { hostname: string; port: number }, options?: { secureTransport?: 'on' | 'off' | 'starttls'; allowHalfOpen?: boolean }): unknown;
}
