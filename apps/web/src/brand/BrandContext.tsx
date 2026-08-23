import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  LEGENDS_PRESET,
  brandingFromPreset,
  type BrandPalette,
  type BrandScheme,
  type BrandingDTO,
} from '@legends/shared'
import {
  applyBranding,
  cacheBranding,
  effectiveScheme,
  fetchBranding,
  readCachedBranding,
  writeUserScheme,
} from '../lib/branding'

/**
 * Marca da empresa, resolvida pelo subdomínio antes de existir login.
 *
 * Fica **acima** do `AuthProvider` de propósito: a tela de login precisa da
 * logo e das cores certas, e nesse momento não há token nenhum. Por isso o
 * `GET /branding` é público e resolve o tenant pelo `Host`.
 */
interface BrandContextValue {
  branding: BrandingDTO
  /**
   * A marca real ainda não chegou — o que está em `branding` é o padrão do
   * produto, não a da empresa.
   *
   * Existe para a interface poder **esperar** em vez de mostrar a marca errada:
   * sem isso, a primeira pintura exibe "Legends" e troca para a do cliente
   * quando o `GET /branding` responde, o que se vê como uma piscada. Com cache
   * da visita anterior nasce `false`, porque aí o que está na tela já é o certo.
   */
  loading: boolean
  /** Esquema em vigor — escolha da pessoa, ou o padrão da empresa. */
  scheme: BrandScheme
  /** Paleta do esquema em vigor. */
  colors: BrandPalette
  /** `null` quando a empresa não libera a troca. */
  setScheme: ((scheme: BrandScheme) => void) | null
}

const BrandContext = createContext<BrandContextValue | null>(null)

/** Derivar a paleta custa 35 conversões OKLCH — uma vez por módulo, não por render. */
const PRODUCT_BRANDING = brandingFromPreset(LEGENDS_PRESET)

const FALLBACK: BrandContextValue = {
  branding: PRODUCT_BRANDING,
  // Fora do provider não há busca em andamento: o que está aqui é definitivo.
  loading: false,
  scheme: PRODUCT_BRANDING.defaultScheme,
  colors: PRODUCT_BRANDING.colors,
  setScheme: null,
}

/** Nunca devolve null: sem marca carregada, vale a do produto. */
export function useBrandContext(): BrandContextValue {
  return useContext(BrandContext) ?? FALLBACK
}

/** Atalho para quem só quer nome, logo e tagline. */
export function useBrand(): BrandingDTO {
  return useBrandContext().branding
}

export function BrandProvider({ children }: { children: ReactNode }) {
  // O estado inicial vem do cache da última visita — o mesmo valor que
  // `applyCachedBranding()` já pintou no documento antes do React montar.
  const [branding, setBranding] = useState<BrandingDTO>(() => readCachedBranding() ?? PRODUCT_BRANDING)
  const [scheme, setSchemeState] = useState<BrandScheme>(() =>
    effectiveScheme(readCachedBranding() ?? PRODUCT_BRANDING),
  )
  // Com cache, o que já está pintado é o certo — não há o que esperar.
  const [loading, setLoading] = useState(() => readCachedBranding() === null)

  useEffect(() => {
    let cancelled = false
    fetchBranding()
      .then((fresh) => {
        if (cancelled) return
        const active = effectiveScheme(fresh)
        applyBranding(fresh, active)
        cacheBranding(fresh)
        setBranding(fresh)
        setSchemeState(active)
        setLoading(false)
      })
      .catch(() => {
        // Desistiu: a marca do produto passa a ser a resposta, não uma espera.
        if (!cancelled) setLoading(false)
        // API fora do ar: o fallback do Tailwind já é a paleta do produto, então
        // a tela continua legível. Marca errada é melhor que tela em branco.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setScheme = useCallback(
    (next: BrandScheme) => {
      writeUserScheme(next)
      setSchemeState(next)
      applyBranding(branding, next)
    },
    [branding],
  )

  const value = useMemo<BrandContextValue>(
    () => ({
      branding,
      loading,
      scheme,
      colors: branding.schemes[scheme],
      // `null` some com o botão de alternar em vez de deixá-lo lá sem efeito.
      setScheme: branding.allowUserScheme ? setScheme : null,
    }),
    [branding, loading, scheme, setScheme],
  )

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
}
