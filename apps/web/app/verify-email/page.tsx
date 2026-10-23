import { AuthRecoveryForm } from '../../components/auth-recovery-form';
export default function VerifyEmailPage() {
  return (
    <main className="auth">
      <h1>Verify your email</h1>
      <AuthRecoveryForm mode="verify" />
    </main>
  );
}
