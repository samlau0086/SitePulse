import { AuthRecoveryForm } from '../../components/auth-recovery-form';
export default function ForgotPasswordPage() {
  return (
    <main className="auth">
      <h1>Reset your password</h1>
      <AuthRecoveryForm mode="forgot" />
    </main>
  );
}
