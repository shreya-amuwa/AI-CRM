import { randomUUID } from 'node:crypto';

/**
 * SMTP without nodemailer, for the Cloudflare Worker: nodemailer needs Node's net / tls modules, which Workers do not provide; Workers
 * offer TCP through `connect()` from "cloudflare:sockets" instead. worker/entry.ts hands that function to useSocketConnector(); while
 * none is registered (Node.js: local development, Vercel, the tests) server/automations/providers.ts keeps using nodemailer.
 *
 * Supports what the CRM's mailbox needs (Google Workspace smtp.gmail.com): implicit TLS (port 465) or STARTTLS (587), AUTH PLAIN with an
 * app password, several recipients (to + cc + bcc), an HTML + text body and file attachments. The password is never sent unencrypted:
 * without TLS the send is refused (only a local test server on 127.0.0.1 / localhost may be plain).
 */

/** The shape of a Cloudflare socket (and of the Node.js test double). */
export interface SmtpSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  /** Only on a socket opened with tls "starttls": upgrades it in place and returns the encrypted socket. */
  startTls(): SmtpSocket;
  close(): Promise<void>;
}
export type SocketConnector = (address: { hostname: string; port: number }, options: { secureTransport: 'on' | 'off' | 'starttls'; allowHalfOpen?: boolean }) => SmtpSocket;

let connector: SocketConnector | null = null;

/** Called once by the Worker entry (worker/entry.ts) with cloudflare:sockets' connect. */
export function useSocketConnector(c: SocketConnector | null): void {
  connector = c;
}
export function socketConnector(): SocketConnector | null {
  return connector;
}

export interface SmtpServer {
  host: string;
  port: number;
  /** true: TLS from the first byte (465). false: STARTTLS (587). */
  secure: boolean;
  user: string;
  pass: string;
}

/** An SMTP reply that ended the send, with its code (null: no reply, e.g. the connection failed or timed out). */
export class SmtpError extends Error {
  constructor(public code: number | null, message: string) {
    super(message);
    this.name = 'SmtpError';
  }
}

// ---------------------------------------------------------------------------
// The message (RFC 5322 / MIME)
// ---------------------------------------------------------------------------
export interface MimeInput {
  from: { name: string; email: string };
  to: { name: string; email: string };
  cc: string[];
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Uint8Array; contentType: string }[];
  date?: Date;
  messageId?: string;
}

/** Header values never carry a line break (a CR / LF in a subject or name must not be able to add a header). */
const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').trim();
const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);
/** RFC 2047: non-ASCII text in a header as UTF-8 base64 "encoded words" (each at most 75 characters). */
function encodeWord(s: string): string {
  const v = oneLine(s);
  if (ascii(v)) return v;
  const words: string[] = [];
  let chunk = '';
  for (const ch of v) {
    // 45 bytes of UTF-8 -> 60 base64 characters + 12 of "=?UTF-8?B??=" stays under 75
    if (Buffer.byteLength(chunk + ch) > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map(w => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ');
}
function cleanAddress(email: string): string {
  const v = email.trim();
  if (!/^[^\s<>()",;:\\[\]]+@[^\s<>()",;:\\[\]]+$/.test(v)) throw new SmtpError(null, 'An e-mail address is not valid.');
  return v;
}
function mailbox(name: string, email: string): string {
  const addr = cleanAddress(email);
  const n = oneLine(name);
  if (!n || n === addr) return `<${addr}>`;
  return `${ascii(n) ? `"${n.replace(/["\\]/g, '\\$&')}"` : encodeWord(n)} <${addr}>`;
}
const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n');
const base64Part = (contentType: string, data: Uint8Array | string, extra: string[] = []) =>
  [`Content-Type: ${contentType}`, 'Content-Transfer-Encoding: base64', ...extra, '', wrap76(Buffer.from(data).toString('base64'))].join('\r\n');

