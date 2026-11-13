/**
 * A small SMTP server for tests: plain, STARTTLS (port 587 style) or TLS from the first byte (465 style), AUTH PLAIN with one known
 * account, recipients matching /reject/ refused with 550. Records every message with whether it travelled encrypted.
 * TLS uses a throw-away self-signed certificate made with openssl.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createNetServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createTlsServer, TLSSocket } from 'node:tls';

export interface ReceivedMail {
  from: string;
  rcpts: string[];
  data: string;
  /** the login and the message were sent over TLS */
  encrypted: boolean;
}
export interface FakeSmtp {
  port: number;
  mails: ReceivedMail[];
  /** AUTH attempts that arrived before encryption (must stay 0 for a real server) */
  plainLogins: number;
  close(): Promise<void>;
}

let cert: { key: string; cert: string } | null = null;
function selfSigned(): { key: string; cert: string } {
  if (cert) return cert;
  const dir = mkdtempSync(join(tmpdir(), 'fake-smtp-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  cert = { key: readFileSync(join(dir, 'k.pem'), 'utf8'), cert: readFileSync(join(dir, 'c.pem'), 'utf8') };
  rmSync(dir, { recursive: true, force: true });
  return cert;
}

export async function startFakeSmtp(opts: { mode: 'plain' | 'starttls' | 'tls'; user?: string; pass?: string }): Promise<FakeSmtp> {
  const user = opts.user ?? 'meta@amuwa.com';
  const pass = opts.pass ?? 'app-password';
  const state: FakeSmtp = { port: 0, mails: [], plainLogins: 0, close: async () => undefined };
  const tlsOpts = opts.mode === 'plain' ? null : selfSigned();

  const session = (initial: Socket, encryptedAtStart: boolean) => {
    let sock: Socket = initial;
    let encrypted = encryptedAtStart;
    let buf = '';
    let inData = false;
    let authed = false;
    let mail: ReceivedMail | null = null;
    const say = (line: string) => sock.write(`${line}\r\n`);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('latin1');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end === -1) return;
          mail!.data = Buffer.from(buf.slice(0, end), 'latin1').toString('utf8').replace(/^\.\./gm, '.');
          mail!.encrypted = encrypted;
          state.mails.push(mail!);
          mail = null;
          buf = buf.slice(end + 5);
          inData = false;
          say('250 2.0.0 OK queued as fake-1');
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) {
          sock.write(`250-fake.smtp.test\r\n${opts.mode === 'starttls' && !encrypted ? '250-STARTTLS\r\n' : ''}250 AUTH PLAIN LOGIN\r\n`);
        } else if (cmd === 'STARTTLS' && opts.mode === 'starttls' && !encrypted) {
          say('220 2.0.0 Ready to start TLS');
          sock.off('data', onData);
          const secure = new TLSSocket(sock, { isServer: true, key: tlsOpts!.key, cert: tlsOpts!.cert });
          secure.on('error', () => undefined);
          sock = secure;
          encrypted = true;
          buf = '';
          sock.on('data', onData);
          return;
        } else if (cmd.startsWith('AUTH PLAIN ')) {
          if (!encrypted) state.plainLogins++;
          const [, u, p] = Buffer.from(line.slice(11), 'base64').toString('utf8').split('\u0000');
          authed = u === user && p === pass;
          say(authed ? '235 2.7.0 Accepted' : '535 5.7.8 Username and Password not accepted');
        } else if (cmd.startsWith('MAIL FROM:')) {
          if (!authed) say('530 5.7.0 Authentication Required');
          else {
            mail = { from: line.slice(10).replace(/[<>]/g, ''), rcpts: [], data: '', encrypted };
            say('250 2.1.0 OK');
          }
        } else if (cmd.startsWith('RCPT TO:')) {
          const r = line.slice(8).replace(/[<>]/g, '');
          if (/reject/.test(r)) say('550 5.1.1 The email account that you tried to reach does not exist');
          else {
            mail?.rcpts.push(r);
            say('250 2.1.5 OK');
          }
        } else if (cmd === 'DATA') {
          inData = true;
          say('354 Go ahead');
        } else if (cmd === 'QUIT') {
          say('221 2.0.0 closing connection');
          sock.end();
          return;
        } else say('502 5.5.1 Unrecognized command');
      }
    };
    sock.on('data', onData);
    sock.on('error', () => undefined);
    say('220 fake.smtp.test ESMTP ready');
  };

  const server: Server =
    opts.mode === 'tls'
      ? createTlsServer({ key: tlsOpts!.key, cert: tlsOpts!.cert }, s => session(s, true))
      : createNetServer(s => session(s, false));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  state.port = (server.address() as { port: number }).port;
  state.close = () => new Promise<void>(r => server.close(() => r()));
  return state;
}

/** The decoded text of a MIME part with the given content type (base64 parts only, as the CRM writes them). */
export function mimePart(raw: string, contentType: string): string | null {
  const i = raw.indexOf(`Content-Type: ${contentType}`);
  if (i === -1) return null;
  const rest = raw.slice(i);
  const start = rest.indexOf('\r\n\r\n');
  const end = rest.indexOf('\r\n--', start);
  return Buffer.from(rest.slice(start + 4, end === -1 ? undefined : end).replace(/\s+/g, ''), 'base64').toString('utf8');
}
