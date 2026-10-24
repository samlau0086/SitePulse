import Link from 'next/link';
import { getSession } from '../lib/session';

export default async function HomePage() {
  const session = await getSession();
  return (
    <main>
      <p className="muted">SITEPULSE / FOUNDATION</p>
      <h1>A workspace for your website operations.</h1>
      <p>
        {session
          ? 'Open your workspace to manage connected sites and view their latest inventory.'
          : 'Create an account and organize your team’s workspace. Website monitoring will arrive in a later milestone.'}
      </p>
      <p>
        {session ? (
          <Link className="button" href="/app">
            Open workspace
          </Link>
        ) : (
          <>
            <Link className="button" href="/register">
              Create account
            </Link>{' '}
            <Link href="/login">Log in</Link>
          </>
        )}
      </p>
    </main>
  );
}
