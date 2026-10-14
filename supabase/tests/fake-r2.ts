import http from 'node:http';
import crypto from 'node:crypto';
import { presignUrl } from '../../server/storage/sigv4.js';

/**
 * A tiny S3-compatible endpoint standing in for Cloudflare R2 in tests: it accepts PUT / GET (with Range) / HEAD / DELETE
 * ONLY for correctly signed, unexpired presigned URLs (the signature is recomputed with the same SigV4 code that was
 * checked against the AWS documented test vector). With `cors: true` it answers browser preflights like a bucket with a
 * CORS rule would.
 */
export async function startFakeR2(opts: { key: string; secret: string; bucket: string; cors?: boolean; port?: number }) {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const server = http.createServer((req, res) => {
    const cors: Record<string, string> = opts.cors
      ? { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, HEAD, DELETE', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Expose-Headers': 'ETag' }
      : {};
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const u = new URL(req.url!, `http://${req.headers.host}`);
      const q = new Map(u.searchParams);
      const signedNames = (q.get('X-Amz-SignedHeaders') || '').split(';').filter(h => h && h !== 'host');
      const date = q.get('X-Amz-Date') || '';
      const at = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
      const extra: Record<string, string> = {};
      for (const [k, v] of q) if (!k.startsWith('X-Amz-')) extra[k] = v;
      const expected = presignUrl({
        method: req.method as 'GET', host: req.headers.host!, protocol: 'http', path: decodeURIComponent(u.pathname), accessKeyId: opts.key, secretAccessKey: opts.secret,
        expiresSeconds: Number(q.get('X-Amz-Expires')), query: extra, now: at,
        signedHeaders: Object.fromEntries(signedNames.map(n => [n, String(req.headers[n] ?? '')]))
      });
      const ok = new URL(expected).searchParams.get('X-Amz-Signature') === q.get('X-Amz-Signature') && Date.now() < at.getTime() + Number(q.get('X-Amz-Expires')) * 1000;
      if (!ok) { res.writeHead(403, cors).end('SignatureDoesNotMatch'); return; }
      const key = decodeURIComponent(u.pathname).replace(`/${opts.bucket}/`, '');
      const body = Buffer.concat(chunks);
      const etag = (b: Buffer) => `"${crypto.createHash('md5').update(b).digest('hex')}"`;
      if (req.method === 'PUT') {
        objects.set(key, { body, type: String(req.headers['content-type'] || '') });
        res.writeHead(200, { ...cors, ETag: etag(body) }).end();
      } else if (req.method === 'DELETE') {
        objects.delete(key);
        res.writeHead(204, cors).end();
      } else {
        const o = objects.get(key);
        if (!o) { res.writeHead(404, cors).end(); return; }
        const range = /bytes=(\d+)-(\d+)/.exec(String(req.headers.range || ''));
        const out = range ? o.body.subarray(Number(range[1]), Number(range[2]) + 1) : o.body;
        res.writeHead(range ? 206 : 200, {
          ...cors,
          'Content-Length': String(req.method === 'HEAD' ? o.body.length : out.length),
          'Content-Type': o.type,
          ETag: etag(o.body),
          ...(extra['response-content-disposition'] ? { 'Content-Disposition': extra['response-content-disposition'] } : {})
        });
        res.end(req.method === 'HEAD' ? undefined : out);
      }
    });
  });
  await new Promise<void>(r => server.listen(opts.port ?? 0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { server, objects, port, endpoint: `http://127.0.0.1:${port}` };
}