export function buildMime(m: MimeInput): string {
  const domain = cleanAddress(m.from.email).split('@')[1];
  const boundary = (tag: string) => `=_amuwa_${tag}_${randomUUID().replace(/-/g, '')}`;
  const headers = [
    `From: ${mailbox(m.from.name, m.from.email)}`,
    `To: ${mailbox(m.to.name, m.to.email)}`,
    ...(m.cc.length ? [`Cc: ${m.cc.map(c => `<${cleanAddress(c)}>`).join(', ')}`] : []),
    ...(m.replyTo ? [`Reply-To: <${cleanAddress(m.replyTo)}>`] : []),
    `Subject: ${encodeWord(m.subject)}`,
    `Date: ${(m.date ?? new Date()).toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${m.messageId ?? `<${randomUUID()}@${domain}>`}`,
    'MIME-Version: 1.0'
  ];
  const alt = boundary('alt');
  const alternative = [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    base64Part('text/plain; charset=utf-8', m.text),
    `--${alt}`,
    base64Part('text/html; charset=utf-8', m.html),
    `--${alt}--`,
    ''
  ].join('\r\n');
  if (!m.attachments?.length) return `${headers.join('\r\n')}\r\n${alternative}`;
  const mixed = boundary('mix');
  const parts = m.attachments.map(a => {
    const file = oneLine(a.filename).replace(/["\\]/g, '_') || 'attachment';
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(a.contentType) ? a.contentType : 'application/octet-stream';
    const quoted = ascii(file) ? `"${file}"` : `"${encodeWord(file)}"`;
    return `--${mixed}\r\n${base64Part(`${type}; name=${quoted}`, a.content, [`Content-Disposition: attachment; filename=${quoted}`])}`;
  });
  return [`${headers.join('\r\n')}`, `Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}`, alternative, ...parts, `--${mixed}--`, ''].join('\r\n');
}

// ---------------------------------------------------------------------------
// The SMTP conversation
// ---------------------------------------------------------------------------
class Conversation {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = '';
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  constructor(public socket: SmtpSocket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  /** One complete reply (all its lines); throws unless its code is one of `expect`. */
  async reply(expect: number[], step: string): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    for (;;) {
      let nl = this.buffer.indexOf('\n');
      while (nl === -1) {
        const { value, done } = await this.reader.read();
        if (done) throw new SmtpError(null, `The mail server closed the connection (${step}).`);
        this.buffer += this.decoder.decode(value, { stream: true });
        if (this.buffer.length > 100_000) throw new SmtpError(null, 'The mail server sent an over-long reply.');
        nl = this.buffer.indexOf('\n');
      }
      const line = this.buffer.slice(0, nl).replace(/\r$/, '');
      this.buffer = this.buffer.slice(nl + 1);
      lines.push(line);
      const m = /^(\d{3})([ -]?)/.exec(line);
      if (!m) throw new SmtpError(null, `The mail server sent an unexpected reply (${step}).`);
      if (m[2] === '-') continue;
      const code = Number(m[1]);
      if (!expect.includes(code)) throw new SmtpError(code, `${step}: ${lines.map(l => l.slice(4)).join(' ').slice(0, 160)}`);
      return { code, lines };
    }
  }

  async send(text: string): Promise<void> {
    await this.writer.write(this.encoder.encode(text));
  }

  async command(line: string, expect: number[], step: string) {
    await this.send(`${line}\r\n`);
    return this.reply(expect, step);
  }

  /** Hands the socket to TLS: the plain streams are released first, as Cloudflare's startTls() requires. */
  upgrade(): void {
    this.reader.releaseLock();
    this.writer.releaseLock();
    this.socket = this.socket.startTls();
    this.reader = this.socket.readable.getReader();
    this.writer = this.socket.writable.getWriter();
    this.buffer = '';
  }

  async close(): Promise<void> {
    try {
      this.reader.releaseLock();
      this.writer.releaseLock();
    } catch {
      /* already released */
    }
    await this.socket.close().catch(() => undefined);
  }
}

const isLocal = (host: string) => host === '127.0.0.1' || host === 'localhost' || host === '::1';

export interface SmtpSendOptions {
  connect?: SocketConnector;
  timeoutMs?: number;
  /** Tests only: allow a plain (unencrypted) login on a non-local server. Never set in production. */
  allowPlaintext?: boolean;
}

/** Delivers one prepared message. Resolves with the server's final "250 ..." line; throws SmtpError otherwise. */
export async function smtpSendRaw(server: SmtpServer, envelope: { from: string; recipients: string[] }, message: string, opts: SmtpSendOptions = {}): Promise<string> {
  const connect = opts.connect ?? connector;
  if (!connect) throw new SmtpError(null, 'No socket connector is available for SMTP.');
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let conv: Conversation | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_r, reject) => {
    timer = setTimeout(() => reject(new SmtpError(null, 'The mail server did not answer in time.')), timeoutMs);
  });
  const run = async (): Promise<string> => {
    const socket = connect({ hostname: server.host, port: server.port }, { secureTransport: server.secure ? 'on' : 'starttls', allowHalfOpen: false });
    conv = new Conversation(socket);
    const c = conv;
    await c.reply([220], 'greeting');
    const ehloName = 'crm.amuwacorporation.com';
    let ehlo = await c.command(`EHLO ${ehloName}`, [250], 'EHLO');
    let encrypted = server.secure;
    if (!encrypted && ehlo.lines.some(l => /^250[ -]STARTTLS\b/i.test(l))) {
      await c.command('STARTTLS', [220], 'STARTTLS');
      c.upgrade();
      encrypted = true;
      ehlo = await c.command(`EHLO ${ehloName}`, [250], 'EHLO after STARTTLS');
    }
    if (!encrypted && !isLocal(server.host) && !opts.allowPlaintext) {
      throw new SmtpError(null, 'The mail server offers no encryption (STARTTLS): the password is not sent.');
    }
    const auth = Buffer.from(`\u0000${server.user}\u0000${server.pass}`).toString('base64');
    await c.command(`AUTH PLAIN ${auth}`, [235], 'sign-in');
    await c.command(`MAIL FROM:<${cleanAddress(envelope.from)}>`, [250], 'sender');
    for (const r of envelope.recipients) await c.command(`RCPT TO:<${cleanAddress(r)}>`, [250, 251], 'recipient');
    await c.command('DATA', [354], 'DATA');
    // dot-stuffing: a line that starts with "." gets a second one; the message ends with a line holding only "."
    const body = message.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    await c.send(`${body}${body.endsWith('\r\n') ? '' : '\r\n'}.\r\n`);
    const done = await c.reply([250], 'message');
    await c.command('QUIT', [221], 'QUIT').catch(() => undefined);
    return done.lines[done.lines.length - 1];
  };
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
    await (conv as Conversation | null)?.close();
  }
}
