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

export async function readJson(request, maxBytes = 4096) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request is too large.');
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
