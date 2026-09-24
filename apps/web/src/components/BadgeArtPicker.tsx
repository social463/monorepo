import { useMemo, useState } from 'react'
import { BADGE_ART, type BadgeArt } from '../lib/badge-art'
import { Icon } from './Icon'

interface BadgeArtPickerProps {
  /** Chave da ilustração atualmente selecionada (badge.iconKey). */
  value: string
  onChange: (key: string) => void
  /**
   * Título do selo em edição. Alimenta o "Aleatório", que sugere arte
   * compatível com o significado em vez de sortear às cegas.
   */
  title?: string
}

/** Sem acento, minúsculas — é o que faz "Troféu" casar com "trofeu". */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Arte compatível com o título do selo.
 *
 * O rótulo do catálogo é uma palavra em português ("Foguete", "Troféu",
 * "Ideia"), então casar por palavra resolve sem IA e sem rede: "Lenda do
 * Fogo" acha "Fogo", "Mestre da Ideia" acha "Ideia". Palavra de até dois
 * caracteres fica de fora — "de", "da", "do" casariam com meio catálogo.
 *
 * **Casamento exato ganha do parcial, e rótulo curto ganha do longo.** O
 * catálogo tem "Troféu" e "Troféu de ouro"; para o selo "Troféu do mês" os
 * dois casam, e o certo é o mais específico — o que não traz palavra a mais.
 * O sorteio fica para o empate dentro dessa faixa, que é onde "aleatório"
 * ainda quer dizer alguma coisa.
 *
 * Sem nenhum casamento (título vazio, ou nada em comum), o sorteio é entre
 * todas: o botão promete uma sugestão, não uma promessa de acerto.
 */
export function sugerirArte(title: string, arts: BadgeArt[] = BADGE_ART): BadgeArt | null {
  if (arts.length === 0) return null
  const palavras = normalizar(title)
    .split(/[^a-z0-9]+/)
    .filter((palavra) => palavra.length > 2)

  const exatos: BadgeArt[] = []
  const parciais: BadgeArt[] = []
  for (const art of arts) {
    const rotulo = normalizar(art.label)
    const doRotulo = rotulo.split(/[^a-z0-9]+/).filter(Boolean)
    if (palavras.some((palavra) => doRotulo.includes(palavra))) exatos.push(art)
    else if (palavras.some((palavra) => rotulo.includes(palavra))) parciais.push(art)
  }

  const casaram = exatos.length > 0 ? exatos : parciais
  if (casaram.length === 0) return arts[Math.floor(Math.random() * arts.length)]

  // Menos palavras no rótulo = casamento mais específico.
  const menor = Math.min(...casaram.map((art) => art.label.split(/\s+/).length))
  const pool = casaram.filter((art) => art.label.split(/\s+/).length === menor)
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * Escolha da ilustração do centro do selo.
 *
 * A grade fica **recolhida** por padrão (Documento 4, seção 11.1): são 207
 * artes, e abertas de uma vez elas ocupavam mais tela que o resto do
 * formulário, empurrando os campos para fora da vista. Formulário novo já
 * nasce com uma arte escolhida, então recolher não esconde decisão pendente —
 * o botão mostra qual está valendo.
 */
export function BadgeArtPicker({ value, onChange, title = '' }: BadgeArtPickerProps) {
  // Chaves cuja imagem (PNG) não carregou: mostramos o label como fallback,
  // para o admin ainda conseguir escolher antes dos assets existirem.
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const [aberto, setAberto] = useState(false)

  const selecionada = useMemo(() => BADGE_ART.find((art) => art.key === value) ?? null, [value])

  function aplicarSugestao() {
    const sugerida = sugerirArte(title)
    if (sugerida) onChange(sugerida.key)
  }

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex flex-wrap items-center gap-sm">
        <button
          type="button"
          onClick={() => setAberto((estava) => !estava)}
          aria-expanded={aberto}
          className="flex items-center gap-sm rounded-lg border border-outline-variant/50 bg-surface-container-highest px-md py-sm text-left transition-colors hover:border-primary/50"
        >
          {selecionada && !failed[selecionada.key] ? (
            <img src={selecionada.src} alt="" aria-hidden className="h-6 w-6 object-contain" />
          ) : (
            <Icon name="image" className="text-[20px] text-on-surface-variant" />
          )}
          <span className="font-label text-label-md text-on-surface">
            {selecionada?.label ?? 'Escolher ilustração'}
          </span>
          <Icon name={aberto ? 'expand_less' : 'expand_more'} className="text-[18px] text-on-surface-variant" />
        </button>

        <button
          type="button"
          onClick={aplicarSugestao}
          className="flex items-center gap-xs rounded-lg border border-outline-variant/50 px-md py-sm font-label text-label-md text-primary transition-colors hover:border-primary/50"
        >
          <Icon name="casino" className="text-[18px]" />
          Aleatório
        </button>
      </div>

      {aberto && (
        <div
          role="group"
          aria-label="Escolher ilustração do selo"
          className="grid max-h-64 grid-cols-8 gap-xs overflow-y-auto rounded-lg border border-outline-variant/40 bg-surface-container-low p-sm sm:grid-cols-10 lg:grid-cols-12"
        >
          {BADGE_ART.map((art) => (
            <button
              key={art.key}
              type="button"
              aria-label={art.label}
              aria-pressed={value === art.key}
              onClick={() => onChange(art.key)}
              className={`flex aspect-square items-center justify-center overflow-hidden rounded-md border-2 bg-surface-container-highest p-0.5 transition-all ${
                value === art.key
                  ? 'border-primary'
                  : 'border-transparent hover:border-outline-variant/50'
              }`}
            >
              {failed[art.key] ? (
                <span className="px-0.5 text-center font-label text-label-sm leading-tight text-on-surface-variant">
                  {art.label}
                </span>
              ) : (
                <img
                  src={art.src}
                  alt={art.label}
                  className="h-full w-full object-contain"
                  onError={() => setFailed((f) => ({ ...f, [art.key]: true }))}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
