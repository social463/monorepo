import { useMemo, useState, type JSX } from 'react'
import { RETRO_CARD_COLORS, RETRO_SHAPE_STYLES, SHAPE_HEIGHT, SHAPE_WIDTH, type RetroCardColor, type RetroShape, type RetroShapeStyle } from '@legends/shared'
import { SHAPE_COLOR_CLASS } from './ColorPalette'
import { ShapeArt } from './ShapeArt'

export interface ShapePick {
  shape: RetroShape
  color: RetroCardColor
  shapeStyle: RetroShapeStyle
  width: number
  height: number
}

interface ShapeOption {
  shape: RetroShape
  label: string
  keywords: string
}

interface ShapeCategory {
  id: string
  label: string
  shapes: ShapeOption[]
}

const CATEGORIES: ShapeCategory[] = [
  {
    id: 'essentials',
    label: 'Essenciais & Ferramentas',
    shapes: [
      { shape: 'arrow-right', label: 'Seta', keywords: 'seta arrow fluxo direção action' },
      { shape: 'triangle', label: 'Triângulo', keywords: 'triangulo play prioridade alerta' },
      { shape: 'target', label: 'Alvo', keywords: 'alvo meta foco objetivo target' },
      { shape: 'heart', label: 'Coração', keywords: 'coracao amor gostei reconhecimento' },
      { shape: 'document', label: 'Documento', keywords: 'documento nota arquivo paper' },
      { shape: 'star', label: 'Estrela', keywords: 'estrela destaque favorito star' },
    ],
  },
  {
    id: 'software',
    label: 'Software & Desenvolvimento',
    shapes: [
      { shape: 'document', label: 'Spec', keywords: 'spec documento requisito release' },
      { shape: 'robot', label: 'Robô', keywords: 'robo automacao bot ia ci' },
      { shape: 'bug', label: 'Bug', keywords: 'bug erro incidente problema' },
      { shape: 'cloud', label: 'Cloud', keywords: 'cloud nuvem deploy infra' },
      { shape: 'gear', label: 'Engrenagem', keywords: 'engrenagem config sistema processo' },
      { shape: 'database', label: 'Banco', keywords: 'banco database dados db' },
    ],
  },
  {
    id: 'technology',
    label: 'Tecnologia',
    shapes: [
      { shape: 'cloud', label: 'Cloud sync', keywords: 'cloud sync nuvem tecnologia' },
      { shape: 'database', label: 'Servidor', keywords: 'servidor database banco dados' },
      { shape: 'grid', label: 'Rede', keywords: 'rede arquitetura grid sistema' },
      { shape: 'chart', label: 'Métricas', keywords: 'metrica grafico chart analytics' },
      { shape: 'battery', label: 'Energia', keywords: 'bateria energia carga status' },
      { shape: 'lock', label: 'Segurança', keywords: 'lock seguranca acesso privacidade' },
    ],
  },
  {
    id: 'business',
    label: 'Business',
    shapes: [
      { shape: 'briefcase', label: 'Portfólio', keywords: 'negocio portfolio projeto trabalho' },
      { shape: 'calendar', label: 'Agenda', keywords: 'agenda calendario prazo data' },
      { shape: 'checklist', label: 'Checklist', keywords: 'checklist tarefa lista done' },
      { shape: 'person', label: 'Stakeholder', keywords: 'pessoa stakeholder cliente usuario' },
      { shape: 'chart', label: 'Resultado', keywords: 'resultado grafico impacto negocio' },
      { shape: 'warning', label: 'Risco', keywords: 'risco alerta warning bloqueio' },
    ],
  },
  {
    id: 'people',
    label: 'Pessoas & Avatares',
    shapes: [
      { shape: 'person', label: 'Pessoa', keywords: 'pessoa usuario dev time' },
      { shape: 'smiley', label: 'Sorriso', keywords: 'emoji sorriso humor sentimento' },
      { shape: 'heart', label: 'Cuidado', keywords: 'cuidado coracao apoio time' },
      { shape: 'star', label: 'Reconhecimento', keywords: 'reconhecimento estrela destaque' },
      { shape: 'target', label: 'Foco', keywords: 'foco objetivo alinhamento' },
      { shape: 'shield', label: 'Proteção', keywords: 'protecao confianca suporte' },
    ],
  },
  {
    id: 'productivity',
    label: 'Produtividade & Gestão',
    shapes: [
      { shape: 'checklist', label: 'Checklist', keywords: 'checklist tarefa produtividade' },
      { shape: 'calendar', label: 'Planejamento', keywords: 'planejamento agenda calendario sprint' },
      { shape: 'battery', label: 'Capacidade', keywords: 'capacidade energia carga' },
      { shape: 'shield', label: 'Qualidade', keywords: 'qualidade escudo garantia' },
      { shape: 'star', label: 'Prioridade', keywords: 'prioridade estrela importante' },
      { shape: 'target', label: 'Meta', keywords: 'meta objetivo alvo okr' },
    ],
  },
  {
    id: 'basic',
    label: 'Formas Básicas',
    shapes: [
      { shape: 'rectangle', label: 'Retângulo', keywords: 'retangulo quadrado box' },
      { shape: 'circle', label: 'Círculo', keywords: 'circulo oval round' },
      { shape: 'diamond', label: 'Losango', keywords: 'losango decisao diamond' },
      { shape: 'triangle', label: 'Triângulo', keywords: 'triangulo' },
      { shape: 'line', label: 'Linha', keywords: 'linha separador divisor' },
      { shape: 'arrow-right', label: 'Seta', keywords: 'seta arrow' },
    ],
  },
]

