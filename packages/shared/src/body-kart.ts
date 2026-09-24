import { bodyBoxBlocked, type BodyCollisionGrid } from './body-collision'
import { BODY_MAX_STEP_MS, type BodyInput, type BodyState } from './body-move'
import type { Direction } from './index'

/**
 * O passo do kart.
 *
 * Irmão de `stepBody`, e pelos mesmos motivos: roda nos DOIS lados — o servidor
 * para produzir o estado autoritativo, o cliente para prever o próprio movimento
 * e reexecutar os pendentes na reconciliação. Duas implementações do mesmo
 * movimento divergem sempre; a pergunta é só em quantas semanas de caça a drift.
 *
 * Por isso é **pura e sem relógio**: `dtMs` entra por parâmetro. Ler o tempo aqui
 * dentro tornaria impossível reexecutar um input antigo — e reexecutar é
 * exatamente o que a reconciliação faz.
 *
 * O que a separa de `stepBody` é o ESTADO que sobrevive ao input. A pé, soltar a
 * tecla para no ato; de kart, a velocidade e o rumo continuam. É essa memória
 * que faz dirigir não ser andar.
 */

/**
 * O input NÃO muda de formato — `BodyInput` continua o mesmo. O que muda é o
 * significado, e ele é relido aqui:
 *
 * | Campo      | A pé            | De kart                     |
 * |------------|-----------------|-----------------------------|
 * | `dy < 0`   | anda para cima  | acelera                     |
 * | `dy > 0`   | anda para baixo | freia, e depois engata ré   |
 * | `dx`       | anda para o lado| esterça                     |
 * | `sprint`   | corre           | freio de mão (derrapagem)   |
 *
 * Reler em vez de estender mantém `sanitizeInput`, o teto de pendentes, o banco
 * de tempo e a reconciliação inteiros: o servidor não ganha um segundo formato
 * de pacote para validar, nem o cliente um segundo caminho de predição.
 */

/**
 * Velocidade máxima à frente, em px/s.
 *
 * Ancorada no que já existe, não chutada: a corrida a pé da arena é 426 px/s
 * (`BODY_SPEED × BODY_SPRINT_FACTOR`). O kart precisa ser sensivelmente mais
 * rápido que isso para valer a pena, e não tão rápido que a pista de 121 tiles
 * passe em dois segundos.
 */
export const BODY_KART_MAX_SPEED = 560

/**
 * Máxima de ré. Bem menor: ré existe para desatolar de uma barreira, não para
 * correr de costas — e ré rápida vira atalho para fazer a curva ao contrário.
 */
export const BODY_KART_MAX_REVERSE = 150

/** Aceleração, em px/s². Cerca de 1,5s da parada até a máxima. */
export const BODY_KART_ACCEL = 380

/** Freio. Mais forte que o acelerador — frear tem de ser uma jogada, não uma espera. */
export const BODY_KART_BRAKE = 900

/**
 * Desaceleração ao tirar o pé, em px/s². Baixa de propósito: é ela que dá a
 * INÉRCIA. Com atrito alto, soltar o acelerador para o kart e a pilotagem vira
 * de novo "anda enquanto segura a tecla".
 */
export const BODY_KART_DRAG = 210

/** Esterço a grip cheio, em radianos por segundo. */
export const BODY_KART_TURN_RATE = 2.9

/**
 * Velocidade a partir da qual o esterço morde por inteiro.
 *
 * Abaixo dela o kart vira proporcionalmente menos — e parado não vira nada. É a
 * regra que sozinha separa dirigir de andar: sem ela o kart gira no lugar, todo
 * mundo faz a curva perfeita, e a corrida é decidida no grid.
 */
export const BODY_KART_TURN_FULL_SPEED = 220

/**
 * Quanto o freio de mão acrescenta ao esterço, e quanto cobra em velocidade.
 *
 * A derrapagem é a saída da curva fechada, e é uma ESCOLHA porque custa: quem
 * derrapa em reta longa perde para quem não derrapou.
 */
export const BODY_KART_DRIFT_TURN_BONUS = 1.9
export const BODY_KART_DRIFT_DRAG = 620

/**
 * Fração da velocidade que sobra depois de bater.
 *
 * Existe para que encostar na parede NÃO seja a linha mais rápida. Sem o custo,
 * o traçado ótimo é raspar a barreira a curva inteira ("wall riding"), e a pista
 * vira um corredor onde a curva não importa.
 */
export const BODY_KART_WALL_KEEP = 0.35

/**
 * Abaixo disto, a batida para o kart de vez. Sem o corte, uma velocidade
 * residual mantém o kart tremendo contra a barreira para sempre — e
 * `BODY_KART_WALL_KEEP` só a divide, nunca a zera.
 */
export const BODY_KART_STOP_SPEED = 8

/**
 * Meia-largura e meia-altura do corpo do kart, em pixels.
 *
 * Maior que o do pedestre (7×6) porque o veículo é maior — e quadrado porque o
 * kart gira: uma caixa que não acompanhe o rumo passaria de lado por um vão em
 * que ela não cabe de frente. Testar a caixa girada exigiria SAT na grade, e o
 * ganho não paga a divergência que uma implementação a mais convida.
 */
export const BODY_KART_BODY_HALF = 10

export interface BodyKartState extends BodyState {
  /** Para onde o kart aponta, em radianos (0 = direita). Contínuo, ao contrário de `dir`. */
  heading: number
  /** Velocidade ao longo do rumo, em px/s. Negativa = ré. */
  speed: number
}

