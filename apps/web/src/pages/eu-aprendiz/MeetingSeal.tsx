import { apprenticeSealFor } from './program-theme'

/**
 * O selo do encontro, pelo Manual de Marca do Eu Aprendiz (seção 11).
 *
 * O selo **conquistado** é a arte oficial: os PNGs chegaram no pacote de
 * setembro/2026 e substituíram o desenho que esta tela fazia — com eles vêm a
 * cor fixa por encontro (1 menta · 2 verde vivo · 3 mata · 4 profundo · 5 mata
 * · 6 verde vivo), o número, a palavra "encontro" e os pontos da trilha, tudo
 * como o manual manda e sem seguir o tema claro/escuro.
 *
 * O que a arte não tem é estado: quem ainda **não conquistou** continua em
 * contorno, com o número. "Conquistado" é o encontro concluído (fichas enviadas
 * e pesquisa respondida); o liberado e ainda não concluído ganha o contorno em
 * verde, para saltar na linha do tempo.
 */
export function MeetingSeal({
  order,
  locked = false,
  done = false,
  size = 'md',
}: {
  order: number
  locked?: boolean
  done?: boolean
  size?: 'sm' | 'md'
}) {
  const md = size === 'md'
  const box = md ? 'h-16 w-16' : 'h-10 w-10'

  if (done) {
    return (
      <img
        aria-hidden
        data-seal-state="conquistado"
        src={apprenticeSealFor(order)}
        alt=""
        className={`shrink-0 rounded-full ${box}`}
      />
    )
  }

  const outline = locked
    ? 'border-2 border-outline-variant text-on-surface-variant'
    : 'border-2 border-primary text-on-surface'

  return (
    <span
      aria-hidden
      data-seal-state={locked ? 'bloqueado' : 'em-andamento'}
      className={`relative grid shrink-0 place-items-center rounded-full font-headline ${box} ${outline}`}
    >
      <span className="flex flex-col items-center leading-none">
        <span className={`font-bold ${md ? 'text-title-lg' : 'text-title-md'}`}>{order}</span>
        {md && (
          <>
            <span className="mt-[2px] text-[8px] font-medium">encontro</span>
            <span className="mt-[3px] flex items-center gap-[2px]">
              {[2, 3, 4, 5].map((dot) => (
                <span key={dot} className="rounded-full bg-current" style={{ width: dot, height: dot }} />
              ))}
            </span>
          </>
        )}
      </span>
    </span>
  )
}
