import { afterEach, expect, it, vi } from 'vitest';
import { getSession } from './session';

const { cookieValue } = vi.hoisted(() => ({ cookieValue: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ toString: cookieValue }),
}));
vi.mock('@sitepulse/config', () => ({
  parseWebEnvironment: () => ({ API_INTERNAL_ORIGIN: 'http://api:4000' }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('treats a visitor with no cookie as signed out without calling the API', async () => {
  cookieValue.mockReturnValue('');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  expect(await getSession()).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it('validates the cookie on the server without caching the session response', async () => {
  cookieValue.mockReturnValue('session=fixture');
  const session = { user: { id: 'fixture-user' } };
  const fetch = vi.fn().mockResolvedValue(Response.json(session));
  vi.stubGlobal('fetch', fetch);
  expect(await getSession()).toEqual(session);
  expect(fetch).toHaveBeenCalledWith('http://api:4000/api/v1/auth/session', {
    headers: { cookie: 'session=fixture' },
    cache: 'no-store',
  });
});
it('treats an expired or invalid session as signed out', async () => {
  cookieValue.mockReturnValue('session=expired');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
  );
  expect(await getSession()).toBeNull();
});
it('does not treat an unavailable API as a signed-out session', async () => {
  cookieValue.mockReturnValue('session=fixture');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
  );
  await expect(getSession()).rejects.toThrow('Unable to verify your session');
});
