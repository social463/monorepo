import { putS3Object, s3Config } from './s3-client'

/** O storage do card de destaque está disponível? (controla o recurso no admin) */
export function highlightStorageEnabled(): boolean {
  return s3Config() !== null
}

/** Chave do objeto no bucket: highlights/<companyId>/<monthRef>.png. */
export function highlightKey(companyId: string, monthRef: string): string {
  return `highlights/${companyId}/${monthRef}.png`
}

/** Envia o PNG do card para o S3 e devolve a URL pública final. */
export async function saveCardPng(companyId: string, monthRef: string, png: Buffer): Promise<string> {
  if (!s3Config()) throw new Error('S3 não configurado')
  return putS3Object({ key: highlightKey(companyId, monthRef), contentType: 'image/png', body: png })
}
