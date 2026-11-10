export class HttpError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

export function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

const TOO_LARGE = () => new HttpError(413, 'Request is too large.');

// Refuses on the declared length before reading anything, then reads the stream with a
// byte cap so an oversized body is never fully buffered (content-length can be absent or wrong).
async function readCapped(request, maxBytes) {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) throw TOO_LARGE();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw TOO_LARGE();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function readJson(request, maxBytes = 4096) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  const text = await readCapped(request, maxBytes);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Invalid JSON.');
  }
  return value;
}
