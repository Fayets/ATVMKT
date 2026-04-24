'use client'

import { login } from '@/features/auth/services/auth-service'
import Link from 'next/link'
import { useActionState } from 'react'

export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => {
      const result = await login(formData)
      return result
    },
    {}
  )

  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <div className="rounded-lg border border-[var(--red-dark)] bg-[rgba(230,57,70,0.08)] px-4 py-3 text-sm text-[var(--red-light)]">
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="email" className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text3)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)]"
          placeholder="tu@email.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text3)]">
          Contrasena
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          minLength={6}
          className="w-full rounded-lg border border-[var(--border2)] bg-[var(--bg3)] px-4 py-3 text-sm text-[var(--text)] outline-none transition-all placeholder:text-[var(--text3)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)]"
          placeholder="Minimo 6 caracteres"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold uppercase tracking-wider text-white transition-all hover:opacity-90 hover:-translate-y-0.5 disabled:opacity-30 disabled:cursor-not-allowed disabled:translate-y-0"
      >
        {pending ? 'Cargando...' : 'Iniciar sesion'}
      </button>

      <p className="text-center text-sm text-[var(--text3)]">
        No tenes cuenta?{' '}
        <Link href="/signup" className="text-[var(--accent)] hover:underline">
          Crear cuenta
        </Link>
      </p>
    </form>
  )
}
