/**
 * The Worker's entry point (wrangler.jsonc "main"). Kept apart from worker/index.ts because "cloudflare:sockets" exists only in the
 * Workers runtime: index.ts stays importable by the Node.js tests.
 *
 * Registers Cloudflare's TCP sockets so the SMTP mailbox (meta@amuwa.com, the fallback when Resend's limit is reached, or the main
 * provider with EMAIL_PROVIDER=smtp) can send from the Worker: see server/automations/smtpSocket.ts.
 */
import { connect } from 'cloudflare:sockets';
import { env } from 'cloudflare:workers';
import { useSocketConnector, type SocketConnector } from '../server/automations/smtpSocket.js';
import { useEdgeLimiter } from '../server/security/abuse.js';
import { useRuntimeBindings } from '../server/crocodial/runtime.js';
import worker from './index.js';

useSocketConnector(connect as unknown as SocketConnector);

// The Worker's own bindings: a server setting missing from process.env is looked up here too, and CF_VERSION_METADATA (wrangler.jsonc)
// names the running deployment on the Super Admin's Crocodial connection health. Only names / yes-no answers leave the server.
useRuntimeBindings(env as Record<string, unknown>);

// Per-address flood limit counted by Cloudflare (wrangler.jsonc "ratelimits"), instead of each short-lived isolate counting on its own.
const flood = (env as { FLOOD_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> } }).FLOOD_LIMITER;
if (flood) useEdgeLimiter(async key => (await flood.limit({ key })).success);

export default worker;
