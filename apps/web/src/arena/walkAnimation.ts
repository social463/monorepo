/**
 * Decide o que fazer com a animação de caminhada a cada quadro.
 *
 * Existe como função pura por causa de uma armadilha do Phaser que já custou
 * um bug: `anims.stop()` **não limpa** `anims.currentAnim`. Quem compara só a
 * key ("já estou tocando esta animação?") nunca reinicia depois de parar —
 * então o personagem que para e volta a andar NA MESMA DIREÇÃO desliza sem
 * mexer as pernas, e só destrava ao virar, porque aí a key muda.
 *
 * O sintoma é sutil o bastante para passar em qualquer teste que não seja
 * exatamente este.
 */
export type WalkAction = 'tocar' | 'manter' | 'parar'

export interface WalkAnimationState {
  moving: boolean
  /** A animação daquela direção existe (o sheet pode ainda estar compondo). */
  exists: boolean
  /** `anims.currentAnim?.key` */
  currentKey: string | undefined
  /** `anims.isPlaying` */
  isPlaying: boolean
  /** A animação que a direção atual pede. */
  animKey: string
}

export function walkAnimationAction({
  moving,
  exists,
  currentKey,
  isPlaying,
  animKey,
}: WalkAnimationState): WalkAction {
  if (!moving || !exists) return 'parar'
  // As DUAS condições: key diferente (virou) ou parada (voltou a andar reto).
  if (currentKey !== animKey || !isPlaying) return 'tocar'
  return 'manter'
}
