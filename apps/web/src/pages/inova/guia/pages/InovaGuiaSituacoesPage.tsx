import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../../../../components/Icon'
import { trackEvent } from '../../../../lib/analytics'
import { Chip } from '../components/Chip'
import { CopyPromptButton } from '../components/CopyPromptButton'
import { HelpfulFeedback } from '../components/HelpfulFeedback'
import { PathBadge } from '../components/PathBadge'
import { SectionHeading } from '../components/SectionHeading'
import { faqById } from '../content/faqs'
import { areaName, paths } from '../content/library'
import { promptById } from '../content/prompts'
import { situationBySlug, situations } from '../content/situations'
import type { PathId, Situation } from '../content/types'
import { useGuiaFavorites } from '../lib/useGuiaLocalState'

const PATH_FILTERS: { id: PathId | 'todos'; label: string }[] = [
  { id: 'todos', label: 'Todos os caminhos' },
  { id: 'ia', label: paths.ia.short },
  { id: 'ia-pessoa', label: paths['ia-pessoa'].short },
  { id: 'pessoa', label: paths.pessoa.short },
]

export function InovaGuiaSituacoesPage() {
  const [query, setQuery] = useState('')
  const [path, setPath] = useState<PathId | 'todos'>('todos')
  const [category, setCategory] = useState('todas')
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  // A situação aberta mora na URL (`?s=<slug>`), e não em estado local: é por
  // ela que a busca global do guia abre o detalhe, e o link pode ser repassado.
  const [searchParams, setSearchParams] = useSearchParams()
  const slug = searchParams.get('s')
  const active = slug ? (situationBySlug(slug) ?? null) : null
  const favorites = useGuiaFavorites('situation')

  const categories = useMemo(() => ['todas', ...Array.from(new Set(situations.map((x) => x.category)))], [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return situations.filter((item) => {
      if (path !== 'todos' && item.path !== path) return false
      if (category !== 'todas' && item.category !== category) return false
      if (onlyFavorites && !favorites.has(item.id)) return false
      if (!q) return true
      return [item.title, item.summary, item.aiRole, item.humanRole, ...item.tags].join(' ').toLowerCase().includes(q)
    })
  }, [query, path, category, onlyFavorites, favorites])

  function open(item: Situation) {
    trackEvent('inova_guia_situacao_aberta', { situacaoId: item.id })
    setSearchParams({ s: item.slug })
  }

  function close() {
    setSearchParams({})
  }

  useEffect(() => {
    if (!active) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setSearchParams({})
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, setSearchParams])

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Minha situação"
        title="Encontre o seu caso e saiba por onde começar"
        description="Situações reais do cotidiano, com caminho recomendado, papel da IA, papel humano, risco e prompt inicial."
      />

      <div className="flex flex-col gap-md">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar: feedback, planilha, reunião, promoção…"
          aria-label="Buscar situações"
          className="min-h-11 w-full rounded-full border border-outline-variant/60 bg-surface px-lg text-body-md outline-none focus:border-primary"
        />
        <div className="flex flex-wrap gap-xs">
          {PATH_FILTERS.map((f) => (
            <Chip key={f.id} active={path === f.id} onClick={() => setPath(f.id)}>
              {f.label}
            </Chip>
          ))}
          <Chip active={onlyFavorites} onClick={() => setOnlyFavorites((v) => !v)}>
            Meus salvos
          </Chip>
        </div>
        <div className="flex flex-wrap gap-xs">
          {categories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c === 'todas' ? 'Todas as categorias' : c}
            </Chip>
          ))}
        </div>
      </div>

      <p className="text-body-sm text-on-surface-variant" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? 'situação' : 'situações'}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-outline-variant/60 p-2xl text-center">
          <p className="font-headline text-headline-sm text-on-surface">Não achamos essa situação por aqui.</p>
          <p className="mt-sm text-body-md text-on-surface-variant">
            Abra a Bússola e responda três perguntas — funciona mesmo para casos que ainda não mapeamos.
          </p>
        </div>
      ) : (
        <ul className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <li key={item.id}>
              <article className="flex h-full flex-col rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
                <div className="flex items-start justify-between gap-sm">
                  <PathBadge path={item.path} />
                  <button
                    type="button"
                    aria-label={favorites.has(item.id) ? 'Remover dos salvos' : 'Salvar situação'}
                    onClick={() => favorites.toggle(item.id)}
                    className="rounded-full p-xs text-on-surface-variant hover:text-primary"
                  >
                    <Icon name="favorite" filled={favorites.has(item.id)} className="text-[18px]" />
                  </button>
                </div>
                <p className="mt-md font-headline text-headline-sm text-on-surface">{item.title}</p>
                <p className="mt-sm flex-1 text-body-sm text-on-surface-variant">{item.summary}</p>
                <div className="mt-md flex items-center justify-between gap-sm border-t border-outline-variant/40 pt-md">
                  <span className="text-body-sm text-on-surface-variant">
                    {item.category} · {areaName(item.area)}
                  </span>
                  <button
                    type="button"
                    onClick={() => open(item)}
                    className="font-label text-label-sm font-bold text-primary hover:underline"
                  >
                    Ver caminho
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      {active ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md"
          role="dialog"
          aria-modal="true"
          aria-label={active.title}
          onClick={(event) => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface p-xl">
            <div className="flex items-start justify-between gap-md">
              <PathBadge path={active.path} />
              <button type="button" onClick={close} aria-label="Fechar" className="text-on-surface-variant hover:text-on-surface">
                <Icon name="close" className="text-[20px]" />
              </button>
            </div>
            <h3 className="mt-md font-headline text-headline-md text-on-surface">{active.title}</h3>
            <p className="mt-sm text-body-md text-on-surface-variant">{active.summary}</p>

            <dl className="mt-lg grid gap-md sm:grid-cols-2">
              <SituationDetail label="O que a IA faz bem aqui" value={active.aiRole} />
              <SituationDetail label="O que continua humano" value={active.humanRole} />
              <SituationDetail label="Quando envolver a liderança" value={active.leadershipTrigger} />
              <SituationDetail label="Risco a observar" value={active.risk} />
            </dl>

            <div className="mt-lg rounded-xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Prompt inicial</p>
              <p className="mt-sm whitespace-pre-line text-body-md text-on-surface-variant">{active.prompt}</p>
              <div className="mt-md">
                <CopyPromptButton
                  text={active.promptIds?.[0] ? (promptById(active.promptIds[0])?.text ?? active.prompt) : active.prompt}
                  promptId={active.promptIds?.[0] ?? active.id}
                />
              </div>
            </div>

            {(active.faqIds ?? []).length > 0 ? (
              <div className="mt-lg">
                <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Dúvidas relacionadas</p>
                <ul className="mt-sm space-y-sm">
                  {(active.faqIds ?? [])
                    .map((id) => faqById(id))
                    .filter((f): f is NonNullable<typeof f> => Boolean(f))
                    .map((f) => (
                      <li key={f.id} className="rounded-xl border border-outline-variant/40 p-md">
                        <p className="font-label text-label-md font-bold text-on-surface">{f.question}</p>
                        <p className="mt-1 text-body-sm text-on-surface-variant">{f.answer[0]}</p>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-lg">
              <HelpfulFeedback contentId={active.id} contentType="situacao" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SituationDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/40 p-md">
      <dt className="font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">{label}</dt>
      <dd className="mt-1 text-body-sm text-on-surface">{value}</dd>
    </div>
  )
}
