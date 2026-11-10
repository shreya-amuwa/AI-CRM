/**
 * The Worker's entry point (wrangler.jsonc "main"). Kept apart from worker/index.ts because "cloudflare:sockets" exists only in the
 * Workers runtime: index.ts stays importable by the Node.js tests.
 *
 * Registers Cloudflare's TCP sockets so the SMTP mailbox (meta@amuwa.com, the fallback when Resend's limit is reached, or the main
 * provider with EMAIL_PROVIDER=smtp) can send from the Worker: see server/automations/smtpSocket.ts.
 */
import { connect } from 'cloudflare:sockets';
import { useSocketConnector, type SocketConnector } from '../server/automations/smtpSocket.js';
import worker from './index.js';

useSocketConnector(connect as unknown as SocketConnector);

export default worker;
