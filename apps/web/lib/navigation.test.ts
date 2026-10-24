import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import HomePage from '../app/page';
import LoginPage from '../app/login/page';
import RegisterPage from '../app/register/page';

const { session, redirect } = vi.hoisted(() => ({
  session: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error('redirect');
  }),
}));
vi.mock('./session', () => ({ getSession: session }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('../components/auth-form', () => ({
  AuthForm: () => 'Authentication form',
}));
afterEach(() => vi.clearAllMocks());

it('shows only the workspace action on the homepage for authenticated visitors', async () => {
  session.mockResolvedValue({ user: { id: 'fixture-user' } });
  const html = renderToStaticMarkup(await HomePage());
  expect(html).toContain('href="/app"');
  expect(html).not.toContain('href="/login"');
  expect(html).not.toContain('href="/register"');
});
it('keeps homepage login and registration available to anonymous visitors', async () => {
  session.mockResolvedValue(null);
  const html = renderToStaticMarkup(await HomePage());
  expect(html).toContain('href="/login"');
  expect(html).toContain('href="/register"');
});
it.each([LoginPage, RegisterPage])(
  'redirects authenticated visitors before rendering an authentication form',
  async (page) => {
    session.mockResolvedValue({ user: { id: 'fixture-user' } });
    await expect(page()).rejects.toThrow('redirect');
    expect(redirect).toHaveBeenCalledWith('/app');
  },
);
it.each([LoginPage, RegisterPage])(
  'renders the authentication form for anonymous visitors',
  async (page) => {
    session.mockResolvedValue(null);
    expect(renderToStaticMarkup(await page())).toContain('Authentication form');
    expect(redirect).not.toHaveBeenCalled();
  },
);
