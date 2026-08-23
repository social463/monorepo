import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { OneOnOneMeetingStatus, OneOnOnePersonDTO } from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'
import { ApiError } from '../../lib/api'
import {
  addOneOnOneTopic,
  createOneOnOneAction,
  deleteOneOnOneTopic,
  getOneOnOne,
  listOneOnOnes,
  listOneOnOneTopicTemplates,
  promoteOneOnOneAction,
  saveOneOnOneNote,
  updateOneOnOneAction,
  updateOneOnOneTopic,
} from '../../lib/one-on-one-api'
import { useOneOnOneSocket } from '../../lib/useOneOnOneSocket'
import { Avatar } from '../../components/Avatar'
import { BackButton } from '../../components/BackButton'
import { Icon } from '../../components/Icon'
import { InvitePanel } from './InvitePanel'
import { MeetingActionsMenu } from './MeetingActionsMenu'

/** Classes do sistema de design, num lugar só — as seções desta tela são todas painéis iguais. */
const painelCls = 'flex flex-col gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg'
const painelCabecalhoCls = 'flex items-center justify-between gap-sm border-b border-outline-variant/40 pb-sm'
const painelTituloCls = 'flex items-center gap-xs font-headline text-headline-sm text-on-surface'
const subtituloCls = 'font-label text-label-sm uppercase tracking-wide text-on-surface-variant'
const campoCls =
  'rounded-md border border-outline-variant/40 bg-surface-container-low px-sm py-xs text-body-md text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
const botaoPrimarioCls =
  'shrink-0 rounded-md bg-primary px-md py-xs font-label text-label-lg text-on-primary hover:bg-primary-container'
const botaoSecundarioCls =
  'shrink-0 rounded-md border border-outline-variant/60 px-sm py-[2px] font-label text-label-sm text-on-surface-variant hover:border-primary/40 hover:text-on-surface'

const STATUS_ROTULO: Record<OneOnOneMeetingStatus, string> = {
  SCHEDULED: 'Agendado',
  DONE: 'Realizado',
  CANCELED: 'Cancelado',
}
const STATUS_CLS: Record<OneOnOneMeetingStatus, string> = {
  SCHEDULED: 'bg-primary/15 text-primary',
  DONE: 'bg-surface-container-highest text-on-surface-variant',
  CANCELED: 'bg-error/15 text-error',
}

const quandoLongo = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})
const quandoCurto = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })

function mensagemDeErro(err: unknown, padrao: string): string {
  return err instanceof ApiError ? err.message : padrao
}

function primeiroNome(nome: string): string {
  return nome.split(/\s+/)[0] ?? nome
}

/**
 * Quem responde pela ação: foto + nome curto, sem pílula. A coluna já se chama
 * "Responsável", então o contêiner não informava nada — e qualquer fundo aqui
 * teria de ser mais claro que o painel para não virar buraco, o que deixaria a
 * informação mais pesada que o botão de ação ao lado dela.
 */
function Responsavel({ person, souEu }: { person: OneOnOnePersonDTO; souEu: boolean }) {
  return (
    <span className="inline-flex max-w-full items-center gap-xs font-label text-label-md text-on-surface-variant">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high">
        <Avatar user={person} initialsClassName="font-label text-[9px] font-bold text-primary" />
      </span>
      <span className="truncate">{souEu ? 'Você' : primeiroNome(person.name)}</span>
    </span>
  )
}

// Todo o estado local desta tela pertence a UM encontro: o rascunho da nota
// privada, os campos de formulário ainda não enviados e as mensagens de erro
// de cada seção. O React Router reaproveita este componente quando só o
// parâmetro `:id` muda (não remonta), então nada disso pode sobreviver a uma
// troca de encontro — nem por um render, nem por uma resposta atrasada de rede.
// Por isso o `id` do encontro dono do estado mora DENTRO do próprio estado: é o
// que permite descartar qualquer escrita endereçada a um encontro que não é
// mais o exibido, em vez de tentar adivinhar isso comparando textos.
type EstadoDoEncontro = {
  id: string
  // `notaTexto` é o que está na textarea; `notaSincronizada` é o último valor
  // que a tela ADOTOU do servidor para este encontro. "Rascunho sujo" (há
  // digitação não salva) é exatamente `notaTexto !== notaSincronizada` — um
  // fato do próprio encontro, não uma dedução a partir de um slot global.
  notaTexto: string
  notaSincronizada: string
  novaAcao: string
  /**
   * Quem fica responsável pelo combinado que está sendo escrito. `null` = você
   * — o padrão, porque a maioria dos combinados é de quem os anota.
   *
   * Mora aqui pelo mesmo motivo do resto: trocar de encontro não pode deixar
   * a escolha do 1:1 anterior sobre o formulário do próximo, onde ela
   * apontaria pra uma pessoa que nem participa desta série.
   */
  novaAcaoResponsavel: string | null
  novoTopico: string
  // Qual tópico está aberto para edição e o que já foi digitado nele. Mora aqui,
  // e não num `useState` solto, pela mesma razão que o resto: trocar de encontro
  // não pode deixar um campo de edição aberto sobre a pauta do outro.
  topicoEmEdicao: string | null
  textoEmEdicao: string
  // O mesmo para o combinado em edição. `responsavelEmEdicao: null` significa
  // "ainda não escolhi outro", e a linha mostra o dono atual da ação — não o
  // viewer, senão abrir a edição de uma ação do colega já a passaria para você
  // sem ninguém ter tocado no seletor.
  acaoEmEdicao: string | null
  descricaoEmEdicao: string
  responsavelEmEdicao: string | null
  erroPauta: string | null
  erroAcoes: string | null
  erroNota: string | null
}

