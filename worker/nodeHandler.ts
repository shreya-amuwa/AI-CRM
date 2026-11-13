/**
 * Runs the two endpoints written as (req, res) handlers (api/proxy.ts and api/webhook.ts: the CORS helper and the inbound lead
 * webhook) inside the Cloudflare Worker, so both platforms run exactly the same, already tested handler code.
 *
 * Only what those handlers use is provided: method, url, headers (lower-case), query, body (the raw text, at most 1 MB) and
 * res.setHeader / status / json / send / end.
 */
// `any` only at this boundary: the handlers are typed with @vercel/node's request / response, of which this provides the used part.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NodeStyleHandler = (req: any, res: any) => unknown;

const MAX_BODY_BYTES = 1_000_000;

export async function runNodeStyleHandler(handler: NodeStyleHandler, request: Request): Promise<Response> {
  const url = new URL(request.url);

  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });

  const query: Record<string, string | string[]> = {};
  for (const [k, v] of url.searchParams) {
    const prev = query[k];
    query[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }

  let body: string | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BODY_BYTES) return Response.json({ error: 'Request body is too large.' }, { status: 413 });
    const buf = await request.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) return Response.json({ error: 'Request body is too large.' }, { status: 413 });
    body = buf.byteLength ? new TextDecoder().decode(buf) : undefined;
  }

  const req = {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    query,
    body,
    // An empty body: the webhook then reads the (empty) stream, as on Vercel, and answers "missing JSON body".
    async *[Symbol.asyncIterator]() {}
  };

  let status = 200;
  const outHeaders = new Headers();
  let payload: string | Uint8Array | null = null;
  let done = false;

  const res = {
    setHeader(name: string, value: string | number | readonly string[]) {
      outHeaders.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      return res;
    },
    status(code: number) {
      status = code;
      return res;
    },
    json(value: unknown) {
      if (!outHeaders.has('content-type')) outHeaders.set('content-type', 'application/json; charset=utf-8');
      payload = JSON.stringify(value);
      done = true;
      return res;
    },
    send(value: unknown) {
      if (value instanceof Uint8Array) payload = value;
      else if (typeof value === 'string') payload = value;
      else if (value !== undefined && value !== null) return res.json(value);
      done = true;
      return res;
    },
    end(value?: string) {
      if (typeof value === 'string') payload = value;
      done = true;
      return res;
    }
  };

  await handler(req, res);
  if (!done) return Response.json({ error: 'No response.' }, { status: 500 });
  // 204 / 304 must not carry a body
  return new Response(status === 204 || status === 304 ? null : payload, { status, headers: outHeaders });
}
