export const authJsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type, authorization'
};

export function authJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: authJsonHeaders });
}

export function authError(message: string, status = 400): Response {
  return authJson({ ok: false, error: message }, status);
}
