/**
 * Portão único do som do escritório: enquanto ligado, nada toca.
 *
 * A sala de silêncio (`private-zone`) é ausência total de som, e os sons saem
 * de lugares muito diferentes — efeitos com asset (aplauso da comemoração,
 * palma do high-five), bipes via Web Audio, e a voz das pessoas — disparados
 * por hooks React e pela `OfficeScene` (Phaser, fora da árvore de componentes).
 * Espalhar a checagem por cada chamada garantiria que o próximo som novo
 * nasceria vazando, então todos consultam este portão.
 *
 * Quem liga e desliga é a sessão do escritório, que sabe a zona onde você está.
 * A voz é a exceção que não passa por aqui: em vez de silenciar o alto-falante,
 * a sala de silêncio simplesmente não entra em sala de voz nenhuma (ver
 * `useOfficeMedia`), o que também impede o seu mic de vazar para fora.
 */
let silenced = false

export function setOfficeSilenced(next: boolean): void {
  silenced = next
}

export function isOfficeSilenced(): boolean {
  return silenced
}
