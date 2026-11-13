/**
 * Stands in for @hono/node-server in the Cloudflare Worker (wrangler.jsonc "alias"). server/app.ts imports it to build the Node.js
 * request listener used by Vercel, the Vite dev server and the tests; importing the real package replaces the global Response class,
 * which the Workers runtime then refuses ("the Promise did not resolve to 'Response'"). The Worker calls app.fetch directly, so the
 * listener made here is never called.
 */
export function getRequestListener(): () => never {
  return () => {
    throw new Error('The Node.js request listener is not used on Cloudflare Workers: worker/index.ts calls app.fetch.');
  };
}
