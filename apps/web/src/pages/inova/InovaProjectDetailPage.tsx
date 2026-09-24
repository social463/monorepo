import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  INOVA_PROJECT_PHASES,
  canAdminister,
  canManageInovaProject,
  inovaCategoryIcon,
  inovaProjectOwnershipOf,
  type InovaProjectPhase,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { InovaActivityLog } from '../../components/inova/InovaActivityLog'
import { InovaDiary } from '../../components/inova/InovaDiary'
import { InovaRichTextView } from '../../components/inova/InovaRichText'
import { InovaTaskKanban } from '../../components/inova/InovaTaskKanban'
import { useAuth } from '../../auth/AuthContext'
import { changeInovaProjectPhase, deleteInovaProject, getInovaProjectDetail, updateInovaProject } from '../../lib/inova-api'

const card = 'rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

function phaseLabel(phase: InovaProjectPhase): string {
  return INOVA_PROJECT_PHASES.find((p) => p.value === phase)?.label ?? phase
}

function SectionTitle({ icon, children, hint }: { icon: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-md">
      <h2 className="flex items-center gap-sm font-headline text-headline-sm text-on-surface">
        <Icon name={icon} className="text-[20px] text-primary" />
        {children}
      </h2>
      {hint && <p className="mt-1 text-body-sm text-on-surface-variant">{hint}</p>}
    </div>
  )
}

function TextBlock({ label, text, rich = true }: { label: string; text: string | null; rich?: boolean }) {
  if (!text) return null
  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-md">
      <p className="mb-1 font-label text-label-sm font-bold text-on-surface">{label}</p>
      {rich ? (
        <InovaRichTextView text={text} />
      ) : (
        <p className="whitespace-pre-line text-body-md text-on-surface-variant">{text}</p>
      )}
    </div>
  )
}

/**
 * Página do projeto no formato do INOVA original: jornada de fases (que o dono
 * move para frente e para trás), informações e métricas de impacto, evolução,
 * diário de bordo e o kanban de tarefas.
 */
