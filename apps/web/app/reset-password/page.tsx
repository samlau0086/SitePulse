import { AuthRecoveryForm } from '../../components/auth-recovery-form';
export default function ResetPasswordPage() {
  return (
    <main className="auth">
      <h1>Choose a new password</h1>
      <AuthRecoveryForm mode="reset" />
    </main>
  );
}
