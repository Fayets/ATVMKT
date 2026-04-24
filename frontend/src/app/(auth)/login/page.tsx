import { LoginForm } from '@/features/auth/components/login-form'

export default function LoginPage() {
  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold tracking-tight text-[var(--text)]">
        Iniciar sesion
      </h1>
      <p className="mb-6 text-sm text-[var(--text3)]">
        Ingresa a tu laboratorio
      </p>
      <LoginForm />
    </div>
  )
}
