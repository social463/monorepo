import { useBrandContext } from '../brand/BrandContext'
import { Icon } from './Icon'

/**
 * Alterna claro/escuro. Só aparece quando a **empresa** libera os dois modos
 * (`allowUserScheme`) — empresa que só revisou um deles não expõe um botão que
 * levaria a uma tela meio pintada.
 *
 * A troca é instantânea: as duas paletas já vieram no `GET /branding`, então
 * clicar só reescreve as variáveis do `:root`. Sem ida à API, sem flash.
 */
export function SchemeToggle({ className }: { className?: string }) {
  const { scheme, setScheme } = useBrandContext()
  if (!setScheme) return null

  const proximo = scheme === 'dark' ? 'light' : 'dark'
  const rotulo = proximo === 'dark' ? 'Mudar para o tema escuro' : 'Mudar para o tema claro'

  return (
    <button
      type="button"
      onClick={() => setScheme(proximo)}
      aria-label={rotulo}
      title={rotulo}
      className={
        className ??
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface'
      }
    >
      <Icon name={scheme === 'dark' ? 'light_mode' : 'dark_mode'} />
    </button>
  )
}
