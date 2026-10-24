import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '../../lib/session';
import { AuthForm } from '../../components/auth-form';
export default async function LoginPage() {
  if (await getSession()) redirect('/app');
  return (
    <main className="auth">
      <h1>Welcome back</h1>
      <AuthForm mode="login" />
      <p>
        <Link href="/forgot-password">Forgot your password?</Link> ·{' '}
        <Link href="/verify-email">Verify email</Link>
      </p>
      <p>
        New to SitePulse? <Link href="/register">Create an account</Link>.
      </p>
    </main>
  );
}
