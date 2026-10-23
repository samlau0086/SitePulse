export async function api<T>(
  path: string,
  body?: unknown,
  method = 'POST',
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error?.message ?? 'Request failed. Please try again.');
  return data as T;
}
