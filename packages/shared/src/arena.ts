import type { BodyBallState, BodyKickPower } from './body-ball'
import type { ArenaFlags } from './arena-flag'
import type { ArenaRaceStanding } from './arena-race'
import type { ArenaMatchState, ArenaTeam } from './arena-match'
import type { BodyShot } from './body-paintball'
import type { BodyInput, BodyState } from './body-move'
import type { PaintSplat } from './office-paintball'
import type { CharacterOptions } from './character'
import type { Direction } from './index'

/**
 * Contrato do socket da arena.
 *
 * Separado do `office.ts` de propósito. O escritório fala em TILES inteiros e
 * é orientado a evento; a arena fala em PIXEL e é orientada a tick. Fundir os
 * dois contratos obrigaria a alargar `OfficeOccupant.x/y` para float — e são
 * ~90 pontos medindo em tile (sala, mesa, kart, bola, high-five, paintball)
 * que dependem de eles serem inteiros.
 */



/** Quem está na arena. Como no escritório, presença é efêmera. */
export interface ArenaOccupant extends BodyState {
  userId: string
  name: string
  /**
   * Rumo do kart, em radianos. Só na corrida — nos outros modos o personagem é
   * um pedestre e a pose de quatro direções (`dir`) basta.
   *
   * Vai no occupant, e não só no snapshot, porque é o estado INICIAL de quem
   * entra: sem ele o kart de quem acabou de chegar apareceria apontado para a
   * direita até o primeiro snapshot, o que na largada é o kart inteiro de lado.
   */
  heading?: number
  /** De que lado a pessoa joga. Definido pelo servidor ao entrar. */
  team: ArenaTeam
  avatarSeed?: string | null
  avatarOptions?: CharacterOptions | null
}

/** Uma pessoa dentro de um snapshot. */
export interface ArenaSnapshotPlayer {
  userId: string
  x: number
  y: number
  dir: Direction
  /**
   * Tiros que a pessoa já levou nesta vida, já descontada a recuperação.
   * Ausente = inteira. Vai no snapshot porque é estado contínuo: quem entra no
   * meio precisa ver quem está machucado sem esperar o próximo tiro.
   */
  hits?: number
  /**
   * Quanto falta para voltar ao jogo, em ms; ausente = está em campo. Vai em
   * toda atualização porque é estado CONTÍNUO, não evento: quem entra no meio
   * precisa saber quem está fora sem esperar o próximo abate.
   */
  downMs?: number
  /**
   * Último `seq` deste jogador que o servidor já processou. É por ele que o
   * dono da predição sabe quais inputs ainda precisa reexecutar — e é o que
   * torna a reconciliação possível.
   */
  seq: number
  /**
   * Rumo do kart, em radianos. Só na corrida.
   *
   * Curto (`h`, e não `heading`) porque isto viaja por jogador, vinte vezes por
   * segundo — mesma razão de `seq` e `dir` serem curtos.
   *
   * Vai para TODOS, não só para os outros: é parte do estado autoritativo que a
   * reconciliação do dono reancora. Reexecutar os pendentes a partir de um rumo
   * errado daria uma posição errada, e o kart seria puxado a cada snapshot.
   */
  h?: number
  /** Velocidade do kart, em px/s (negativa = ré). Só na corrida, e pelo mesmo
   *  motivo de `h`: sem ela a reancoragem começaria de uma velocidade errada. */
  v?: number
}

/**
 * A corrida como o cliente a recebe.
 *
 * Substitutivo, como o resto do snapshot: a classificação inteira cabe (são no
 * máximo `ARENA_RACE_GRID_SLOTS` linhas), e um pacote perdido não pode deixar o
 * painel permanentemente errado.
 */
