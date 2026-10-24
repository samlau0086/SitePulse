import { cookies } from 'next/headers';
import { parseWebEnvironment } from '@sitepulse/config';

type Session = { user: { id: string } };

export async function getSession(): Promise<Session | null> {
  const cookie = (await cookies()).toString();
  if (!cookie) return null;
  const env = parseWebEnvironment(process.env);
  const response = await fetch(
    `${env.API_INTERNAL_ORIGIN}/api/v1/auth/session`,
    { headers: { cookie }, cache: 'no-store' },
  );
  if (response.status === 401) return null;
  if (!response.ok)
    throw new Error('Unable to verify your session. Please try again.');
  return response.json() as Promise<Session>;
}