const ALL_OPTIONS = CATEGORIES.flatMap((category) => category.shapes.map((shape) => ({ ...shape, category: category.label })))

function shapeSize(shape: RetroShape): { width: number; height: number } {
  if (shape === 'line') return { width: SHAPE_WIDTH, height: 44 }
  if (shape === 'person' || shape === 'battery') return { width: 120, height: 140 }
  return { width: SHAPE_WIDTH, height: SHAPE_HEIGHT }
}

function Preview({ shape, color, shapeStyle }: { shape: RetroShape; color: RetroCardColor; shapeStyle: RetroShapeStyle }): JSX.Element {
  return (
    <svg viewBox="0 0 160 104" className="h-14 w-full">
      <ShapeArt shape={shape} color={color} solid={shapeStyle !== 'outline'} />
    </svg>
  )
}

export function ShapeFlyout({ onPick, disabled }: { onPick: (pick: ShapePick) => void; disabled?: boolean }): JSX.Element {
  const [color, setColor] = useState<RetroCardColor>('blue')
  const [shapeStyle, setShapeStyle] = useState<RetroShapeStyle>('solid')
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)

  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  const activeCategory = CATEGORIES.find((category) => category.id === categoryId) ?? null
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return []
    return ALL_OPTIONS.filter((option) => `${option.label} ${option.keywords} ${option.category}`.toLocaleLowerCase('pt-BR').includes(normalizedQuery))
  }, [normalizedQuery])
  const visibleShapes = normalizedQuery ? searchResults : activeCategory?.shapes ?? []

  function pick(shape: RetroShape) {
    onPick({ shape, color, shapeStyle, ...shapeSize(shape) })
  }

  return (
    <div className="max-h-[min(680px,calc(100vh-72px))] w-[36rem] overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container shadow-xl">
      <div className="sticky top-0 z-10 border-b border-outline-variant/30 bg-surface-container p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {RETRO_CARD_COLORS.map((c) => {
              const active = color === c
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`Usar cor ${c}`}
                  aria-pressed={active}
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-105 ${SHAPE_COLOR_CLASS[c].soft} ${active ? 'border-primary ring-2 ring-primary/30' : 'border-outline-variant/50'}`}
                />
              )
            })}
          </div>

          <div className="flex rounded-lg border border-outline-variant/40 p-0.5">
            {RETRO_SHAPE_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                aria-label={style === 'solid' ? 'Forma preenchida' : 'Forma vazada'}
                aria-pressed={shapeStyle === style}
                onClick={() => setShapeStyle(style)}
                className={`rounded-md px-2 py-1 font-label text-[11px] ${shapeStyle === style ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-highest'}`}
              >
                {style === 'solid' ? 'Cheia' : 'Vazada'}
              </button>
            ))}
          </div>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar..."
          aria-label="Buscar formas"
          className="h-11 w-full rounded-lg border border-outline-variant/60 bg-surface px-3 text-body-md text-on-surface outline-none transition-colors placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div className="max-h-[calc(min(680px,100vh-72px)-118px)] overflow-y-auto p-4">
        {(normalizedQuery || activeCategory) ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <p className="font-label text-label-md font-bold text-on-surface-variant">
                {normalizedQuery ? 'Resultados' : activeCategory?.label}
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setCategoryId(null)
                }}
                className="rounded-md px-2 py-1 font-label text-label-sm text-primary hover:bg-primary/10"
              >
                Categorias
              </button>
            </div>

            {visibleShapes.length === 0 ? (
              <p className="py-8 text-center text-body-sm text-on-surface-variant">Nenhuma forma encontrada.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {visibleShapes.map((option) => (
                  <button
                    key={`${option.shape}-${option.label}`}
                    type="button"
                    disabled={disabled}
                    aria-label={`Criar ${option.label}`}
                    onClick={() => pick(option.shape)}
                    className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-2 text-center transition-colors hover:border-primary disabled:opacity-40"
                  >
                    <Preview shape={option.shape} color={color} shapeStyle={shapeStyle} />
                    <span className="font-label text-[11px] text-on-surface-variant">{option.label}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-outline-variant/40" />
              <p className="font-label text-label-md font-bold text-on-surface-variant">Categorias</p>
              <span className="h-px flex-1 bg-outline-variant/40" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setCategoryId(category.id)}
                  className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-3 text-center transition-colors hover:border-primary"
                >
                  <div className="grid grid-cols-3 gap-1">
                    {category.shapes.slice(0, 6).map((option) => (
                      <Preview key={option.shape} shape={option.shape} color={color} shapeStyle={shapeStyle} />
                    ))}
                  </div>
                  <span className="mt-2 block font-label text-label-md font-bold text-on-surface">{category.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