export function InovaProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Lembrete uma vez por projeto por sessão, como o toast do INOVA original —
  // repetido a cada visita ele vira ruído e ninguém lê.
  const reminderKey = `inova_reminder_${id}`
  const [showReminder, setShowReminder] = useState(() => {
    try {
      return !sessionStorage.getItem(reminderKey)
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(reminderKey, '1')
    } catch {
      // Sem storage (aba privada): o lembrete só volta a aparecer, sem prejuízo.
    }
  }, [reminderKey])

  const detail = useQuery({
    queryKey: ['inova', 'project', id],
    queryFn: () => getInovaProjectDetail(id as string),
    enabled: Boolean(id),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['inova', 'project', id] })

  const excluirProjeto = useMutation({
    mutationFn: () => deleteInovaProject(id as string),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inova', 'projects'] })
      navigate('/comunidade-inova/projetos')
    },
    onError: () => setError('Não foi possível excluir o projeto. Tente de novo em alguns instantes.'),
  })

  // Arquivar é curadoria do programa (a API só aceita de quem administra):
  // tira o projeto do quadro e do ranking sem apagar a história dele.
  const arquivar = useMutation({
    mutationFn: (archived: boolean) => updateInovaProject(id as string, { archived }),
    onSuccess: (_data, archived) => {
      setError(null)
      setNotice(archived ? 'Projeto arquivado. Ele não conta mais no ranking.' : 'Projeto reativado.')
      invalidate()
      qc.invalidateQueries({ queryKey: ['inova', 'projects'] })
    },
    onError: () => setError('Não foi possível arquivar o projeto. Tente de novo em alguns instantes.'),
  })

  const setPhase = useMutation({
    mutationFn: (phase: InovaProjectPhase) => changeInovaProjectPhase(id as string, { phase }),
    onSuccess: () => {
      setError(null)
      invalidate()
      qc.invalidateQueries({ queryKey: ['inova', 'projects'] })
    },
    onError: () => setError('Não foi possível mudar a fase.'),
  })

  if (detail.isError) {
    return <p className="text-body-md text-error">Não foi possível carregar este projeto.</p>
  }

  if (detail.isPending || !detail.data) return <p className="text-body-md text-on-surface-variant">Carregando…</p>

  const { project, phaseHistory, diaryEntries, tasks, activity } = detail.data
  // Dono do projeto ou quem administra o INOVA — mesma régua da API, para a
  // tela não oferecer o que a rota recusaria.
  const podeGerir = canManageInovaProject(user, inovaProjectOwnershipOf(project))
  const podeCurar = user ? canAdminister(user) : false
  const currentIndex = INOVA_PROJECT_PHASES.findIndex((p) => p.value === project.phase)
  const progress = ((currentIndex + 1) / INOVA_PROJECT_PHASES.length) * 100
  const responsaveis = [project.responsible1?.name, project.responsible2?.name].filter(Boolean).join(', ')
  const temImpacto = project.hoursSaved != null || project.costReduction != null || Boolean(project.results) || Boolean(project.otherMetrics)

  return (
    <section className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <Link
          to="/comunidade-inova/projetos"
          className="inline-flex items-center gap-xs rounded-full px-sm py-xs text-body-md text-on-surface-variant hover:text-on-surface"
        >
          <Icon name="arrow_back" className="text-[18px]" />
          Voltar
        </Link>
        {(podeGerir || podeCurar) && (
          <div className="flex flex-wrap items-center gap-sm">
            {podeCurar && (
              <button
                type="button"
                onClick={() => arquivar.mutate(!project.archived)}
                disabled={arquivar.isPending}
                title="Projetos arquivados não são contabilizados no ranking"
                className="inline-flex items-center gap-sm rounded-full border border-outline-variant/60 px-lg py-sm font-label text-label-md font-bold text-on-surface-variant hover:border-primary/60 hover:text-on-surface disabled:opacity-60"
              >
                <Icon name={project.archived ? 'unarchive' : 'archive'} className="text-[18px]" />
                {project.archived ? 'Reativar projeto' : 'Arquivar projeto'}
              </button>
            )}
            {podeGerir && (
              <>
                <Link
                  to={`/comunidade-inova/projetos/${project.id}/editar`}
                  className="inline-flex items-center gap-sm rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary"
                >
                  <Icon name="edit" className="text-[18px]" />
                  Editar / atualizar seu projeto
                </Link>
                {/* Exclusão é definitiva: leva diário, tarefas e histórico junto
                    (cascata no schema). Arquivar, que preserva, é do admin. */}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Excluir este projeto? O diário, as tarefas e o histórico serão apagados junto. Não dá para desfazer.')) {
                      excluirProjeto.mutate()
                    }
                  }}
                  disabled={excluirProjeto.isPending}
                  className="inline-flex items-center gap-sm rounded-full border border-error/50 px-lg py-sm font-label text-label-md font-bold text-error hover:bg-error/10 disabled:opacity-60"
                >
                  <Icon name="delete" className="text-[18px]" />
                  Excluir projeto
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {project.archived && (
        <p className="flex items-center gap-sm rounded-xl border border-outline-variant/40 bg-surface-container p-md text-body-sm text-on-surface-variant">
          <Icon name="archive" className="text-[20px]" />
          Este projeto está <strong className="text-on-surface">arquivado</strong> e não é contabilizado no ranking dos setores.
        </p>
      )}

      {podeGerir && showReminder && (
        <div role="status" className="flex items-start gap-sm rounded-xl border border-primary/20 bg-primary/5 p-md text-body-sm text-on-surface">
          <Icon name="favorite" className="mt-0.5 shrink-0 text-[18px] text-primary" />
          <p className="flex-1">
            Lembre-se de atualizar o diário, o kanban de tarefas e as evidências — é assim que todo mundo acompanha o
            andamento do seu projeto.
          </p>
          <button
            type="button"
            onClick={() => setShowReminder(false)}
            aria-label="Dispensar lembrete"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-primary/10"
          >
            <Icon name="close" className="text-[16px]" />
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-body-sm text-on-surface">
          {notice}
        </p>
      )}

      <header className="flex flex-col gap-sm">
        <span className="w-fit rounded-full bg-primary/10 px-sm py-0.5 text-body-sm text-on-surface">
          {inovaCategoryIcon(project.category)} {project.category}
        </span>
        <h1 className="font-headline text-headline-lg text-on-surface">{project.title}</h1>
        <InovaRichTextView text={project.description} className="max-w-prose" />
        <div className="mt-sm grid gap-sm md:grid-cols-2">
          <TextBlock label="Problema que este projeto resolve" text={project.problemDescription} />
          <TextBlock label="Prazo estimado para finalizar" text={project.estimatedDeadline} rich={false} />
          <TextBlock label="Ferramentas utilizadas" text={project.toolsUsed} />
          <TextBlock label="Custos do projeto (estimado)" text={project.projectCosts} />
        </div>
      </header>

      <section className={card}>
        <SectionTitle
          icon="route"
          hint={podeGerir ? 'Clique numa fase para mover o projeto — dá para voltar também, se a fase foi marcada errado.' : undefined}
        >
          Progresso na Jornada INOVA
        </SectionTitle>
        <div className="mb-md h-2 overflow-hidden rounded-full bg-surface-container-highest">
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${progress}%` }} />
        </div>
        <ol className="grid grid-cols-3 gap-sm sm:grid-cols-6">
          {INOVA_PROJECT_PHASES.map((phase, i) => {
            const current = i === currentIndex
            const reached = i <= currentIndex
            const circle = current
              ? 'bg-primary text-on-primary ring-2 ring-primary/30 ring-offset-2 ring-offset-surface'
              : reached
                ? 'bg-primary/20 text-primary'
                : 'bg-surface-container-highest text-on-surface-variant'
            const content = (
              <>
                <span className={`flex h-8 w-8 items-center justify-center rounded-full font-mono text-body-sm font-bold ${circle}`}>
                  {i + 1}
                </span>
                <span className={`text-[11px] leading-tight ${current ? 'font-semibold text-primary' : 'text-on-surface-variant'}`}>
                  {phase.label}
                </span>
              </>
            )
            return (
              <li key={phase.value} className="flex justify-center">
                {podeGerir ? (
                  <button
                    type="button"
                    aria-current={current ? 'step' : undefined}
                    aria-label={`Mover para a fase ${phase.label}`}
                    disabled={current || setPhase.isPending}
                    onClick={() => setPhase.mutate(phase.value)}
                    className="flex flex-col items-center gap-xs rounded-lg p-xs text-center hover:bg-primary/5 disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    {content}
                  </button>
                ) : (
                  <div aria-current={current ? 'step' : undefined} className="flex flex-col items-center gap-xs p-xs text-center">
                    {content}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </section>

      <div className="grid items-start gap-md md:grid-cols-2 xl:grid-cols-3">
        <section className={card}>
          <SectionTitle icon="info">Informações</SectionTitle>
          <dl className="flex flex-col gap-sm text-body-sm">
            <div className="flex items-center gap-sm text-on-surface-variant">
              <Icon name="domain" className="text-[16px]" />
              <dt>Setor:</dt>
              <dd className="text-on-surface">{project.sector}</dd>
            </div>
            <div className="flex items-center gap-sm text-on-surface-variant">
              <Icon name="person" className="text-[16px]" />
              <dt>Responsável:</dt>
              <dd className="text-on-surface">{responsaveis || '—'}</dd>
            </div>
            {project.sectorRepresentative && (
              <div className="flex items-center gap-sm text-on-surface-variant">
                <Icon name="badge" className="text-[16px]" />
                <dt>Representante do setor:</dt>
                <dd className="text-on-surface">{project.sectorRepresentative}</dd>
              </div>
            )}
            <div className="flex items-center gap-sm text-on-surface-variant">
              <Icon name="edit_note" className="text-[16px]" />
              <dt>Cadastrado por:</dt>
              <dd className="text-on-surface">
                {project.createdByName}, {formatDate(project.createdAt)}
              </dd>
            </div>
            {project.leadershipChallenge && (
              <div className="flex items-center gap-sm text-on-surface-variant">
                <Icon name="military_tech" className="text-[16px]" />
                <dd className="text-on-surface">Projeto Desafio Alta Liderança</dd>
              </div>
            )}
          </dl>
        </section>

        <section className={card}>
          <SectionTitle icon="trending_up">Métricas de impacto</SectionTitle>
          <dl className="flex flex-col gap-sm text-body-sm">
            {project.hoursSaved != null && (
              <div className="flex items-center gap-sm text-on-surface-variant">
                <Icon name="schedule" className="text-[16px]" />
                <dt>Horas economizadas/mês:</dt>
                <dd className="font-medium text-on-surface">{project.hoursSaved.toLocaleString('pt-BR')}h</dd>
              </div>
            )}
            {project.costReduction != null && (
              <div className="flex items-center gap-sm text-on-surface-variant">
                <Icon name="payments" className="text-[16px]" />
                <dt>Redução de custo:</dt>
                <dd className="font-medium text-on-surface">
                  {project.costReduction.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </dd>
              </div>
            )}
            {project.results && (
              <div className="flex gap-xs text-on-surface-variant">
                <Icon name="check" className="text-[16px] text-primary" />
                <dd className="min-w-0 flex-1">
                  <InovaRichTextView text={project.results} />
                </dd>
              </div>
            )}
            {project.otherMetrics && (
              <div className="flex gap-xs text-on-surface-variant">
                <Icon name="insights" className="text-[16px] text-primary" />
                <dd className="min-w-0 flex-1">
                  <InovaRichTextView text={project.otherMetrics} />
                </dd>
              </div>
            )}
          </dl>
          {!temImpacto && <p className="text-body-sm text-on-surface-variant">Nenhuma métrica registrada ainda.</p>}
          {podeGerir && (
            <Link
              to={`/comunidade-inova/projetos/${project.id}/editar?etapa=impacto`}
              className="mt-md inline-flex items-center gap-xs text-body-sm font-medium text-primary hover:underline"
            >
              <Icon name="add_chart" className="text-[16px]" />
              {temImpacto ? 'Atualizar impacto' : 'Registrar impacto'}
            </Link>
          )}
        </section>

        <section className={card}>
          <SectionTitle icon="timeline">Evolução do projeto</SectionTitle>
          {phaseHistory.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">Nenhum histórico registrado.</p>
          ) : (
            <ol className="relative flex flex-col gap-md border-l-2 border-outline-variant/60 pl-md">
              {phaseHistory.map((h, i) => {
                const last = i === phaseHistory.length - 1
                return (
                  <li key={h.id} className="relative">
                    <span
                      className={`absolute -left-[calc(1rem+7px)] top-1 h-3 w-3 rounded-full border-2 ${
                        last ? 'border-primary bg-primary' : 'border-outline-variant bg-surface'
                      }`}
                    />
                    <p className={`text-body-md font-semibold ${last ? 'text-primary' : 'text-on-surface'}`}>{phaseLabel(h.phase)}</p>
                    <p className="flex items-center gap-xs text-body-sm text-on-surface-variant">
                      <Icon name="event" className="text-[14px]" />
                      {formatDate(h.occurredAt)}
                    </p>
                    {h.note && <p className="text-body-sm text-on-surface-variant">{h.note}</p>}
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </div>


      <section className={card}>
        <div className="mb-md flex items-center justify-between gap-sm">
          <h2 className="flex items-center gap-sm font-headline text-headline-sm text-on-surface">
            <Icon name="history" className="text-[20px] text-primary" />
            Histórico de alterações
          </h2>
          {activity.length > 0 && (
            <span className="text-body-sm text-on-surface-variant">
              {activity.length} {activity.length === 1 ? 'registro' : 'registros'}
            </span>
          )}
        </div>
        <InovaActivityLog items={activity} />
      </section>

      <section className={card}>
        <SectionTitle icon="menu_book">Diário do projeto</SectionTitle>
        <InovaDiary
          projectId={project.id}
          entries={diaryEntries}
          currentUserId={user?.id}
          canManageProject={podeGerir}
          onChanged={invalidate}
        />
      </section>

      <section className={card}>
        <SectionTitle icon="view_kanban" hint="Organize a execução do projeto arrastando as tarefas entre as colunas.">
          Gestão de tarefas do projeto
        </SectionTitle>
        <InovaTaskKanban projectId={project.id} tasks={tasks} canDelete={podeGerir} onChanged={invalidate} />
      </section>

    </section>
  )
}
