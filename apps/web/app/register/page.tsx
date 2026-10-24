import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '../../lib/session';
import { AuthForm } from '../../components/auth-form';
export default async function RegisterPage() {
  if (await getSession()) redirect('/app');
  return (
    <main className="auth">
      <h1>Create your account</h1>
      <AuthForm mode="register" />
      <p>
        Already have an account? <Link href="/login">Log in</Link>.
      </p>
    </main>
  );
}
