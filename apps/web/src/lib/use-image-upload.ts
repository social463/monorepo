import { useQuery } from '@tanstack/react-query'
import type { ImageUploadConfig } from '@legends/shared'
import { apiFetch } from './api'

/** Flag pública: o backend tem S3 configurado? (controla o botão Imagem) */
export function useImageUploadsEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['uploads', 'config'],
    queryFn: () => apiFetch<ImageUploadConfig>('/uploads/config'),
    staleTime: 5 * 60 * 1000,
  })
  return data?.enabled ?? false
}