function estadoDoEncontro(id: string, nota: string): EstadoDoEncontro {
  return {
    id,
    notaTexto: nota,
    notaSincronizada: nota,
    novaAcao: '',
    novaAcaoResponsavel: null,
    novoTopico: '',
    topicoEmEdicao: null,
    textoEmEdicao: '',
    acaoEmEdicao: null,
    descricaoEmEdicao: '',
    responsavelEmEdicao: null,
    erroPauta: null,
    erroAcoes: null,
    erroNota: null,
  }
}

export function OneOnOneDetailPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // Durante a conversa as duas pessoas estão nesta tela ao mesmo tempo: o que
  // uma escreve na pauta, combina ou conclui aparece na outra sem refresh.
  useOneOnOneSocket()

  const { data, isLoading } = useQuery({ queryKey: ['one-on-one', id], queryFn: () => getOneOnOne(id) })
  const { data: catalogo } = useQuery({
    queryKey: ['one-on-one-topic-templates'],
    queryFn: listOneOnOneTopicTemplates,
  })

  // O histórico com a MESMA pessoa. O detalhe não traz a série inteira, então a
  // fonte é a agenda já existente (`GET /one-on-ones?from&to`), lida numa janela
  // de um ano até este encontro e filtrada pelo par — sem endpoint novo, e
  // aproveitando o cache que a lista de 1:1 já popula.
  const janelaHistorico = useMemo(() => {
    if (!data) return null
    const fim = new Date(data.startsAt)
    const inicio = new Date(fim)
    inicio.setFullYear(inicio.getFullYear() - 1)
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    return { from: iso(inicio), to: iso(fim) }
  }, [data])
  const { data: agenda } = useQuery({
    queryKey: ['one-on-ones', janelaHistorico?.from, janelaHistorico?.to],
    queryFn: () => listOneOnOnes(janelaHistorico!.from, janelaHistorico!.to),
    enabled: janelaHistorico !== null,
  })
  const historico = useMemo(() => {
    if (!agenda || !data) return []
    const limite = new Date(data.startsAt).getTime()
    return agenda.meetings
      .filter(
        (m) => m.counterpart.id === data.counterpart.id && m.id !== data.id && new Date(m.startsAt).getTime() < limite,
      )
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
  }, [agenda, data])

  const notaRemota = data?.note ?? ''
  const [estado, setEstado] = useState<EstadoDoEncontro>(() => estadoDoEncontro(id, ''))

  // LEITURA: a tela nunca mostra estado de outro encontro. Se o estado ainda é
  // do encontro anterior (a janela de um render entre navegar e o efeito abaixo
  // rodar), lê-se o zero do encontro exibido — sem piscar rascunho, erro ou
  // formulário do encontro que ficou para trás.
  const local = estado.id === id ? estado : estadoDoEncontro(id, notaRemota)

  // ESCRITA da UI do encontro exibido agora. Se o estado ainda pertence ao
  // encontro anterior, rebaseia antes de aplicar (não mistura os dois).
  function escreverLocal(patch: Partial<Omit<EstadoDoEncontro, 'id'>>) {
    setEstado((atual) => ({ ...(atual.id === id ? atual : estadoDoEncontro(id, notaRemota)), ...patch }))
  }

  // ESCRITA vinda de uma resposta assíncrona, ENDEREÇADA ao encontro `alvo`.
  // A decisão usa só `atual.id` (o dono do estado) contra `alvo` (o encontro
  // que a mutation de fato salvou, vindo das `variables`) — nunca o `id` do
  // closure, que o TanStack repropaga a cada render e pode já apontar para
  // outro encontro. Resposta de um encontro abandonado não altera NADA:
  // nem texto, nem baseline de sincronização, nem mensagem de erro.
  function escreverResposta(alvo: string, patch: (atual: EstadoDoEncontro) => Partial<Omit<EstadoDoEncontro, 'id'>>) {
    setEstado((atual) => (atual.id === alvo ? { ...atual, ...patch(atual) } : atual))
  }

  // Sincroniza a nota do servidor com o rascunho da tela. Três casos:
  //  - encontro diferente: o estado inteiro passa a ser o do encontro novo
  //    (isso também zera erros e formulários da tela anterior);
  //  - mesmo encontro com rascunho sujo: o valor do servidor é descartado,
  //    senão um refetch (`invalidar`, `refetchOnWindowFocus`) apagaria o que a
  //    pessoa está digitando;
  //  - mesmo encontro com rascunho limpo: adota o valor novo do servidor.
  // As dependências são só primitivos (`id`, `notaRemota`), então o efeito não
  // reexecuta por identidade de objeto/array — e os retornos de `atual`
  // impedem re-render inútil.
  useEffect(() => {
    setEstado((atual) => {
      if (atual.id !== id) return estadoDoEncontro(id, notaRemota)
      const sujo = atual.notaTexto !== atual.notaSincronizada
      if (sujo) return atual
      if (atual.notaTexto === notaRemota && atual.notaSincronizada === notaRemota) return atual
      return { ...atual, notaTexto: notaRemota, notaSincronizada: notaRemota }
    })
  }, [id, notaRemota])

  // Invalida a query do encontro que a mutation mexeu — que pode não ser o
  // exibido, se a pessoa navegou antes da resposta chegar.
  const invalidar = (alvo: string) => queryClient.invalidateQueries({ queryKey: ['one-on-one', alvo] })

  const salvarNota = useMutation({
    mutationFn: ({ id: alvo, body }: { id: string; body: string }) => saveOneOnOneNote(alvo, body),
    onSuccess: (resultado, { id: alvo, body }) => {
      const salvo = resultado.note ?? ''
      escreverResposta(alvo, (atual) => ({
        erroNota: null,
        // O baseline passa a ser o que a API DEVOLVEU (cobre trim/normalização
        // do backend), e o texto na tela só é substituído se a pessoa não
        // digitou de novo entre o blur e a resposta.
        notaSincronizada: salvo,
        notaTexto: atual.notaTexto === body ? salvo : atual.notaTexto,
      }))
    },
    onError: (err, { id: alvo }) =>
      escreverResposta(alvo, () => ({ erroNota: mensagemDeErro(err, 'Não foi possível salvar sua observação.') })),
  })
  const adicionarTopico = useMutation({
    mutationFn: ({ id: alvo, ...input }: { id: string; text: string; origin: 'TEMPLATE' | 'CUSTOM' }) =>
      addOneOnOneTopic(alvo, input),
    onSuccess: (_resultado, { id: alvo }) => {
      escreverResposta(alvo, () => ({ erroPauta: null }))
      invalidar(alvo)
    },
    onError: (err, { id: alvo }) =>
      escreverResposta(alvo, () => ({ erroPauta: mensagemDeErro(err, 'Não foi possível adicionar o tópico.') })),
  })
  const alternarTopico = useMutation({
    mutationFn: (input: { id: string; topicId: string; discussed: boolean }) =>
      updateOneOnOneTopic(input.topicId, { discussed: input.discussed }),
    onSuccess: (_resultado, { id: alvo }) => {
      escreverResposta(alvo, () => ({ erroPauta: null }))
      invalidar(alvo)
    },
    onError: (err, { id: alvo }) =>
      escreverResposta(alvo, () => ({ erroPauta: mensagemDeErro(err, 'Não foi possível atualizar o tópico.') })),
  })
  const renomearTopico = useMutation({
    mutationFn: (input: { id: string; topicId: string; text: string }) =>
      updateOneOnOneTopic(input.topicId, { text: input.text }),
    onSuccess: (_resultado, { id: alvo }) => {
      escreverResposta(alvo, () => ({ erroPauta: null, topicoEmEdicao: null, textoEmEdicao: '' }))
      invalidar(alvo)
    },
    onError: (err, { id: alvo }) =>
      escreverResposta(alvo, () => ({ erroPauta: mensagemDeErro(err, 'Não foi possível editar o tópico.') })),
  })
  const removerTopico = useMutation({
    mutationFn: (input: { id: string; topicId: string }) => deleteOneOnOneTopic(input.topicId),
    onSuccess: (_resultado, { id: alvo }) => {
      escreverResposta(alvo, () => ({ erroPauta: null }))
      invalidar(alvo)
    },
    onError: (err, { id: alvo }) =>
      escreverResposta(alvo, () => ({ erroPauta: mensagemDeErro(err, 'Não foi possível remover o tópico.') })),
  })
  const criarAcao = useMutation({
    mutationFn: ({ id: alvo, ...input }: { id: string; description: string; ownerId: string }) =>
      createOneOnOneAction(alvo, { ...input, dueDate: null }),
    onSuccess: (_resultado, { id: alvo }) => {
      escreverResposta(alvo, () => ({ erroAcoes: null }))
      invalidar(alvo)
    },
    onError: (err, { id: alvo }) =>
      escreverResposta(alvo, () => ({ erroAcoes: mensagemDeErro(err, 'Não foi possível combinar a ação.') })),
  })
  /**
   * Editar um combinado já registrado. Descrição e responsável na mesma
   * requisição: quem corrige "eu levo isso pro time" costuma estar corrigindo
   * *quem* leva junto com *o quê*, e dois PATCHes deixariam a linha meio salva
   * se o segundo falhasse.
   */
  const editarAcao = useMutation({
    mutationFn: (input: { id: string; actionId: string; description: string; ownerId: string }) =>
      updateOneOnOneAction(input.actionId, { description: input.description, ownerId: input.ownerId }),
    onSuccess: (_resultado, { id: alvo }) => {
      escreverResposta(alvo, () => ({
        erroAcoes: null,
        acaoEmEdicao: null,
        descricaoEmEdicao: '',
        responsavelEmEdicao: null,
      }))
      invalidar(alvo)
    },
    onError: (err, { id: alvo }) =>
      escreverResposta(alvo, () => ({ erroAcoes: mensagemDeErro(err, 'Não foi possível editar a ação.') })),
  })
  const mudarAcao = useMutation({
    mutationFn: (input: { id: string; actionId: string; status: 'OPEN' | 'DONE' }) =>
      updateOneOnOneAction(input.actionId, { status: input.status }),
    onSuccess: (_resultado, { id: alvo }) => {
      escreverResposta(alvo, () => ({ erroAcoes: null }))
      invalidar(alvo)
    },
    onError: (err, { id: alvo }) =>
      escreverResposta(alvo, () => ({ erroAcoes: mensagemDeErro(err, 'Não foi possível atualizar a ação.') })),
  })
  const promover = useMutation({
    mutationFn: (input: { id: string; actionId: string }) => promoteOneOnOneAction(input.actionId),
    onSuccess: (_resultado, { id: alvo }) => {
      escreverResposta(alvo, () => ({ erroAcoes: null }))
      invalidar(alvo)
    },
    onError: (err, { id: alvo }) =>
      escreverResposta(alvo, () => ({ erroAcoes: mensagemDeErro(err, 'Não foi possível adicionar a ação ao PDI.') })),
  })

  if (isLoading || !data)
    return <p className="p-lg text-body-md text-on-surface-variant">Carregando…</p>

  const notaSuja = local.notaTexto !== local.notaSincronizada
  const temAcoes = data.openActions.length > 0 || data.closedActions.length > 0

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header className="flex flex-col gap-md rounded-xl border border-outline-variant/40 bg-surface-container-low p-lg md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-md">
          {/* Não há item de menu para um encontro: entra-se pela lista, daí a seta. */}
          <BackButton fallback="/1-1" className="-ml-sm" />
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-primary-container bg-surface-container-highest">
            <Avatar user={data.counterpart} />
          </span>
          <div className="min-w-0">
            <h1 className="font-headline text-headline-md text-primary md:text-headline-lg">
              1:1 com {data.counterpart.name}
            </h1>
            <p className="flex items-center gap-xs text-body-sm text-on-surface-variant">
              <Icon name="calendar_today" className="text-[16px]" />
              {quandoLongo.format(new Date(data.startsAt))}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-sm self-start md:self-auto">
          <span className={`rounded-full px-sm py-[2px] font-label text-label-sm ${STATUS_CLS[data.status]}`}>
            {STATUS_ROTULO[data.status]}
          </span>
          {/* Cancelado daqui não tem para onde voltar: a lista não mostra
              encontro cancelado, então a tela sai para /1-1. */}
          <MeetingActionsMenu meeting={data} onCanceled={() => navigate('/1-1')} />
        </div>
      </header>

      {/* Antes de tudo: um convite sem resposta é a primeira coisa a resolver na
          tela, e a pauta só faz sentido depois de saber se o encontro vai ocorrer. */}
      {data.status === 'SCHEDULED' && <InvitePanel meeting={data} />}

      <div className="grid gap-lg lg:grid-cols-12 lg:items-start">
        <div className="flex flex-col gap-lg lg:col-span-8">
          {/* Pauta */}
          <section className={painelCls}>
            <div className={painelCabecalhoCls}>
              <h2 className={painelTituloCls}>
                <Icon name="list_alt" className="text-[20px] text-primary" />
                Pauta
              </h2>
            </div>
            {local.erroPauta && (
              <p role="alert" className="text-body-sm text-error">
                {local.erroPauta}
              </p>
            )}
            {data.topics.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">Nenhum tópico na pauta ainda.</p>
            ) : (
              <ul className="flex flex-col gap-xs">
                {data.topics.map((topic) => (
                  <li
                    key={topic.id}
                    className="group flex items-start gap-sm rounded-lg bg-surface-container-low p-sm transition-colors hover:bg-surface-container-high"
                  >
                    <input
                      type="checkbox"
                      checked={topic.discussed}
                      aria-label={`Marcar "${topic.text}" como discutido`}
                      onChange={(event) =>
                        alternarTopico.mutate({ id, topicId: topic.id, discussed: event.target.checked })
                      }
                      className="mt-[3px] h-4 w-4 shrink-0 accent-primary"
                    />
                    {local.topicoEmEdicao === topic.id ? (
                      // Edição no lugar do texto, sem modal: tópico de pauta é uma
                      // linha curta, e tirar a pessoa da lista para trocar duas
                      // palavras custa mais que o próprio ajuste.
                      <form
                        className="flex flex-1 items-center gap-xs"
                        onSubmit={(event) => {
                          event.preventDefault()
                          const texto = local.textoEmEdicao.trim()
                          if (!texto || texto === topic.text) {
                            escreverLocal({ topicoEmEdicao: null, textoEmEdicao: '' })
                            return
                          }
                          renomearTopico.mutate({ id, topicId: topic.id, text: texto })
                        }}
                      >
                        <input
                          autoFocus
                          value={local.textoEmEdicao}
                          aria-label={`Editar "${topic.text}"`}
                          onChange={(event) => escreverLocal({ textoEmEdicao: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') escreverLocal({ topicoEmEdicao: null, textoEmEdicao: '' })
                          }}
                          className={`flex-1 ${campoCls}`}
                        />
                        <button type="submit" aria-label="Salvar tópico" className={botaoSecundarioCls}>
                          Salvar
                        </button>
                      </form>
                    ) : (
                      <>
                        <span
                          className={
                            topic.discussed
                              ? 'flex-1 text-body-md text-on-surface-variant line-through'
                              : 'flex-1 text-body-md text-on-surface'
                          }
                        >
                          {topic.text}
                        </span>
                        <button
                          type="button"
                          aria-label={`Editar "${topic.text}"`}
                          className="shrink-0 leading-none text-on-surface-variant opacity-60 transition-opacity hover:text-primary group-hover:opacity-100"
                          onClick={() => escreverLocal({ topicoEmEdicao: topic.id, textoEmEdicao: topic.text })}
                        >
                          <Icon name="edit" className="text-[16px]" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remover "${topic.text}" da pauta`}
                          className="shrink-0 leading-none text-on-surface-variant opacity-60 transition-opacity hover:text-error group-hover:opacity-100"
                          onClick={() => removerTopico.mutate({ id, topicId: topic.id })}
                        >
                          <Icon name="close" className="text-[18px]" />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!local.novoTopico.trim()) return
                adicionarTopico.mutate({ id, text: local.novoTopico, origin: 'CUSTOM' })
                escreverLocal({ novoTopico: '' })
              }}
              className="flex gap-sm"
            >
              <input
                value={local.novoTopico}
                onChange={(event) => escreverLocal({ novoTopico: event.target.value })}
                placeholder="Adicionar tópico"
                aria-label="Adicionar tópico"
                className={`${campoCls} flex-1`}
              />
              <button type="submit" className={botaoPrimarioCls}>
                Adicionar
              </button>
            </form>

            {(catalogo?.templates ?? []).length > 0 && (
              <div className="flex flex-col gap-xs">
                <p className={subtituloCls}>Sugestões</p>
                <div className="flex flex-wrap gap-xs">
                  {(catalogo?.templates ?? []).map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => adicionarTopico.mutate({ id, text: template.text, origin: 'TEMPLATE' })}
                      className="rounded-full border border-outline-variant/60 px-sm py-[2px] font-label text-label-sm text-on-surface-variant hover:border-primary/40 hover:text-on-surface"
                    >
                      {template.text}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Ações */}
          <section className={painelCls}>
            <div className={painelCabecalhoCls}>
              <h2 className={painelTituloCls}>
                <Icon name="task_alt" className="text-[20px] text-secondary" />
                Ações combinadas
              </h2>
            </div>
            {local.erroAcoes && (
              <p role="alert" className="text-body-sm text-error">
                {local.erroAcoes}
              </p>
            )}

            {!temAcoes ? (
              <p className="text-body-sm text-on-surface-variant">Nada combinado com {data.counterpart.name} ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className={`border-b border-outline-variant/40 ${subtituloCls}`}>
                      <th className="py-xs pr-sm font-medium">Tarefa</th>
                      <th className="px-sm py-xs font-medium">Responsável</th>
                      <th className="py-xs pl-sm text-right font-medium">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.openActions.map((action) =>
                      local.acaoEmEdicao === action.id ? (
                        // Edição no lugar da linha, sem modal — mesma escolha da
                        // pauta. A linha inteira vira o formulário porque os dois
                        // campos editáveis moram em colunas diferentes dela.
                        <tr key={action.id} className="border-b border-outline-variant/20">
                          <td colSpan={3} className="py-sm">
                            <form
                              className="flex flex-wrap items-center gap-sm"
                              onSubmit={(event) => {
                                event.preventDefault()
                                const descricao = local.descricaoEmEdicao.trim()
                                const responsavel = local.responsavelEmEdicao ?? action.owner.id
                                // Sem texto, ou nada mudou: fecha sem gastar uma
                                // requisição que a API recusaria ou ignoraria.
                                if (
                                  !descricao ||
                                  (descricao === action.description && responsavel === action.owner.id)
                                ) {
                                  escreverLocal({
                                    acaoEmEdicao: null,
                                    descricaoEmEdicao: '',
                                    responsavelEmEdicao: null,
                                  })
                                  return
                                }
                                editarAcao.mutate({
                                  id,
                                  actionId: action.id,
                                  description: descricao,
                                  ownerId: responsavel,
                                })
                              }}
                            >
                              <input
                                autoFocus
                                value={local.descricaoEmEdicao}
                                aria-label={`Editar "${action.description}"`}
                                onChange={(event) => escreverLocal({ descricaoEmEdicao: event.target.value })}
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape')
                                    escreverLocal({
                                      acaoEmEdicao: null,
                                      descricaoEmEdicao: '',
                                      responsavelEmEdicao: null,
                                    })
                                }}
                                className={`${campoCls} min-w-[12rem] flex-1`}
                              />
                              <label className="sr-only" htmlFor={`responsavel-${action.id}`}>
                                Responsável por &quot;{action.description}&quot;
                              </label>
                              <select
                                id={`responsavel-${action.id}`}
                                value={local.responsavelEmEdicao ?? action.owner.id}
                                onChange={(event) => escreverLocal({ responsavelEmEdicao: event.target.value })}
                                className={campoCls}
                              >
                                {/* Os mesmos dois nomes do formulário de criar: o
                                    serviço recusa qualquer `ownerId` de fora do par. */}
                                <option value={user?.id ?? ''}>Você</option>
                                <option value={data.counterpart.id}>{primeiroNome(data.counterpart.name)}</option>
                              </select>
                              <button type="submit" className={botaoSecundarioCls}>
                                Salvar
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  escreverLocal({
                                    acaoEmEdicao: null,
                                    descricaoEmEdicao: '',
                                    responsavelEmEdicao: null,
                                  })
                                }
                                className={botaoSecundarioCls}
                              >
                                Cancelar
                              </button>
                            </form>
                          </td>
                        </tr>
                      ) : (
                        <tr
                          key={action.id}
                          className="group border-b border-outline-variant/20 transition-colors hover:bg-surface-container-high"
                        >
                          <td className="py-sm pr-sm text-body-md text-on-surface">{action.description}</td>
                          <td className="px-sm py-sm">
                            <Responsavel person={action.owner} souEu={action.owner.id === user?.id} />
                          </td>
                          <td className="py-sm pl-sm">
                            <div className="flex flex-wrap items-center justify-end gap-xs">
                              <button
                                type="button"
                                aria-label={`Editar "${action.description}"`}
                                className="shrink-0 leading-none text-on-surface-variant opacity-60 transition-opacity hover:text-primary group-hover:opacity-100"
                                onClick={() =>
                                  escreverLocal({
                                    acaoEmEdicao: action.id,
                                    descricaoEmEdicao: action.description,
                                    responsavelEmEdicao: action.owner.id,
                                  })
                                }
                              >
                                <Icon name="edit" className="text-[16px]" />
                              </button>
                              <button
                                type="button"
                                onClick={() => mudarAcao.mutate({ id, actionId: action.id, status: 'DONE' })}
                                className={botaoSecundarioCls}
                              >
                                Concluir
                              </button>
                              {data.pdi?.canPromote && !action.pdiActionId && (
                                <button
                                  type="button"
                                  onClick={() => promover.mutate({ id, actionId: action.id })}
                                  className={botaoSecundarioCls}
                                >
                                  Adicionar ao PDI
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ),
                    )}

                    {/* O histórico do encontro: o que fechou aqui, e como fechou. */}
                    {data.closedActions.map((action) => (
                      <tr key={action.id} className="border-b border-outline-variant/20">
                        <td
                          className={
                            action.status === 'DONE'
                              ? 'py-sm pr-sm text-body-md text-on-surface-variant line-through'
                              : 'py-sm pr-sm text-body-md text-on-surface-variant'
                          }
                        >
                          {action.description}
                        </td>
                        <td className="px-sm py-sm">
                          <Responsavel person={action.owner} souEu={action.owner.id === user?.id} />
                        </td>
                        <td className="py-sm pl-sm text-right">
                          {action.pdiActionId ? (
                            // A cobrança passou a ser do PDI — o rastro leva para lá.
                            <Link
                              to="/pdi"
                              className="rounded-full border border-outline-variant/60 px-sm py-[2px] font-label text-label-sm text-on-surface-variant no-underline hover:text-on-surface"
                            >
                              No PDI
                            </Link>
                          ) : (
                            <span className="rounded-full bg-primary/15 px-sm py-[2px] font-label text-label-sm text-primary">
                              Concluída
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* O botão "Adicionar ao PDI" só existe para o dono de um plano ativo
                do par. Quando ele não aparece, a tela diz por quê — sem inventar
                estado que o DTO não informa: `pdi: null` significa exatamente
                "não há plano ativo ligando estas duas pessoas", e nada além disso. */}
            {!data.pdi && (
              <p className="text-body-sm text-on-surface-variant">
                Você ainda não tem um plano de PDI ativo com {data.counterpart.name}, então não dá para levar um
                combinado daqui para o plano.{' '}
                <Link to="/pdi" className="text-primary hover:underline">
                  Ver meu PDI
                </Link>
              </p>
            )}
            {data.pdi && !data.pdi.canPromote && (
              <p className="text-body-sm text-on-surface-variant">
                O plano é de {data.pdi.owner.name}: só o {data.pdi.owner.name} adiciona ações ao PDI dele.
              </p>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!local.novaAcao.trim() || !user) return
                criarAcao.mutate({
                  id,
                  description: local.novaAcao,
                  ownerId: local.novaAcaoResponsavel ?? user.id,
                })
                // Só o texto é limpo: quem acabou de combinar duas coisas
                // para a mesma pessoa não deveria reescolher a cada linha.
                escreverLocal({ novaAcao: '' })
              }}
              className="flex gap-sm"
            >
              <input
                value={local.novaAcao}
                onChange={(event) => escreverLocal({ novaAcao: event.target.value })}
                placeholder="Combinar uma ação"
                aria-label="Combinar uma ação"
                className={`${campoCls} flex-1`}
              />
              <label className="sr-only" htmlFor="responsavel-nova-acao">
                Responsável pelo combinado
              </label>
              <select
                id="responsavel-nova-acao"
                value={local.novaAcaoResponsavel ?? user?.id ?? ''}
                onChange={(event) => escreverLocal({ novaAcaoResponsavel: event.target.value })}
                className={campoCls}
              >
                {/* Só os dois da série: o serviço recusa qualquer outro
                    `ownerId` (tem que ser `userA` ou `userB`). */}
                <option value={user?.id ?? ''}>Você</option>
                <option value={data.counterpart.id}>{primeiroNome(data.counterpart.name)}</option>
              </select>
              <button type="submit" className={botaoPrimarioCls}>
                Combinar
              </button>
            </form>
          </section>
        </div>

        <div className="flex flex-col gap-lg lg:col-span-4">
          {/* Observações privadas */}
          <section className={`${painelCls} relative overflow-hidden`}>
            {/* O brilho de canto marca visualmente que esta coluna é a parte privada da tela. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-32 w-32 rounded-full bg-primary/5 blur-2xl"
            />
            <div className={painelCabecalhoCls}>
              <h2 className={painelTituloCls}>
                <Icon name="edit_note" className="text-[20px] text-tertiary" />
                Minhas observações
              </h2>
            </div>
            <p className="flex items-start gap-xs rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-sm text-body-sm text-on-surface-variant">
              <Icon name="lock" className="mt-[2px] text-[16px]" />
              <span>Só você vê o que escrever aqui. Serve para pontos sensíveis e lembretes pessoais.</span>
            </p>
            {local.erroNota && (
              <p role="alert" className="text-body-sm text-error">
                {local.erroNota}
              </p>
            )}
            <textarea
              value={local.notaTexto}
              onChange={(event) => escreverLocal({ notaTexto: event.target.value })}
              onBlur={() => salvarNota.mutate({ id, body: local.notaTexto })}
              aria-label="Minhas observações"
              rows={6}
              placeholder="Digite suas notas aqui…"
              className={`${campoCls} min-h-[150px] w-full resize-y`}
            />
            <div className="flex justify-end">
              {/* O salvamento de verdade é o `onBlur` — é ele que protege a nota
                  de uma navegação no meio da digitação. Este botão existe para
                  quem quer confirmar, e por isso segura o blur (`onMouseDown`):
                  sem isso o clique salvaria duas vezes o mesmo texto. */}
              <button
                type="button"
                disabled={!notaSuja || salvarNota.isPending}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (local.notaTexto !== local.notaSincronizada) salvarNota.mutate({ id, body: local.notaTexto })
                }}
                className={`${botaoSecundarioCls} disabled:cursor-default disabled:opacity-50 disabled:hover:border-outline-variant/60 disabled:hover:text-on-surface-variant`}
              >
                {salvarNota.isPending ? 'Salvando…' : notaSuja ? 'Salvar notas' : 'Notas salvas'}
              </button>
            </div>
          </section>

          {/* PDI */}
          {data.pdi && (
            <section className={painelCls}>
              <div className={painelCabecalhoCls}>
                <h2 className={painelTituloCls}>
                  <Icon name="trending_up" className="text-[20px] text-secondary" />
                  Plano de {primeiroNome(data.pdi.owner.name)}
                </h2>
              </div>
              <p className="font-label text-label-lg text-on-surface">{data.pdi.planTitle}</p>
              {data.pdi.actions.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant">Nenhuma ação no plano ainda.</p>
              ) : (
                <ul className="flex flex-col gap-xs">
                  {data.pdi.actions.map((action) => (
                    <li
                      key={action.id}
                      className="flex items-center justify-between gap-sm rounded-lg bg-surface-container-low px-sm py-xs"
                    >
                      <span className="min-w-0 flex-1 truncate text-body-md text-on-surface">{action.description}</span>
                      <span className="shrink-0 font-label text-label-sm text-on-surface-variant">
                        {action.progressPct}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Histórico com a mesma pessoa */}
          <section className={painelCls}>
            <div className={painelCabecalhoCls}>
              <h2 className={painelTituloCls}>
                <Icon name="history" className="text-[20px] text-on-surface-variant" />
                Histórico
              </h2>
            </div>
            {historico.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">
                Nenhum encontro anterior com {primeiroNome(data.counterpart.name)} no último ano.
              </p>
            ) : (
              <>
                <ul className="relative flex flex-col gap-sm before:absolute before:inset-y-xs before:left-[3px] before:w-px before:bg-outline-variant/40">
                  {historico.slice(0, 5).map((meeting, indice) => (
                    <li key={meeting.id} className="relative pl-lg">
                      <span
                        aria-hidden
                        className={`absolute left-0 top-[6px] h-2 w-2 rounded-full ring-4 ring-surface-container ${
                          indice === 0 ? 'bg-primary' : 'bg-outline-variant'
                        }`}
                      />
                      <p className="font-label text-label-md text-on-surface">
                        {quandoCurto.format(new Date(meeting.startsAt))}
                      </p>
                      <Link to={`/1-1/${meeting.id}`} className="text-body-sm text-primary hover:underline">
                        Ver detalhes
                      </Link>
                    </li>
                  ))}
                </ul>
                {historico.length > 5 && (
                  <Link to="/1-1" className="text-center font-label text-label-sm text-primary hover:underline">
                    Ver histórico completo
                  </Link>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}
