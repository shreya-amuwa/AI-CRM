import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature V4 "query string" signing (presigned URLs) for S3-compatible storage such as Cloudflare R2.
 * No SDK needed: the server only ever hands out short-lived URLs and uses them itself (HEAD / ranged GET / DELETE).
 */
export interface PresignInput {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  host: string;
  /** `https` for Cloudflare R2; `http` only for a local test endpoint. */
  protocol?: 'http' | 'https';
  /** Path as it appears in the URL, already without encoding (e.g. `/bucket/customer-documents/a b.pdf`). */
  path: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  expiresSeconds: number;
  /** Extra query parameters, e.g. response-content-disposition. */
  query?: Record<string, string>;
  /** Headers that must be sent unchanged with the request (besides host), e.g. content-type for uploads. */
  signedHeaders?: Record<string, string>;
  now?: Date;
}

const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

export function presignUrl(i: PresignInput): string {
  const region = i.region ?? 'auto';
  const now = i.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;

  const headers: Record<string, string> = { host: i.host };
  for (const [k, v] of Object.entries(i.signedHeaders ?? {})) headers[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  const headerNames = Object.keys(headers).sort();

  const query: Record<string, string> = {
    ...(i.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${i.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(i.expiresSeconds),
    'X-Amz-SignedHeaders': headerNames.join(';')
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map(k => `${rfc3986(k)}=${rfc3986(query[k])}`)
    .join('&');
  const canonicalPath = i.path.split('/').map(rfc3986).join('/');
  const canonicalRequest = [
    i.method,
    canonicalPath,
    canonicalQuery,
    headerNames.map(n => `${n}:${headers[n]}\n`).join(''),
    headerNames.join(';'),
    'UNSIGNED-PAYLOAD'
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + i.secretAccessKey, dateStamp), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return `${i.protocol ?? 'https'}://${i.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
