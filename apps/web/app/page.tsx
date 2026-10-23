import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <p className="muted">SITEPULSE / FOUNDATION</p>
      <h1>A workspace for your website operations.</h1>
      <p>
        Create an account and organize your team’s workspace. Website monitoring
        will arrive in a later milestone.
      </p>
      <p>
        <Link className="button" href="/register">
          Create account
        </Link>{' '}
        <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