export interface ArenaRaceSnapshot {
  /** A ordem da corrida agora, do líder para o último. */
  standings: ArenaRaceStanding[]
  /** Voltas da prova — para a tela montar "3/5" sem cravar a constante. */
  laps: number
  /**
   * Quanto falta do semáforo, em ms; ausente = já largou. Tempo RESTANTE, nunca
   * instante, como todo prazo deste contrato.
   */
  countdownMs?: number
  /**
   * Quanto falta para a bandeirada final depois de o primeiro terminar; ausente
   * = ninguém terminou ainda.
   */
  finishGraceMs?: number
}

/**
 * A bola como o cliente a recebe: posição, velocidade e quanto falta para ela
 * destravar depois de um gol.
 *
 * A VELOCIDADE vai junto de propósito. O cliente roda a mesma física
 * (`stepBodyBall`) entre dois snapshots e corrige pelo erro quando o próximo
 * chega; sem velocidade ele só teria pontos a 20Hz para interpolar, e uma bola
 * a 940 px/s anda 47px entre eles — o suficiente para ela parecer teleportar
 * a cada pacote.
 *
 * `lockedMs` é tempo RESTANTE, nunca instante: o cliente conta a partir do que
 * recebe, como no resto do contrato.
 */
export interface ArenaBallSnapshot extends BodyBallState {
  lockedMs?: number
}

export type ArenaClientMessage =
  /**
   * Intenção de movimento, nunca posição: cliente que manda posição é cliente
   * que teleporta. O servidor integra com `stepBody`, a MESMA função que a
   * predição do cliente roda.
   */
  | { type: 'input'; input: BodyInput }
  /**
   * Atira no ângulo apontado (radianos, 0 = direita).
   *
   * O ângulo vem do cliente porque a mira É dele — não há outra fonte para
   * onde o mouse aponta. O que não vem é o resultado: alcance, parede e acerto
   * saem de `fireBodyShot`, com a posição autoritativa de todo mundo.
   */
  | { type: 'fire'; angle: number }
  /**
   * Chuta a bola no ângulo apontado (radianos, 0 = direita). Só no futebol.
   *
   * Como no tiro, o ângulo vem do cliente — a mira é o mouse (ou a direção do
   * passo, no teclado) — e o resultado não: alcance e força saem do servidor.
   *
   * O que viaja é o GESTO, nunca a potência: `power` diz se a pessoa passou ou
   * chutou, e quanto isso vale é decidido lá (`bodyKickSpeed`), com o
   * `sprint` do último input já processado. Escolher entre passar e chutar é
   * decisão de jogo; escolher quantos pixels por segundo, não.
   */
  | { type: 'kick'; angle: number; power?: BodyKickPower }
  /**
   * Mensagem de texto para todo mundo na arena.
   *
   * Sem recorte por distância, ao contrário da voz: texto é o canal de quem
   * NÃO está perto (combinar a próxima partida, avisar que caiu a conexão), e
   * chat que só chega a quem já está no alcance da voz não acrescenta nada.
   */
  | { type: 'chat'; text: string }
  /**
   * Devolve o kart à linha de centro, parado e apontado para a frente. Só na
   * corrida.
   *
   * Não é conveniência: na corrida não há abate, logo não há renascimento, e um
   * kart de nariz na barreira sem espaço para manobrar ficaria preso pelos cinco
   * minutos inteiros.
   *
   * Não dá vantagem: o progresso (`s`) não muda e a velocidade vai a zero — a
   * linha de centro é, em tempo, o pior lugar da pista para se estar parado.
   */
  | { type: 'unstuck' }
  /** Saída explícita — devolve a pessoa ao escritório sem esperar timeout. */
  | { type: 'leave-arena' }

