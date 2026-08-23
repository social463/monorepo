import type { OfficeServerMessage } from '@legends/shared'

export type MapMessageEffect = 'reload' | 'leave' | 'refetch' | 'defer' | 'ignore'

/**
 * Decide o efeito de uma mensagem de socket relacionada ao mapa, sem
 * executar nada — pura para ser testável isoladamente do bridge/React.
 * `map-changed` é pesado (troca de mapa: reposiciona, derruba LiveKit);
 * `map-decor-updated` é leve (só decoração — refetch suave, sem reload).
 *
 * `map-decor-updated` chegando com uma edição não salva em andamento vira
 * `'defer'` (não `'ignore'`): é exatamente o que acontece com o BROADCAST DO
 * PRÓPRIO Salvar — o merge-publish responde por HTTP e dispara o broadcast
 * quase ao mesmo tempo, então o WS pode chegar ANTES de `editingDirty` virar
 * `false` na UI (a resposta do `save()` só desmarca dirty depois de um
 * round-trip de estado do React). Um `'ignore'` simples perderia esse
 * refetch pra sempre — o chamador (`OfficeSessionContext`) precisa lembrar
 * que ficou um refetch pendente e disparar assim que a edição deixar de
 * estar suja, senão a mobília recém-salva fica com a "moldura" de edição
 * (estampa pendente) até um F5.
 */
export function mapMessageEffect(
  message: OfficeServerMessage,
  onOfficePage: boolean,
  editingDirty: boolean,
): MapMessageEffect {
  if (message.type === 'map-changed') return onOfficePage ? 'reload' : 'leave'
  if (message.type === 'map-decor-updated') return editingDirty ? 'defer' : 'refetch'
  return 'ignore'
}
