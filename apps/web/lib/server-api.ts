import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { parseWebEnvironment } from '@sitepulse/config';

export async function serverApi<T>(path: string): Promise<T> {
  const env = parseWebEnvironment(process.env);
  const response = await fetch(`${env.API_INTERNAL_ORIGIN}/api/v1${path}`, {
    headers: { cookie: (await cookies()).toString() },
    cache: 'no-store',
  });
  if (response.status === 401) redirect('/login');
  if (!response.ok)
    throw new Error('Unable to load your workspace. Please try again.');
  return response.json() as Promise<T>;
}
