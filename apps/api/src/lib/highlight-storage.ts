import { createHash } from 'node:crypto'
import { putS3Object, s3Config } from './s3-client'

/** O storage do card de destaque está disponível? (controla o recurso no admin) */
export function highlightStorageEnabled(): boolean {
  return s3Config() !== null
}

/** Chave do objeto no bucket: highlights/<companyId>/<monthRef>.png. */
export function highlightKey(companyId: string, monthRef: string): string {
  return `highlights/${companyId}/${monthRef}.png`
}

/**
 * Envia o PNG do card para o S3 e devolve a URL pública **com a versão do
 * conteúdo** (`?v=<8 hex do sha256>`).
 *
 * A chave é uma por mês de propósito — regerar sobrescreve, e o bucket não
 * acumula um objeto por tentativa. O efeito colateral era que a URL nunca
 * mudava: quem regerava o card via a imagem velha, porque o navegador servia o
 * que já tinha em cache (e o objeto sobe sem `Cache-Control`, então o cache
 * heurístico o segura por horas). O sufixo faz o endereço acompanhar o
 * conteúdo, então navegador e CDN buscam de novo sozinhos.
 *
 * Derivado do PNG, e não de um relógio: regerar o MESMO card não inventa uma
 * URL nova, e a versão continua a mesma depois de um redeploy.
 */
export async function saveCardPng(companyId: string, monthRef: string, png: Buffer): Promise<string> {
  if (!s3Config()) throw new Error('S3 não configurado')
  const url = await putS3Object({ key: highlightKey(companyId, monthRef), contentType: 'image/png', body: png })
  return `${url}?v=${cardVersion(png)}`
}

/** Versão do conteúdo: 8 hex do sha256 — curto o bastante para caber na tela e
 *  longo o bastante para dois cards diferentes não colidirem. */
export function cardVersion(png: Buffer): string {
  return createHash('sha256').update(png).digest('hex').slice(0, 8)
}
