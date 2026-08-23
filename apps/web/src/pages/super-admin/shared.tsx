import { Icon } from '../../components/Icon'

/**
 * Vocabulário visual do console do super admin. As classes de botão existem
 * para o console ter a mesma hierarquia do resto do app — CTA preenchido,
 * secundário fantasma, destrutivo só na cor de erro — em vez de três botões
 * de borda idêntica.
 */
export const primaryBtn =
  'rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container'
export const ghostBtn =
  'rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary'
export const ghostBtnLg =
  'rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary'
export const dangerBtn =
  'rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-error hover:text-error'

export function StatusChip({ active, labels }: { active: boolean; labels?: [string, string] }) {
  const [on, off] = labels ?? ['Ativa', 'Inativa']
  return (
    <span
      className={`shrink-0 rounded-full px-sm py-[2px] font-label text-label-sm ${
        active ? 'bg-primary/15 text-primary' : 'bg-outline-variant/30 text-on-surface-variant'
      }`}
    >
      {active ? on : off}
    </span>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
      <Icon name="error" className="text-[16px]" />
      {message}
    </p>
  )
}

export function StatCard({ label, value, icon }: { label: string; value: number | string; icon: string }) {
  return (
    <div className="flex items-center gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon name={icon} className="text-[24px]" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-label text-label-sm text-on-surface-variant">{label}</span>
        <span className="font-headline text-headline-md text-on-surface">{value}</span>
      </span>
    </div>
  )
}

/** Monograma da empresa — âncora visual da linha, sem depender de logo cadastrado. */
export function CompanyMonogram({ name }: { name: string }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-outline-variant/40 bg-surface-container-highest font-headline text-title-md text-primary">
      {name.trim().charAt(0).toUpperCase() || '—'}
    </span>
  )
}
