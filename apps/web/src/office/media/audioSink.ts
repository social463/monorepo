/**
 * Aplica a saída de áudio escolhida a um elemento `<audio>`, se o navegador
 * suportar `setSinkId` (só Chromium — Firefox/Safari não têm essa API).
 *
 * `deviceId` null = padrão do sistema, e isso vira `setSinkId('')`, que é como
 * a spec representa "volte para a saída padrão". Não dá para tratar como no-op:
 * um elemento recém-criado até nasce no padrão, mas um que já está tocando num
 * dispositivo específico continuaria nele para sempre. Como sala e mesa criam
 * elementos em momentos diferentes (`RemoteAudio` monta por remoto,
 * `spatialAudio` cria o próprio `<audio>` ao montar o grafo), os dois caminhos
 * divergiam: o som saía por dispositivos diferentes conforme onde a pessoa
 * estava quando escolheu.
 *
 * Nunca lança: o dispositivo pode ter sido desplugado entre a escolha e a
 * aplicação — nesse caso mantém o sink anterior.
 */
export async function applyAudioSink(el: HTMLMediaElement, deviceId: string | null): Promise<void> {
  const withSinkId = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }
  if (typeof withSinkId.setSinkId !== 'function') return
  try {
    await withSinkId.setSinkId(deviceId ?? '')
  } catch {
    // dispositivo pode ter sumido entre a escolha e a aplicação — ignora
  }
}
