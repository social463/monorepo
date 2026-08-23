import type { CalendarProviderKey } from '@legends/shared'
import { googleAdapter } from './google'
import { microsoftAdapter } from './microsoft'
import type { CalendarProviderAdapter } from './provider'

const ADAPTERS: Record<CalendarProviderKey, CalendarProviderAdapter> = {
  google: googleAdapter,
  microsoft: microsoftAdapter,
}

export function adapterFor(provider: CalendarProviderKey): CalendarProviderAdapter {
  return ADAPTERS[provider]
}

export * from './provider'
