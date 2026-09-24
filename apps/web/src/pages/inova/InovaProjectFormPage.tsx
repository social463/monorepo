import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { InovaProjectPhase, PublicUser } from '@legends/shared'
import {
  INOVA_PHASE_DESCRIPTIONS,
  INOVA_PROJECT_CATEGORIES,
  INOVA_PROJECT_PHASES,
  INOVA_SUGGESTED_SECTORS,
  canManageInovaProject,
  inovaProjectOwnershipOf,
  inovaSectorKey,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import {
  changeInovaProjectPhase,
  createInovaProject,
  getInovaProjectDetail,
  listSectors,
  updateInovaProject,
} from '../../lib/inova-api'
import { Icon } from '../../components/Icon'
import { InovaDialog } from '../../components/inova/InovaDialog'
import { InovaRichTextField } from '../../components/inova/InovaRichText'
import { TargetPicker } from '../mural-feedbacks/TargetPicker'
import { useAuth } from '../../auth/AuthContext'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const inputCls = 'rounded-md border border-outline-variant/60 bg-surface px-md py-sm text-body-md text-on-surface'
const ONBOARDING_KEY = 'inova_onboarding_seen'

const CRITERIOS = [
  {
    titulo: 'O projeto precisa utilizar Inteligência Artificial',
    texto:
      'A solução deve envolver o uso de IA, como automações inteligentes, análise de dados, agentes, chatbots ou outras aplicações de inteligência artificial.',
  },
  {
    titulo: 'O projeto deve automatizar ou melhorar um processo do setor',
    texto: 'O objetivo é resolver um problema real do dia a dia, seja na sua função ou em alguma atividade da equipe.',
  },
  {
    titulo: 'Máximo de duas pessoas responsáveis pelo projeto',
    texto:
      'Cada projeto pode ter até dois responsáveis, que serão os donos da iniciativa e responsáveis por atualizar o andamento.',
  },
  {
    titulo: 'Para apresentar no evento INOVA o projeto precisa estar na fase final',
    texto:
      'Somente projetos que chegarem na etapa "Expandindo para Mais Pessoas" poderão ser apresentados no evento de encerramento do INOVA.',
  },
]

type Step = 'basicos' | 'impacto' | 'fase'

const STEP_LABELS: Record<Step, string> = { basicos: 'Dados básicos', impacto: 'Impacto', fase: 'Fase' }

/** "5.000,50" ou "5000.5" → 5000.5; vazio → null. */
function parseNumber(raw: string): number | null {
  const value = raw.trim()
  if (!value) return null
  const normalized = value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value
  const n = Number(normalized)
  return Number.isFinite(n) ? n : NaN
}

/**
 * Cadastro e edição do projeto em etapas, como no INOVA original: Dados
 * básicos → Impacto → Fase. Impacto só na edição (projeto recém-cadastrado
 * ainda não tem resultado); a fase entra nas duas, e dá para voltar de fase —
 * a etapa deixa isso à vista em vez de esconder num seletor da outra página.
 */
export function InovaProjectFormPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const { id } = useParams<{ id?: string }>()
  const [searchParams] = useSearchParams()
  const isEdit = Boolean(id)
  const existing = useQuery({
    queryKey: ['inova', 'project', id],
    queryFn: () => getInovaProjectDetail(id as string),
    enabled: isEdit,
  })
  const sectorsQuery = useQuery({ queryKey: ['sectors'], queryFn: listSectors })

  const steps: Step[] = isEdit ? ['basicos', 'impacto', 'fase'] : ['basicos', 'fase']
  const [step, setStep] = useState<Step>(() => (isEdit && searchParams.get('etapa') === 'impacto' ? 'impacto' : 'basicos'))
  const stepIndex = steps.indexOf(step)

  const [criteriosAceitos, setCriteriosAceitos] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [sector, setSector] = useState('')
  const [responsible1, setResponsible1] = useState<PublicUser | null>(null)
  const [responsible2, setResponsible2] = useState<PublicUser | null>(null)
  const [sectorRepresentative, setSectorRepresentative] = useState('')
  const [leadershipChallenge, setLeadershipChallenge] = useState(false)
  const [description, setDescription] = useState('')
  const [problemDescription, setProblemDescription] = useState('')
  const [estimatedDeadline, setEstimatedDeadline] = useState('')
  const [toolsUsed, setToolsUsed] = useState('')
  const [projectCosts, setProjectCosts] = useState('')
  const [results, setResults] = useState('')
  const [hoursSaved, setHoursSaved] = useState('')
  const [costReduction, setCostReduction] = useState('')
  const [otherMetrics, setOtherMetrics] = useState('')
  const [phase, setPhase] = useState<InovaProjectPhase>('IDEA')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)

  // Quem cadastra costuma ser o próprio responsável: o campo já nasce preenchido com
  // ele (dá pra trocar no X). Só na criação — na edição quem manda é o projeto salvo.
  // Uma vez só: sem o ref, o `user` novo que o refresh silencioso traz reencheria o
  // campo que a pessoa acabou de limpar.
  const prefilled = useRef(false)
  useEffect(() => {
    if (isEdit || prefilled.current || !user) return
    prefilled.current = true
    setResponsible1((current) => current ?? user)
  }, [isEdit, user])

  useEffect(() => {
    if (existing.data) {
      const p = existing.data.project
      setTitle(p.title)
      setCategory(p.category)
      setSector(p.sector)
      setResponsible1(p.responsible1)
      setResponsible2(p.responsible2)
      setSectorRepresentative(p.sectorRepresentative ?? '')
      setLeadershipChallenge(p.leadershipChallenge)
      setDescription(p.description)
      setProblemDescription(p.problemDescription ?? '')
      setEstimatedDeadline(p.estimatedDeadline ?? '')
      setToolsUsed(p.toolsUsed ?? '')
      setProjectCosts(p.projectCosts ?? '')
      setResults(p.results ?? '')
      setHoursSaved(p.hoursSaved != null ? String(p.hoursSaved) : '')
      setCostReduction(p.costReduction != null ? String(p.costReduction) : '')
      setOtherMetrics(p.otherMetrics ?? '')
      setPhase(p.phase)
    }
  }, [existing.data])

  // Sugestões de setor: o cadastro da empresa primeiro, completado pelas do
  // INOVA original que não batem com nenhum setor cadastrado.
  const sectorSuggestions = useMemo(() => {
    const registered = (sectorsQuery.data?.sectors ?? []).map((s) => s.name)
    const keys = new Set(registered.map(inovaSectorKey))
    return [...registered, ...INOVA_SUGGESTED_SECTORS.filter((s) => !keys.has(inovaSectorKey(s)))]
  }, [sectorsQuery.data])

  // Setor e categoria são lista fechada, como no INOVA original — texto livre
  // é o que deixou "Gente & Gestão" e "Gente e Gestão" como setores diferentes.
  // Projeto antigo com valor fora da lista continua mostrando o dele.
  const sectorOptions = sector && !sectorSuggestions.includes(sector) ? [sector, ...sectorSuggestions] : sectorSuggestions
  const categoryOptions =
    category && !INOVA_PROJECT_CATEGORIES.some((c) => c.value === category)
      ? [{ value: category, icon: '💡' }, ...INOVA_PROJECT_CATEGORIES]
      : INOVA_PROJECT_CATEGORIES

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!isEdit && !criteriosAceitos) {
      setError('Você precisa aceitar os critérios para cadastrar o projeto.')
      return
    }
    const basico = (message: string) => {
      setStep('basicos')
      setError(message)
    }
    if (!title.trim() || !category.trim() || !sector.trim() || !description.trim()) {
      basico('Preencha todos os campos obrigatórios.')
      return
    }
    if (!responsible1) {
      basico('Informe um responsável para o projeto.')
      return
    }
    if (!problemDescription.trim()) {
      basico('Este campo é obrigatório para continuar. Descreva qual problema o projeto resolve.')
      return
    }
    if (!estimatedDeadline.trim()) {
      basico('Informe o prazo estimado para finalizar o projeto.')
      return
    }
    if (!toolsUsed.trim()) {
      basico('Informe quais ferramentas você está usando ou usou.')
      return
    }
    if (!projectCosts.trim()) {
      basico('Informe os custos estimados do projeto.')
      return
    }
    const hours = parseNumber(hoursSaved)
    const cost = parseNumber(costReduction)
    if (Number.isNaN(hours) || Number.isNaN(cost) || (hours ?? 0) < 0 || (cost ?? 0) < 0) {
      setStep('impacto')
      setError('Horas economizadas e redução de custo precisam ser números (ex.: 40 ou 5000).')
      return
    }

    setSaving(true)
    const impacto = isEdit
      ? { results: results.trim() || null, hoursSaved: hours, costReduction: cost, otherMetrics: otherMetrics.trim() || null }
      : {}
    const payload = {
      ...impacto,
      title,
      category,
      sector,
      responsible1Id: responsible1.id,
      responsible2Id: responsible2?.id ?? null,
      sectorRepresentative: sectorRepresentative || null,
      leadershipChallenge,
      description,
      problemDescription,
      estimatedDeadline,
      toolsUsed,
      projectCosts,
    }
    try {
      const result = isEdit
        ? await updateInovaProject(id as string, payload)
        : await createInovaProject(payload)
      // A fase tem rota própria (vira histórico e entrada no diário). Projeto
      // novo nasce em "Ideia"; só chama se a pessoa escolheu outra.
      const faseAtual = isEdit ? existing.data?.project.phase : 'IDEA'
      if (phase !== faseAtual) await changeInovaProjectPhase(result.project.id, { phase })
      qc.invalidateQueries({ queryKey: ['inova'] })
      if (!isEdit && !localStorage.getItem(ONBOARDING_KEY)) {
        localStorage.setItem(ONBOARDING_KEY, 'true')
        setCreatedId(result.project.id)
        setShowSuccess(true)
        return
      }
      navigate(`/comunidade-inova/projetos/${result.project.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o projeto.')
    } finally {
      setSaving(false)
    }
  }

  // Edição é só do dono (ou de quem administra). A API recusa de qualquer
  // jeito; isto evita preencher um formulário inteiro para levar 403 no fim.
  if (isEdit && existing.data && !canManageInovaProject(user, inovaProjectOwnershipOf(existing.data.project))) {
    return <Navigate to={`/comunidade-inova/projetos/${id}`} replace />
  }

  return (
    <section className="flex flex-col gap-lg">
      {isEdit ? (
        <Link
          to={`/comunidade-inova/projetos/${id}`}
          className="inline-flex w-fit items-center gap-xs rounded-full px-sm py-xs text-body-md text-on-surface-variant hover:text-on-surface"
        >
          <Icon name="arrow_back" className="text-[18px]" />
          Voltar ao projeto
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex w-fit items-center gap-xs rounded-full px-sm py-xs text-body-md text-on-surface-variant hover:text-on-surface"
        >
          <Icon name="arrow_back" className="text-[18px]" />
          Voltar
        </button>
      )}
      <div>
        <h1 className="font-headline text-headline-lg text-on-surface">
          {isEdit ? 'Editar projeto' : 'Cadastrar Novo Projeto'}
        </h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          {isEdit
            ? 'Atualize as informações, o impacto e a fase do projeto — use as etapas abaixo.'
            : 'Preencha os dados para lançar seu projeto de IA.'}
        </p>
      </div>

      {!isEdit && (
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
          <h2 className="font-headline text-headline-sm text-on-surface">Critérios para cadastrar um projeto no INOVA</h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Antes de cadastrar, confira se o seu projeto atende aos requisitos abaixo:
          </p>
          <ul className="mt-md grid gap-sm md:grid-cols-2">
            {CRITERIOS.map((c) => (
              <li key={c.titulo} className="rounded-xl border border-outline-variant/40 p-sm">
                <p className="font-label text-label-md text-on-surface">{c.titulo}</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{c.texto}</p>
              </li>
            ))}
          </ul>
          <label className="mt-md flex items-start gap-sm">
            <input
              type="checkbox"
              checked={criteriosAceitos}
              onChange={(e) => setCriteriosAceitos(e.target.checked)}
              className="mt-1"
            />
            <span className="text-body-md text-on-surface">
              Li e entendi os critérios para cadastro de projetos no INOVA
            </span>
          </label>
        </div>
      )}

      <nav aria-label="Etapas do formulário" className="flex gap-sm">
        {steps.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(s)}
            aria-current={s === step ? 'step' : undefined}
            className={`flex-1 rounded-full py-sm text-center font-label text-label-md transition-colors ${
              s === step
                ? 'bg-primary font-bold text-on-primary'
                : i < stepIndex
                  ? 'bg-primary/15 text-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {i + 1}. {STEP_LABELS[s]}
          </button>
        ))}
      </nav>

      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        {step === 'basicos' && (
          <>
            <div className="grid grid-cols-1 gap-md lg:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="font-label text-label-sm text-on-surface-variant">Título do Projeto *</span>
                  <input aria-label="Título do Projeto" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-label-sm text-on-surface-variant">Setor *</span>
                  <select aria-label="Setor" value={sector} onChange={(e) => setSector(e.target.value)} className={inputCls}>
                    <option value="">Selecione o setor</option>
                    {sectorOptions.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="lg:col-span-2 grid grid-cols-1 gap-md md:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="font-label text-label-sm text-on-surface-variant">Responsável pelo Projeto *</span>
                    <TargetPicker
                      value={responsible1}
                      onChange={setResponsible1}
                      excludeIds={responsible2 ? [responsible2.id] : undefined}
                      scope="all"
                      placeholder="Procurar responsável…"
                      ariaLabel="Responsável pelo Projeto"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-label text-label-sm text-on-surface-variant">Responsável 2 (opcional)</span>
                    <TargetPicker
                      value={responsible2}
                      onChange={setResponsible2}
                      excludeIds={responsible1 ? [responsible1.id] : undefined}
                      scope="all"
                      placeholder="Procurar responsável…"
                      ariaLabel="Responsável 2"
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-label-sm text-on-surface-variant">Representante do setor (opcional)</span>
                  <input
                    aria-label="Representante do setor"
                    value={sectorRepresentative}
                    onChange={(e) => setSectorRepresentative(e.target.value)}
                    className={inputCls}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-label-sm text-on-surface-variant">Categoria *</span>
                  <select aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                    <option value="">Selecione a categoria</option>
                    {categoryOptions.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.icon} {c.value}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-label-sm text-on-surface-variant">Projeto Desafio Alta Liderança? *</span>
                  <select
                    aria-label="Projeto Desafio Alta Liderança?"
                    value={leadershipChallenge ? 'sim' : 'nao'}
                    onChange={(e) => setLeadershipChallenge(e.target.value === 'sim')}
                    className={inputCls}
                  >
                    <option value="nao">Não</option>
                    <option value="sim">Sim</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-label text-label-sm text-on-surface-variant">Qual o prazo para finalizar o projeto? (estimado) *</span>
                  <input
                    aria-label="Qual o prazo para finalizar o projeto? (estimado)"
                    value={estimatedDeadline}
                    onChange={(e) => setEstimatedDeadline(e.target.value)}
                    className={inputCls}
                    placeholder="Ex: 30/06/2026 ou 3 meses"
                  />
                </label>

                <div className="lg:col-span-2 flex flex-col gap-1">
                  <span className="font-label text-label-sm text-on-surface-variant">Descrição do Projeto *</span>
                  <InovaRichTextField
                    ariaLabel="Descrição do Projeto"
                    value={description}
                    onChange={setDescription}
                    placeholder="Descreva o que é o seu projeto, se será uma automação, agente de IA, etc. Inclua também como usará ou usou a IA."
                  />
                </div>

                <div className="lg:col-span-2 flex flex-col gap-1">
                  <span className="font-label text-label-sm text-on-surface-variant">
                    Qual problema ou operação este projeto resolve? Como ele auxilia no dia a dia? *
                  </span>
                  <InovaRichTextField
                    ariaLabel="Qual problema ou operação este projeto resolve? Como ele auxilia no dia a dia?"
                    value={problemDescription}
                    onChange={setProblemDescription}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <span className="font-label text-label-sm text-on-surface-variant">
                    Quais ferramentas você está usando ou usou para construir o projeto? *
                  </span>
                  <InovaRichTextField
                    ariaLabel="Quais ferramentas você está usando ou usou para construir o projeto?"
                    value={toolsUsed}
                    onChange={setToolsUsed}
                    placeholder="Ex: ChatGPT, n8n, Make, Power BI, Python..."
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <span className="font-label text-label-sm text-on-surface-variant">Quais custos o projeto tem/teve? (estimado) *</span>
                  <InovaRichTextField
                    ariaLabel="Quais custos o projeto tem/teve? (estimado)"
                    value={projectCosts}
                    onChange={setProjectCosts}
                    placeholder="Ex: R$ 200/mês de assinatura da ferramenta X, R$ 1.500 de implementação..."
                  />
                </div>
            </div>
          </>
        )}

        {step === 'impacto' && (
          <>
            <p className="rounded-xl border border-primary/20 bg-primary/5 p-md text-body-sm text-on-surface">
              Conte o que o projeto já entregou. Esses números alimentam o painel de impacto da IA na empresa.
            </p>
            <div className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Resultados obtidos</span>
              <InovaRichTextField
                ariaLabel="Resultados obtidos"
                value={results}
                onChange={setResults}
                placeholder="Redução de tempo, de custos, melhoria no atendimento…"
              />
            </div>
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">Horas economizadas/mês</span>
                <input
                  aria-label="Horas economizadas por mês"
                  inputMode="decimal"
                  value={hoursSaved}
                  onChange={(e) => setHoursSaved(e.target.value)}
                  className={inputCls}
                  placeholder="Ex.: 40"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">Redução de custo (R$)</span>
                <input
                  aria-label="Redução de custo em reais"
                  inputMode="decimal"
                  value={costReduction}
                  onChange={(e) => setCostReduction(e.target.value)}
                  className={inputCls}
                  placeholder="Ex.: 5000"
                />
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Outros indicadores</span>
              <InovaRichTextField
                ariaLabel="Outros indicadores"
                value={otherMetrics}
                onChange={setOtherMetrics}
                placeholder="Outros indicadores relevantes…"
              />
            </div>
          </>
        )}

        {step === 'fase' && (
          <fieldset className="grid gap-sm md:grid-cols-2 xl:grid-cols-3">
            <legend className="mb-sm font-label text-label-md text-on-surface">Fase atual do projeto *</legend>
            <p className="-mt-xs mb-xs text-body-sm text-on-surface-variant md:col-span-2 xl:col-span-3">
              Escolha em que ponto da esteira de inovação o projeto está. Dá para voltar de fase se ela foi marcada errado.
            </p>
            {INOVA_PROJECT_PHASES.map((p, i) => {
              const selected = phase === p.value
              return (
                <label
                  key={p.value}
                  className={`flex cursor-pointer items-start gap-sm rounded-xl border p-sm ${
                    selected ? 'border-primary/60 bg-primary/5' : 'border-outline-variant/40 hover:border-primary/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="fase"
                    value={p.value}
                    checked={selected}
                    onChange={() => setPhase(p.value)}
                    className="mt-1"
                  />
                  <span className="flex-1">
                    <span className={`block font-label text-label-md ${selected ? 'font-bold text-primary' : 'text-on-surface'}`}>
                      {i + 1}. {p.label}
                    </span>
                    <span className="block text-body-sm text-on-surface-variant">{INOVA_PHASE_DESCRIPTIONS[p.value]}</span>
                  </span>
                  {selected && <span className="rounded-full bg-primary/15 px-sm text-[11px] text-primary">Atual</span>}
                </label>
              )
            })}
          </fieldset>
        )}

        {error && (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-sm">
          <div className="flex gap-sm">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStep(steps[stepIndex - 1])}
                className="rounded-full border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface hover:border-primary/60"
              >
                Anterior
              </button>
            )}
            {stepIndex < steps.length - 1 && (
              <button
                type="button"
                onClick={() => setStep(steps[stepIndex + 1])}
                className="inline-flex items-center gap-xs rounded-full border border-primary/40 px-lg py-sm font-label text-label-md text-primary hover:bg-primary/5"
              >
                Próximo: {STEP_LABELS[steps[stepIndex + 1]]}
                <Icon name="arrow_forward" className="text-[16px]" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={saving || (!isEdit && !criteriosAceitos)}
            className="inline-flex items-center rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {isEdit ? (saving ? 'Salvando…' : 'Salvar Alterações') : saving ? 'Lançando…' : 'Lançar Projeto'}
          </button>
        </div>
      </form>

      {/* Só no primeiro cadastro (ver ONBOARDING_KEY): apresenta o guia de uso. */}
      <InovaDialog
        open={showSuccess}
        title="Projeto cadastrado com sucesso! 🚀"
        onClose={() => navigate(`/comunidade-inova/projetos/${createdId}`)}
      >
        <div className="flex flex-col gap-md">
        <p className="text-body-md text-on-surface-variant">
          Obrigada por cadastrar seu projeto! Ficamos felizes em ver você fazendo parte dessa jornada de inovação com
          a gente.
        </p>
        <p className="text-body-md text-on-surface-variant">
          Você sabia que pode adicionar vídeos, documentos e gerenciar o andamento do seu projeto diretamente pela
          plataforma?
        </p>
        <p className="text-body-md text-on-surface-variant">Para aproveitar tudo isso, acesse nosso guia rápido de uso.</p>
        <div className="mt-sm flex flex-wrap justify-center gap-md">
          <button
            type="button"
            onClick={() => navigate('/comunidade-inova/como-usar')}
            className="rounded-full border border-outline-variant/60 px-lg py-sm font-label text-label-md text-primary hover:border-primary/60"
          >
            Como usar a Plataforma INOVA
          </button>
          <button
            type="button"
            onClick={() => navigate('/comunidade-inova/projetos')}
            className="rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary"
          >
            Ir para os projetos
          </button>
        </div>
        </div>
      </InovaDialog>
    </section>
  )
}
