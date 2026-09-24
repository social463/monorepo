import { ARENA_TEAM_COLORS, type ArenaTeam } from '@legends/shared'
import type { ArenaMinimapInfo } from './ArenaScene'

/**
 * Mapa de aproximação.
 *
 * Mostra o próprio time sempre e os adversários só enquanto a revelação do
 * tiro dura — atirar entrega a posição, ficar quieto não. É o que dá peso à
 * decisão de puxar o gatilho num mapa desse tamanho, onde sem nenhuma
 * referência duas pessoas podem não se encontrar durante a partida inteira.
 *
 * Desenhado com elementos posicionados, e não em canvas: são poucos pontos, e
 * um canvas exigiria sincronizar tema, densidade de pixel e redimensionamento
 * à mão.
 */

const LARGURA = 168

function cor(team: ArenaTeam): string {
  return `#${ARENA_TEAM_COLORS[team].toString(16).padStart(6, '0')}`
}

export function ArenaMinimap({
  info,
  desviarDoPainel = false,
}: {
  info: ArenaMinimapInfo
  /** Sai da frente do painel de chat (que ocupa a faixa direita da tela). */
  desviarDoPainel?: boolean
}) {
  const altura = Math.round((LARGURA * info.height) / info.width)
  const px = (x: number) => (x / info.width) * LARGURA
  const py = (y: number) => (y / info.height) * altura

  // Bandeira fora da base vira SETA na borda: num mapa de 3.900px ela costuma
  // estar longe demais para o ponto no minimapa dizer para onde correr.
  const roubada = info.bandeiras.find((b) => b.roubada)
  const seta =
    roubada && info.you
      ? (Math.atan2(roubada.y - info.you.y, roubada.x - info.you.x) * 180) / Math.PI
      : null

  return (
    <div
      className={`pointer-events-none absolute bottom-4 z-10 flex flex-col items-end gap-1 transition-[right] ${
        desviarDoPainel ? 'right-[21rem]' : 'right-4'
      }`}
    >
      {seta !== null && roubada && (
        <span
          className="flex items-center gap-1.5 rounded-full bg-surface-container/85 px-2 py-1 font-label text-label-sm shadow-sm backdrop-blur"
          style={{ color: cor(roubada.team) }}
        >
          <span style={{ transform: `rotate(${seta}deg)`, display: 'inline-block' }}>➤</span>
          bandeira {roubada.team}
        </span>
      )}

      <div
        className="relative overflow-hidden rounded-md border border-outline-variant/40 bg-surface-container/80 shadow-sm backdrop-blur"
        style={{ width: LARGURA, height: altura }}
      >
        {info.bandeiras.map((bandeira) => (
          <span
            key={bandeira.team}
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45"
            style={{
              left: px(bandeira.x),
              top: py(bandeira.y),
              backgroundColor: cor(bandeira.team),
              // Bandeira fora da base pisca: é a informação mais urgente do modo.
              animation: bandeira.roubada ? 'pulse 1s ease-in-out infinite' : undefined,
            }}
          />
        ))}

        {info.aliados.map((aliado, i) => (
          <span
            key={`a${i}`}
            className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70"
            style={{
              left: px(aliado.x),
              top: py(aliado.y),
              backgroundColor: info.team ? cor(info.team) : '#ffffff',
            }}
          />
        ))}

        {info.inimigos.map((inimigo, i) => (
          <span
            key={`i${i}`}
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-error"
            // Some junto com a revelação: a marca envelhecendo é o que diz
            // "ele estava aqui há três segundos", não "está aqui agora".
            style={{ left: px(inimigo.x), top: py(inimigo.y), opacity: Math.max(0.15, inimigo.restanteMs / 4000) }}
          />
        ))}

        {/* A bola é o que todo mundo persegue no futebol: sem ela no mapa, o
            minimapa não diz nada sobre onde o jogo está acontecendo. */}
        {info.bola && (
          <span
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/50 bg-white shadow-sm"
            style={{ left: px(info.bola.x), top: py(info.bola.y) }}
          />
        )}

        {info.you && (
          <span
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-on-surface bg-surface"
            style={{ left: px(info.you.x), top: py(info.you.y) }}
          />
        )}
      </div>
    </div>
  )
}