export type ArenaServerMessage =
  | {
      type: 'welcome'
      youId: string
      arenaId: string
      publicationId?: string
      players: ArenaOccupant[]
      match: ArenaMatchState
      flags?: ArenaFlags
      /** Só no futebol; ausente nos modos de tiro. */
      ball?: ArenaBallSnapshot
      /** Só na corrida. */
      race?: ArenaRaceSnapshot
      /** Marcas ainda vivas, com o `ttlMs` já descontado — como no escritório. */
      paintSplats?: PaintSplat[]
    }
  | { type: 'joined'; player: ArenaOccupant }
  | { type: 'left'; userId: string }
  /**
   * Estado autoritativo de todo mundo. Substitutivo, nunca incremental: um
   * pacote perdido não pode deixar o cliente permanentemente errado, e a
   * arena é pequena o bastante para o snapshot inteiro caber.
   */
  | {
      type: 'snapshot'
      players: ArenaSnapshotPlayer[]
      match: ArenaMatchState
      /** Só no modo bandeira; ausente no mata-mata. */
      flags?: ArenaFlags
      /** Só no futebol. */
      ball?: ArenaBallSnapshot
      /** Só na corrida. */
      race?: ArenaRaceSnapshot
    }
  /**
   * Alguém atirou. O disparo já vem resolvido (`fireBodyShot`): o cliente
   * anima o projétil e gruda a marca, sem simular nada.
   */
  | { type: 'shot'; shot: BodyShot }
  /**
   * Alguém foi abatido. Vem além do `downMs` do snapshot porque é EVENTO — é
   * ele que dispara som e aviso na tela; o snapshot só sustenta o estado.
   */
  | { type: 'downed'; userId: string; byUserId: string; team: ArenaTeam }
  /**
   * Alguém levou tinta e CONTINUOU de pé. Evento à parte do `downed` porque a
   * reação é outra: aqui é aviso de dano, não de abate.
   */
  | { type: 'hit'; userId: string; byUserId: string; hits: number }
  /** A partida acabou; `winner: null` é empate. Segue o intervalo. */
  | {
      type: 'match-ended'
      winner: ArenaTeam | null
      scores: Record<ArenaTeam, number>
      /** Ordem de chegada da corrida; ausente nos modos por time. */
      podium?: string[]
    }
  /**
   * Alguém completou uma volta. Vem além do `race` do snapshot porque é EVENTO:
   * é ele que toca o som e mostra o tempo de volta NA HORA, sem esperar até 50ms
   * pelo próximo snapshot.
   */
  | { type: 'lap'; userId: string; lap: number; lapMs: number }
  /** Alguém cruzou a bandeirada. `position` é a posição de chegada (1 = venceu). */
  | { type: 'race-finished'; userId: string; position: number }
  /** O semáforo abriu: a corrida vale a partir de agora. */
  | { type: 'race-started' }
  /** Uma partida nova começou — placar zerado. */
  | { type: 'match-started' }
  /**
   * Alguém escreveu no chat da arena. Retransmitida para todos MENOS quem
   * escreveu — a mensagem própria já entrou na lista localmente.
   */
  | { type: 'chat'; userId: string; name: string; text: string; sentAt: string }
  /**
   * Alguém chutou (ou passou). Vem além da bola do snapshot porque é EVENTO:
   * é ele que toca o som e dá ao cliente a velocidade nova NA HORA, sem
   * esperar até 50ms pelo próximo snapshot — meio metro de bola, no chutão.
   * `strong` é o chutão (chute com corrida), e é só o som que o usa.
   */
  | { type: 'kick'; userId: string; ball: BodyBallState; power: BodyKickPower; strong: boolean }
  /**
   * Gol. `userId` é quem tocou na bola por último, e pode ser de qualquer um
   * dos times — gol contra é gol, e quem monta o aviso compara o time dele
   * com o que pontuou.
   */
  | {
      type: 'goal'
      /** Time que PONTUOU. */
      team: ArenaTeam
      userId: string | null
      scores: Record<ArenaTeam, number>
    }
  /**
   * Algo aconteceu com uma bandeira. Vem além do `flags` do snapshot porque é
   * EVENTO — dispara aviso e som; o snapshot só sustenta o estado.
   */
  | {
      type: 'flag'
      kind: 'pegou' | 'devolveu' | 'capturou' | 'caiu' | 'voltou'
      /** De que time é a BANDEIRA. */
      team: ArenaTeam
      userId?: string
    }
