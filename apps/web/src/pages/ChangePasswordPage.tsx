import { BackButton } from "../components/BackButton";
import { ChangePasswordForm } from "../components/ChangePasswordForm";

export function ChangePasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="mb-sm flex items-center gap-sm">
          <BackButton fallback="/" className="-ml-sm" />
          <h1 className="font-headline text-headline-md text-on-surface">
            Alterar senha
          </h1>
        </div>
        <p className="mb-xl text-body-sm text-on-surface-variant">
          Informe a senha atual e escolha uma nova senha de acesso.
        </p>

        <ChangePasswordForm />
      </div>
    </main>
  );
}
