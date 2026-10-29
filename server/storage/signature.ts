/** Does the start of a file look like the given type? (file signature - never the name or the declared type alone) */
export function matchesSignature(head: Buffer, mimeType: string): boolean {
  const ascii = (from: number, to: number) => head.subarray(from, to).toString('latin1');
  switch (mimeType) {
    case 'application/pdf':
      return head.toString('latin1').includes('%PDF-');
    case 'image/png':
      return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'application/x-amuwa-e2ee':
      // a file encrypted in the browser: our envelope header ("AME2", version 1), then the nonce and the AES-GCM ciphertext. The server never sees what is inside.
      return head.subarray(0, 4).toString('latin1') === 'AME2' && head[4] === 1;
    case 'audio/wav':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
    case 'audio/mp4':
      return ascii(4, 8) === 'ftyp';
    case 'audio/mpeg':
      return ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    case 'text/csv': {
      // Plain text: no NUL bytes and valid UTF-8 (ignoring a cut-off final character).
      if (head.length === 0 || head.includes(0)) return false;
      const text = new TextDecoder('utf-8', { fatal: false }).decode(head);
      return !text.slice(0, -1).includes('�');
    }
    default:
      return false;
  }
}
