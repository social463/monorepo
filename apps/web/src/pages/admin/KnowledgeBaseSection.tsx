import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ASSISTANT_GAPS_DEFAULT_DAYS,
  ASSISTANT_PERSONA_NAME_MAX_LENGTH,
  type AssistantGapsResponse,
  type CreateKnowledgeEntryRequest,
  type KnowledgeEntryDTO,
  type KnowledgeEntryListResponse,
  type SectorDTO,
  isFullAdmin,} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { getAssistantPersona, updateAssistantPersona } from '../../lib/agent-api'
import { useAuth } from '../../auth/AuthContext'
import { Panel, inputCls } from './shared'

type Tab = 'base' | 'gaps'

/** Janelas de dias oferecidas no seletor de lacunas — 30 é o padrão do backend. */
const GAP_WINDOW_OPTIONS = [7, 30, 90] as const

interface FormState {
  id: string | null
  category: string
  question: string
  answer: string
  keywords: string
  isActive: boolean
  /** '' = empresa inteira (só ADMIN escolhe isso); SUBADMIN sempre carrega o próprio setor. */
  sectorId: string
}

function emptyForm(sectorId: string): FormState {
  return { id: null, category: '', question: '', answer: '', keywords: '', isActive: true, sectorId }
}

function toRequest(form: FormState, isAdmin: boolean, ownSectorId: string): CreateKnowledgeEntryRequest {
  return {
    category: form.category.trim() === '' ? null : form.category.trim(),
    question: form.question.trim(),
    answer: form.answer.trim(),
    keywords: form.keywords
      .split(',')
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword !== ''),
    isActive: form.isActive,
    // SUBADMIN nunca escolhe escopo: mandamos sempre o setor dele, travado no
    // formulário — o backend forçaria de qualquer jeito, mas aqui já sai certo.
    sectorId: isAdmin ? (form.sectorId === '' ? null : form.sectorId) : ownSectorId,
  }
}

/**
 * Curadoria da base de conhecimento da assistente de RH e painel de lacunas
 * (perguntas sem resposta, mais frequentes e com feedback negativo). O
 * backend força o escopo por setor para SUBADMIN — o formulário trava o
 * seletor de setor no dele para não sugerir uma escolha que seria negada.
 */
