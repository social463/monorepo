import { HrDashboardError } from './hr-dashboard-error'

/**
 * Valida uma URL de embed de terceiro antes de ela virar `src` de um iframe.
 * Só https, só host da allowlist, por igualdade EXATA de hostname — comparar por
 * sufixo deixaria passar `app.powerbi.com.evil.com`.
 *
 * Devolve a URL normalizada, que é o valor persistido.
 */
export function assertEmbedUrlAllowed(raw: string, allowedHosts: string[]): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new HrDashboardError('Informe uma URL válida.', 400)
  }

  if (url.protocol !== 'https:') {
    throw new HrDashboardError('Somente endereços https são aceitos.', 400)
  }
  if (url.port !== '') {
    throw new HrDashboardError('URL com porta não é aceita.', 400)
  }

  const host = url.hostname.toLowerCase()
  const allowed = allowedHosts.map((entry) => entry.trim().toLowerCase())
  if (!allowed.includes(host)) {
    throw new HrDashboardError(`O endereço ${host} não está entre as ferramentas liberadas.`, 400)
  }

  if (url.username !== '' || url.password !== '') {
    throw new HrDashboardError('URL com credenciais não é aceita.', 400)
  }

  return url.toString()
}
