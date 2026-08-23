/**
 * Aplica a saída de áudio escolhida a um elemento `<audio>`, se o navegador
 * suportar `setSinkId` (só Chromium — Firefox/Safari não têm essa API).
 * `deviceId` null = padrão do sistema, nada a fazer (já é o comportamento
 * default do elemento). Nunca lança: o dispositivo pode ter sido desplugado
 * entre a escolha e a aplicação — nesse caso mantém o sink anterior.
 */
export async function applyAudioSink(el: HTMLMediaElement, deviceId: string | null): Promise<void> {
  if (deviceId === null) return
  const withSinkId = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }
  if (typeof withSinkId.setSinkId !== 'function') return
  try {
    await withSinkId.setSinkId(deviceId)
  } catch {
    // dispositivo pode ter sumido entre a escolha e a aplicação — ignora
  }
}
