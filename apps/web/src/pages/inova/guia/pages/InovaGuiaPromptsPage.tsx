import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../../../../components/Icon'
import { Chip } from '../components/Chip'
import { CopyPromptButton } from '../components/CopyPromptButton'
import { SectionHeading } from '../components/SectionHeading'
import { aiRoles, areaName } from '../content/library'
import { promptCategories, prompts } from '../content/prompts'
import { cx } from '../lib/cx'
import { useGuiaFavorites } from '../lib/useGuiaLocalState'

const PCTFR = [
  { letter: 'P', name: 'Papel', description: 'Defina qual papel específico a IA deve assumir (ex: especialista em FP&A).' },
  { letter: 'C', name: 'Contexto', description: 'Forneça setor, tamanho da empresa, sistemas e objetivo para evitar interpretações erradas.' },
  { letter: 'T', name: 'Tarefa', description: 'Ação clara, direta e mensurável (ex: analise as 10 maiores variações).' },
  { letter: 'F', name: 'Formato', description: 'Como a resposta deve ser entregue (ex: tabela, bullets, resumo executivo).' },
  { letter: 'R', name: 'Restrições', description: 'Regras e limites (ex: não invente dados, limite a 500 palavras).' },
] as const

const PCTFR_TEMPLATE = `Papel: Atue como [papel específico].
Contexto: [contexto necessário para compreender o problema].
Tarefa: [verbo de ação + resultado esperado + escopo].
Formato: Entregue em [formato desejado].
Restrições: [regras, limites e premissas a respeitar].`

export function InovaGuiaPromptsPage() {
  // `?p=<id>` vem da busca global: o prompt escolhido sobe para o topo da
  // lista e ganha destaque, sem esconder os demais.
  const [searchParams] = useSearchParams()
  const highlighted = searchParams.get('p')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('todas')
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const favorites = useGuiaFavorites('prompt')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return prompts.filter((item) => {
      if (category !== 'todas' && item.category !== category) return false
      if (onlyFavorites && !favorites.has(item.id)) return false
      if (!q) return true
      return [item.title, item.description, item.whenToUse, item.text, ...item.tags].join(' ').toLowerCase().includes(q)
    })
  }, [query, category, onlyFavorites, favorites])

  const ordered = useMemo(
    () =>
      highlighted
        ? [...filtered].sort((a, b) => (a.id === highlighted ? -1 : b.id === highlighted ? 1 : 0))
        : filtered,
    [filtered, highlighted],
  )

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Prompt Lab"
        title="Prompts prontos para as tarefas reais"
        description="Copie, ajuste as variáveis entre colchetes e valide o resultado."
      />

      <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Metodologia: regra PCTFR</p>
        <p className="mt-1 text-body-sm text-on-surface-variant">A estrutura ideal para construir prompts eficientes e precisos.</p>
        <ul className="mt-lg grid gap-md sm:grid-cols-2 lg:grid-cols-5">
          {PCTFR.map((step) => (
            <li key={step.letter} className="rounded-xl border border-outline-variant/40 bg-surface p-md">
              <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">{step.letter}</span>
              <p className="mt-sm font-label text-label-md font-bold text-on-surface">{step.name}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{step.description}</p>
            </li>
          ))}
        </ul>
        <div className="mt-lg rounded-xl border border-outline-variant/40 bg-surface p-md">
          <p className="font-label text-label-sm font-bold uppercase tracking-wide text-primary">Estrutura-base</p>
          <pre className="mt-sm whitespace-pre-wrap font-sans text-body-sm text-on-surface">{PCTFR_TEMPLATE}</pre>
          <div className="mt-md">
            <CopyPromptButton text={PCTFR_TEMPLATE} promptId="pctfr-estrutura-base" label="Copiar estrutura" />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-md rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-label text-label-md font-bold uppercase tracking-wide text-primary">Recurso auxiliar</p>
          <h3 className="mt-1 font-headline text-headline-sm text-on-surface">
            Quer testar ou aprimorar seus prompts em tempo real?
          </h3>
          <p className="mt-1 max-w-2xl text-body-sm text-on-surface-variant">
            Acesse a plataforma externa Prompt Cowboy para explorar mais ferramentas de otimização de instruções com IA.
          </p>
        </div>
        <a
          href="https://promptcowboy.com"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center gap-xs whitespace-nowrap rounded-full bg-primary px-lg font-label text-label-md font-bold text-on-primary transition-opacity hover:opacity-90"
        >
          <Icon name="open_in_new" className="text-[18px]" />
          Acessar Prompt Cowboy
        </a>
      </div>

      <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar prompt por tarefa, área ou palavra-chave"
          aria-label="Buscar prompts"
          className="min-h-11 w-full rounded-full border border-outline-variant/60 bg-surface px-lg text-body-md outline-none focus:border-primary"
        />
        <div className="mt-md flex flex-wrap gap-xs">
          <Chip active={category === 'todas'} onClick={() => setCategory('todas')}>
            Todas as tarefas
          </Chip>
          {promptCategories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
          <Chip active={onlyFavorites} onClick={() => setOnlyFavorites((v) => !v)}>
            Meus salvos
          </Chip>
        </div>
      </div>

      <ul className="grid gap-md lg:grid-cols-2">
        {ordered.map((item) => (
          <li key={item.id}>
            <article
              className={cx(
                'flex h-full flex-col rounded-2xl border bg-surface-container-low p-lg',
                item.id === highlighted ? 'border-primary ring-2 ring-primary/30' : 'border-outline-variant/40',
              )}
            >
              <div className="flex items-start justify-between gap-sm">
                <div>
                  <p className="font-label text-label-sm font-bold uppercase tracking-wide text-primary">
                    {item.category} · {areaName(item.area)}
                  </p>
                  <h3 className="mt-sm font-headline text-headline-sm text-on-surface">{item.title}</h3>
                </div>
                <button
                  type="button"
                  aria-label={favorites.has(item.id) ? 'Remover dos salvos' : 'Salvar prompt'}
                  onClick={() => favorites.toggle(item.id)}
                  className="rounded-full p-xs text-on-surface-variant hover:text-primary"
                >
                  <Icon name="favorite" filled={favorites.has(item.id)} className="text-[18px]" />
                </button>
              </div>

              <p className="mt-sm text-body-sm text-on-surface-variant">{item.description}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                <strong className="font-bold text-on-surface">Quando usar. </strong>
                {item.whenToUse}
              </p>

              <pre className="mt-md flex-1 whitespace-pre-wrap rounded-xl border border-outline-variant/40 bg-surface p-md text-body-sm text-on-surface">{item.text}</pre>

              {item.variables.length > 0 ? (
                <div className="mt-sm flex flex-wrap gap-xs">
                  {item.variables.map((v) => (
                    <span key={v} className="rounded-full border border-outline-variant/60 px-sm py-1 text-label-sm text-on-surface-variant">
                      {v}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-md">
                <CopyPromptButton text={item.text} promptId={item.id} />
              </div>
            </article>
          </li>
        ))}
      </ul>

      <section>
        <SectionHeading
          eyebrow="Papéis da IA"
          title="Peça à IA que assuma um papel"
          description="O mesmo pedido muda de qualidade quando você define quem a IA deve ser na conversa."
        />
        <ul className="mt-lg grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {aiRoles.map((r) => (
            <li key={r.role} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
              <p className="font-label text-label-md font-bold text-on-surface">{r.role}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{r.when}</p>
              <p className="mt-sm text-body-sm text-primary">{r.questions}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