export function KnowledgeBaseSection() {
  const { user } = useAuth()
  const isAdmin = isFullAdmin(user)
  const ownSectorId = user?.sectorId ?? ''
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('base')
  const [form, setForm] = useState<FormState | null>(null)
  const [days, setDays] = useState<number>(ASSISTANT_GAPS_DEFAULT_DAYS)

  const canManagePersona = user?.role === 'ADMIN' || user?.role === 'SUBADMIN'
  const persona = useQuery({ queryKey: ['assistant-persona'], queryFn: getAssistantPersona })
  const [personaName, setPersonaName] = useState('')
  useEffect(() => {
    if (persona.data?.name) setPersonaName(persona.data.name)
  }, [persona.data])

  const salvarPersona = useMutation({
    mutationFn: (name: string) => updateAssistantPersona({ name }),
    onSuccess: (data) => {
      setPersonaName(data.name)
      queryClient.setQueryData(['assistant-persona'], data)
    },
  })

  const base = useQuery({
    queryKey: ['admin', 'knowledge'],
    queryFn: () => apiFetch<KnowledgeEntryListResponse>('/admin/knowledge'),
  })

  const gaps = useQuery({
    queryKey: ['admin', 'assistant-gaps', days],
    queryFn: () => apiFetch<AssistantGapsResponse>(`/admin/assistant/gaps?days=${days}`),
  })

  // Só ADMIN escolhe o escopo — SUBADMIN nem precisa da lista de setores.
  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'] as const,
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
    enabled: isAdmin,
  })
  const sectors = sectorsQuery.data?.sectors ?? []

  const salvar = useMutation({
    mutationFn: (state: FormState) => {
      const body = JSON.stringify(toRequest(state, isAdmin, ownSectorId))
      return state.id
        ? apiFetch(`/admin/knowledge/${state.id}`, { method: 'PATCH', body })
        : apiFetch('/admin/knowledge', { method: 'POST', body })
    },
    onSuccess: () => {
      setForm(null)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'knowledge'] })
    },
  })

  const apagar = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/knowledge/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'knowledge'] }),
  })
  const erroApagar = apagar.isError ? (apagar.error as Error).message : null

  function handleDelete(id: string) {
    // Apagar entrada da base é irreversível — window.confirm é aceitável aqui
    // porque a ação é rara e destrutiva; nos testes ele é mockado.
    if (window.confirm('Apagar esta entrada da base de conhecimento? Essa ação não pode ser desfeita.')) {
      apagar.mutate(id)
    }
  }

  function openNewForm() {
    setForm(emptyForm(isAdmin ? '' : ownSectorId))
  }

  const entries: KnowledgeEntryDTO[] = base.data?.entries ?? []

  return (
    <div className="flex flex-col gap-lg">
      {canManagePersona && (
        <Panel title="Nome da assistente">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              salvarPersona.mutate(personaName)
            }}
            className="flex items-end gap-sm"
          >
            <label className="flex flex-1 flex-col gap-xs font-label text-label-sm text-on-surface">
              Como a assistente se apresenta aos colaboradores
              <input
                className={inputCls}
                value={personaName}
                maxLength={ASSISTANT_PERSONA_NAME_MAX_LENGTH}
                onChange={(event) => setPersonaName(event.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              disabled={salvarPersona.isPending || personaName.trim() === ''}
              className="rounded-md bg-primary px-md py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              Salvar nome
            </button>
          </form>
          {salvarPersona.isError && (
            <p role="alert" className="mt-sm font-body text-body-sm text-error">
              {(salvarPersona.error as Error).message}
            </p>
          )}
        </Panel>
      )}

      <div className="flex gap-sm">
        <button
          type="button"
          onClick={() => setTab('base')}
          aria-pressed={tab === 'base'}
          className="rounded-md border border-outline-variant/60 px-md py-sm font-label text-label-md text-on-surface aria-pressed:bg-primary/10 aria-pressed:font-bold aria-pressed:text-primary"
        >
          Base
        </button>
        <button
          type="button"
          onClick={() => setTab('gaps')}
          aria-pressed={tab === 'gaps'}
          className="rounded-md border border-outline-variant/60 px-md py-sm font-label text-label-md text-on-surface aria-pressed:bg-primary/10 aria-pressed:font-bold aria-pressed:text-primary"
        >
          Lacunas
        </button>
      </div>

      {tab === 'base' && (
        <Panel title="Base de conhecimento">
          <button
            type="button"
            className="mb-lg rounded-md bg-primary px-md py-sm font-label text-label-md text-on-primary"
            onClick={openNewForm}
          >
            Nova entrada
          </button>

          {form && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                salvar.mutate(form)
              }}
              className="mb-lg flex flex-col gap-md rounded-lg border border-outline-variant/40 p-md"
            >
              <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
                Pergunta
                <input
                  className={inputCls}
                  value={form.question}
                  onChange={(event) => setForm({ ...form, question: event.target.value })}
                  required
                />
              </label>
              <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
                Resposta
                <textarea
                  className={inputCls}
                  value={form.answer}
                  onChange={(event) => setForm({ ...form, answer: event.target.value })}
                  required
                />
              </label>
              <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
                Categoria
                <input
                  className={inputCls}
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
                Palavras-chave (separadas por vírgula)
                <input
                  className={inputCls}
                  value={form.keywords}
                  onChange={(event) => setForm({ ...form, keywords: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
                Setor
                {isAdmin ? (
                  <select
                    className={inputCls}
                    value={form.sectorId}
                    onChange={(event) => setForm({ ...form, sectorId: event.target.value })}
                  >
                    <option value="">Toda a empresa</option>
                    {sectors.map((sector) => (
                      <option key={sector.id} value={sector.id}>
                        {sector.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select className={inputCls} value={ownSectorId} disabled>
                    <option value={ownSectorId}>{user?.sectorName ?? 'Seu setor'}</option>
                  </select>
                )}
              </label>
              <label className="flex items-center gap-xs font-label text-label-sm text-on-surface">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                />
                Ativa
              </label>
              {salvar.isError && (
                <p role="alert" className="font-body text-body-sm text-error">
                  {(salvar.error as Error).message}
                </p>
              )}
              <div className="flex gap-sm">
                <button
                  type="submit"
                  disabled={salvar.isPending}
                  className="rounded-md bg-primary px-md py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={() => setForm(null)}
                  className="rounded-md px-md py-sm font-label text-label-md text-on-surface-variant"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {erroApagar && (
            <p role="alert" className="mb-sm font-body text-body-sm text-error">
              {erroApagar}
            </p>
          )}

          <ul className="flex flex-col gap-sm">
            {entries.map((entry) => {
              // SUBADMIN lê a entrada da empresa (sectorId: null) mas o backend
              // rejeita escrita nela — a UI não pode oferecer ações que só vão dar 403.
              const podeGerenciar = isAdmin || entry.sectorId === ownSectorId
              return (
                <li key={entry.id} className="rounded-lg border border-outline-variant/40 p-sm">
                  <p className="font-medium">{entry.question}</p>
                  {entry.category && <p className="text-sm">{entry.category}</p>}
                  <p className="text-sm">{entry.answer}</p>
                  <p className="text-sm">{entry.sectorName ?? 'Toda a empresa'}</p>
                  <p className="text-sm">{entry.isActive ? 'Ativa' : 'Inativa'}</p>
                  {podeGerenciar && (
                    <div className="mt-sm flex gap-sm">
                      <button
                        type="button"
                        className="rounded-md border border-outline-variant/60 px-md py-sm font-label text-label-sm text-on-surface"
                        onClick={() =>
                          setForm({
                            id: entry.id,
                            category: entry.category ?? '',
                            question: entry.question,
                            answer: entry.answer,
                            keywords: entry.keywords.join(', '),
                            isActive: entry.isActive,
                            sectorId: entry.sectorId ?? '',
                          })
                        }
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-error/60 px-md py-sm font-label text-label-sm text-error"
                        onClick={() => handleDelete(entry.id)}
                      >
                        Apagar
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Panel>
      )}

      {tab === 'gaps' && (
        <>
          <Panel
            title="Sem resposta na base"
            action={
              <label className="flex items-center gap-xs font-label text-label-sm text-on-surface-variant">
                Janela
                <select
                  className={inputCls}
                  value={days}
                  onChange={(event) => setDays(Number(event.target.value))}
                >
                  {GAP_WINDOW_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      Últimos {option} dias
                    </option>
                  ))}
                </select>
              </label>
            }
          >
            <ul className="flex flex-col gap-sm">
              {(gaps.data?.unanswered ?? []).map((gap) => (
                <li key={gap.normalized} className="flex items-center justify-between gap-sm">
                  <span>{gap.sample}</span>
                  <span>{gap.count}×</span>
                  <button
                    type="button"
                    className="rounded-md border border-outline-variant/60 px-md py-sm font-label text-label-sm text-on-surface"
                    onClick={() => {
                      setTab('base')
                      setForm({ ...emptyForm(isAdmin ? '' : ownSectorId), question: gap.sample })
                    }}
                  >
                    Criar entrada
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Perguntas mais frequentes">
            <ul className="flex flex-col gap-sm">
              {(gaps.data?.frequent ?? []).map((gap) => (
                <li key={gap.normalized} className="flex justify-between gap-sm">
                  <span>{gap.sample}</span>
                  <span>{gap.count}×</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Com mais feedback negativo">
            <ul className="flex flex-col gap-sm">
              {(gaps.data?.negative ?? []).map((item) => (
                <li key={item.entry.id} className="flex flex-col gap-xs">
                  <span className="font-medium">{item.entry.question}</span>
                  <span>−1 ×{item.negativeCount}</span>
                  {item.comments.map((comment, index) => (
                    <span key={index} className="text-sm">
                      {comment}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </div>
  )
}