/** Ajustes da simulação, no molde de `BodyStepOptions`. */
export interface BodyKartStepOptions {
  /** Velocidade máxima à frente. Padrão `BODY_KART_MAX_SPEED`. */
  maxSpeed?: number
  /**
   * Kart travado no lugar (largada). Os controles continuam sendo lidos — o
   * `heading` responde? Não: com velocidade zero o grip é zero, então o esterço
   * também não morde. É o comportamento certo, e sai de graça.
   */
  frozen?: boolean
}

/**
 * Pose do LPC a partir do rumo. O piloto aparece só pela cabeça no cockpit, e
 * ela tem quatro poses; o kart é que gira de verdade.
 *
 * As faixas são de 90° centradas em cada eixo, e o horizontal ganha nos empates
 * — mesma escolha de `bodyFacing`: as poses de lado do LPC leem melhor.
 */
export function kartFacing(heading: number): Direction {
  const cos = Math.cos(heading)
  const sin = Math.sin(heading)
  if (Math.abs(cos) >= Math.abs(sin)) return cos > 0 ? 'right' : 'left'
  return sin > 0 ? 'down' : 'up'
}

/** O kart cabe com o centro aqui? */
function fits(grid: BodyCollisionGrid, x: number, y: number): boolean {
  return !bodyBoxBlocked(grid, x, y, BODY_KART_BODY_HALF, BODY_KART_BODY_HALF)
}

/** Normaliza para [−π, π). Sem isto o rumo cresce sem teto e perde precisão. */
export function normalizeHeading(heading: number): number {
  const volta = Math.PI * 2
  const resto = ((heading + Math.PI) % volta + volta) % volta
  return resto - Math.PI
}

/**
 * Aplica um input e devolve o estado seguinte. Determinística: mesmo estado +
 * mesma sequência de inputs (+ mesmas opções) → mesmo resultado, em qualquer
 * máquina. É essa propriedade que faz a reconciliação convergir em vez de brigar.
 */
export function stepBodyKart(
  state: BodyKartState,
  input: BodyInput,
  grid: BodyCollisionGrid,
  options: BodyKartStepOptions = {},
): BodyKartState {
  // Mesmo teto de `stepBody`: uma aba que volta do background entrega um `dt`
  // gigante, e integrar isso de uma vez atravessa parede (tunneling).
  const dt = Math.min(Math.max(input.dtMs, 0), BODY_MAX_STEP_MS) / 1000
  if (options.frozen) {
    // Largada: o kart fica onde está, apontado para onde estava. Zerar a
    // velocidade (em vez de só ignorar o input) é o que impede o piloto de
    // "guardar" aceleração durante a contagem.
    return { ...state, speed: 0 }
  }

  const maxSpeed = options.maxSpeed ?? BODY_KART_MAX_SPEED
  const drift = input.sprint === true
  // O acelerador é `dy` invertido: para cima (`dy < 0`) é para a frente, como a
  // tecla sugere. É a mesma convenção de tela do resto do produto.
  const throttle = -input.dy
  let speed = state.speed

  if (throttle > 0) {
    speed += BODY_KART_ACCEL * throttle * dt
  } else if (throttle < 0) {
    // Freia até parar; depois disso, o mesmo comando engata a ré. Dois gestos
    // numa tecla só, como num carro automático — e sem tecla nova no contrato.
    speed += (speed > 0 ? -BODY_KART_BRAKE : -BODY_KART_ACCEL) * -throttle * dt
  } else {
    // Sem pé em nada: atrito. Nunca cruza o zero — `Math.max`/`Math.min`
    // seguram, senão o kart passaria de andando para andando de ré sozinho.
    const atrito = BODY_KART_DRAG * dt
    speed = speed > 0 ? Math.max(0, speed - atrito) : Math.min(0, speed + atrito)
  }
  if (drift) {
    const perda = BODY_KART_DRIFT_DRAG * dt
    speed = speed > 0 ? Math.max(0, speed - perda) : Math.min(0, speed + perda)
  }
  speed = Math.min(maxSpeed, Math.max(-BODY_KART_MAX_REVERSE, speed))

  // Esterço proporcional à velocidade, e invertido na ré — como um carro. Kart
  // parado não gira no lugar: é daí que sai o erro de pilotagem, e é o erro que
  // cria a ultrapassagem.
  const grip = Math.min(1, Math.abs(speed) / BODY_KART_TURN_FULL_SPEED)
  const taxa = BODY_KART_TURN_RATE + (drift ? BODY_KART_DRIFT_TURN_BONUS : 0)
  const heading = normalizeHeading(
    state.heading + input.dx * taxa * grip * Math.sign(speed) * dt,
  )

  const stepX = Math.cos(heading) * speed * dt
  const stepY = Math.sin(heading) * speed * dt

  // Um eixo de cada vez, como `stepBody`: testar o destino diagonal de uma vez
  // faria o kart GRUDAR na barreira ao raspá-la, em vez de deslizar. O que muda
  // aqui é o preço — bater custa velocidade, senão raspar a parede seria o
  // traçado mais rápido.
  let x = state.x
  let y = state.y
  let bateu = false
  if (stepX !== 0) {
    if (fits(grid, x + stepX, y)) x += stepX
    else bateu = true
  }
  if (stepY !== 0) {
    if (fits(grid, x, y + stepY)) y += stepY
    else bateu = true
  }
  if (bateu) {
    speed *= BODY_KART_WALL_KEEP
    if (Math.abs(speed) < BODY_KART_STOP_SPEED) speed = 0
  }

  return { x, y, heading, speed, dir: kartFacing(heading) }
}
