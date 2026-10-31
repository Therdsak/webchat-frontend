export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function isLineUserId(value: string) {
  return /^[A-Za-z0-9]{10,64}$/.test(value);
}
