import { useQuery } from '@tanstack/react-query'
import type {
  CultureBenefitDTO,
  CultureManualDownloadResponse,
  CultureManualDTO,
  CulturePageDTO,
  CultureOnboardingKitResponse,
  CulturePersonalAssetDownloadResponse,
  CulturePersonalAssetsResponse,
  CultureVisualAssetsResponse,
} from '@legends/shared'
import { ApiError, apiFetch } from './api'

/**
 * Página institucional publicada. Um 404 aqui não é erro de verdade: significa
 * que o admin ainda não publicou o conteúdo, então a query resolve com `null`
 * e a tela mostra o estado vazio.
 */
export function useCulturePage(slug: string) {
  return useQuery({
    queryKey: ['culture', 'page', slug],
    queryFn: async (): Promise<CulturePageDTO | null> => {
      try {
        const { page } = await apiFetch<{ page: CulturePageDTO }>(`/culture/pages/${slug}`)
        return page
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
  })
}

export function useCultureManuals() {
  return useQuery({
    queryKey: ['culture', 'manuals'],
    queryFn: () => apiFetch<{ manuals: CultureManualDTO[] }>('/culture/manuals'),
  })
}

export function useCultureBenefits() {
  return useQuery({
    queryKey: ['culture', 'benefits'],
    queryFn: () => apiFetch<{ benefits: CultureBenefitDTO[] }>('/culture/benefits'),
  })
}

export function useCultureVisualAssets() {
  return useQuery({
    queryKey: ['culture', 'visual-assets'],
    queryFn: () => apiFetch<CultureVisualAssetsResponse>('/culture/visual-assets'),
  })
}

/**
 * O material que o viewer recebeu. A rota não aceita parâmetro de pessoa — o
 * recorte é o próprio token, então não há como pedir o material de um colega.
 */
export function useMyPersonalAssets() {
  return useQuery({
    queryKey: ['culture', 'personal-assets'],
    queryFn: () => apiFetch<CulturePersonalAssetsResponse>('/culture/personal-assets'),
    // O DTO carrega link assinado de 5 min: cache longo entregaria URL vencida.
    staleTime: 2 * 60_000,
  })
}

/**
 * Os materiais da chegada, para a seção do perfil. Quem decide se a janela dos
 * 90 dias está aberta é o servidor — aqui não há conta de data nenhuma, e é de
 * propósito: o relógio do navegador é do usuário.
 */
export function useMyOnboardingKit() {
  return useQuery({
    queryKey: ['culture', 'onboarding-kit'],
    queryFn: () => apiFetch<CultureOnboardingKitResponse>('/culture/onboarding-kit'),
    // Mesmo motivo do kit pessoal: o DTO carrega link assinado de 5 min.
    staleTime: 2 * 60_000,
  })
}

/** Baixa um material pessoal. Mesmo caminho do manual: link assinado na hora. */
export async function downloadPersonalAsset(downloadPath: string): Promise<void> {
  const { url } = await apiFetch<CulturePersonalAssetDownloadResponse>(downloadPath)
  window.location.assign(url)
}

/**
 * Pede o link de download do PDF e navega até ele. Passa pelo `apiFetch` (e não
 * por um `<a href>`) porque a rota exige o access token, que vive só em memória.
 */
export async function downloadManual(downloadPath: string): Promise<void> {
  const { url } = await apiFetch<CultureManualDownloadResponse>(downloadPath)
  window.location.assign(url)
}
