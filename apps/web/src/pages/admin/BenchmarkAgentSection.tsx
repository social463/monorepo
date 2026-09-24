import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AGENT_MESSAGE_MAX_LENGTH,
  BENCHMARK_PRACTICE_CATEGORIES,
  BENCHMARK_PRACTICE_DESCRIPTION_MAX_LENGTH,
  BENCHMARK_PRACTICE_TITLE_MAX_LENGTH,
  type AgentMessageDTO,
  type BenchmarkPracticeDTO,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import {
  askAgent,
  createBenchmarkPractice,
  deleteBenchmarkPractice,
  getAgentConversation,
  listAgentConversations,
  listBenchmarkPractices,
} from '../../lib/agent-api'
import { AgentChat } from '../../components/AgentChat'
import { Icon } from '../../components/Icon'
import { Markdown } from '../../components/Markdown'
import { Panel, inputCls } from './shared'

const PRACTICES_KEY = ['admin', 'benchmark-practices']
const CONVERSATIONS_KEY = ['admin', 'agent', 'benchmark', 'conversations']

const WELCOME =
  'Sou o agente de benchmarking de cultura, experiência do colaborador e employer branding. Posso analisar práticas de empresas do mercado, comparar com as práticas internas cadastradas e sugerir oportunidades. Por onde quer começar? Ex.: "Benchmark de programas de saúde mental em empresas de tecnologia no Brasil".'

type Tab = 'chat' | 'praticas'

export function BenchmarkAgentSection() {
  const [tab, setTab] = useState<Tab>('chat')
  const practices = useQuery({ queryKey: PRACTICES_KEY, queryFn: listBenchmarkPractices })
  const practiceCount = practices.data?.practices.length ?? 0

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h2 className="font-headline text-headline-lg text-on-surface">Agente de Benchmarking</h2>
        <p className="text-body-sm text-on-surface-variant">
          Análise de mercado em cultura, experiência do colaborador e employer branding.
        </p>
      </header>

      <div role="tablist" className="flex gap-sm">
        <button
          role="tab"
          aria-selected={tab === 'chat'}
          onClick={() => setTab('chat')}
          className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${tab === 'chat' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}
        >
          Agente
        </button>
        <button
          role="tab"
          aria-selected={tab === 'praticas'}
          onClick={() => setTab('praticas')}
          className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${tab === 'praticas' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}
        >
          Práticas internas ({practiceCount})
        </button>
      </div>

      {tab === 'chat' ? <ChatTab /> : <PracticesTab practices={practices.data?.practices ?? []} />}
    </div>
  )
}

// ----- Aba do chat -----

/**
 * O chat em si mora em `components/AgentChat`: era idêntico ao do assistente da
 * trilha Eu Aprendiz, e o que difere entre agentes são os textos e o system
 * prompt do servidor, nunca a mecânica.
 */
function ChatTab() {
  return (
    <AgentChat
      agent="benchmark"
      title="Consultor estratégico de cultura"
      welcome={WELCOME}
      placeholder="Ex.: Benchmark de ações de Setembro Amarelo em edtechs brasileiras"
      pendingLabel="Analisando o mercado…"
      footnote="O agente usa as práticas internas cadastradas como contexto de comparação."
    />
  )
}


// ----- Aba do inventário -----

function PracticesTab({ practices }: { practices: BenchmarkPracticeDTO[] }) {
  const qc = useQueryClient()
  const [category, setCategory] = useState(BENCHMARK_PRACTICE_CATEGORIES[0])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [channel, setChannel] = useState('')
  const [tags, setTags] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: createBenchmarkPractice,
    onSuccess: () => {
      setMessage('Prática cadastrada.')
      setTitle('')
      setDescription('')
      setChannel('')
      setTags('')
      qc.invalidateQueries({ queryKey: PRACTICES_KEY })
    },
    onError: (err) => setMessage(err instanceof ApiError ? err.message : 'Erro ao cadastrar prática.'),
  })

  const remove = useMutation({
    mutationFn: deleteBenchmarkPractice,
    onSuccess: () => qc.invalidateQueries({ queryKey: PRACTICES_KEY }),
    onError: (err) => setMessage(err instanceof ApiError ? err.message : 'Erro ao remover prática.'),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    create.mutate({
      category,
      title: title.trim(),
      description: description.trim() || null,
      channel: channel.trim() || null,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    })
  }

  return (
    <div className="flex flex-col gap-lg">
      <Panel title="Cadastrar prática interna">
        <form onSubmit={submit} className="flex flex-col gap-md">
          <div className="grid gap-md sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Categoria</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-label="Categoria da prática"
                className={inputCls}
              >
                {BENCHMARK_PRACTICE_CATEGORIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Canal de divulgação</span>
              <input
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                aria-label="Canal de divulgação"
                placeholder="LinkedIn, Teams, Notion…"
                className={inputCls}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Título da prática</span>
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={BENCHMARK_PRACTICE_TITLE_MAX_LENGTH}
              aria-label="Título da prática"
              placeholder="Ex.: Day off de aniversário"
              className={inputCls}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Descrição</span>
            <textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={BENCHMARK_PRACTICE_DESCRIPTION_MAX_LENGTH}
              aria-label="Descrição da prática"
              placeholder="O que é, público-alvo, frequência, resultados…"
              className={inputCls}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Tags (separadas por vírgula)</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              aria-label="Tags da prática"
              placeholder="reconhecimento, mensal, presencial"
              className={inputCls}
            />
          </label>

          <button
            type="submit"
            disabled={create.isPending}
            aria-label="Adicionar prática"
            className="inline-flex w-fit items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            <Icon name="add" className="text-[18px]" />
            Adicionar prática
          </button>
        </form>
      </Panel>

      {message && (
        <p role="status" className="flex items-center gap-sm text-body-sm text-on-surface-variant">
          <Icon name={message.includes('Erro') ? 'error' : 'check_circle'} className="text-[18px] text-primary" />
          {message}
        </p>
      )}

      {practices.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          Nenhuma prática cadastrada ainda. Adicione as iniciativas da empresa para o agente comparar com o mercado.
        </p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {practices.map((practice) => (
            <li
              key={practice.id}
              className="flex items-start justify-between gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-md"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-sm">
                  <span className="rounded-full bg-primary/10 px-sm py-0.5 font-label text-label-sm text-primary">
                    {practice.category}
                  </span>
                  {practice.channel && (
                    <span className="text-body-sm text-on-surface-variant">via {practice.channel}</span>
                  )}
                </div>
                <p className="mt-xs font-label text-label-lg text-on-surface">{practice.title}</p>
                {practice.description && (
                  <p className="text-body-sm text-on-surface-variant">{practice.description}</p>
                )}
                {practice.tags.length > 0 && (
                  <div className="mt-xs flex flex-wrap gap-xs">
                    {practice.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-surface-container-highest px-xs py-0.5 text-body-sm text-on-surface-variant"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove.mutate(practice.id)}
                disabled={remove.isPending}
                aria-label={`Remover ${practice.title}`}
                className="rounded-md p-xs text-on-surface-variant hover:text-error disabled:opacity-50"
              >
                <Icon name="delete" className="text-[18px]" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
