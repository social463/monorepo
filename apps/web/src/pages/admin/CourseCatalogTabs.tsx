/**
 * Catálogo da Central de Cursos: Categorias, Competências e Instrutores
 * (Documento 4, seções 9.6 e 9.7).
 *
 * As três abas têm a mesma forma — lista, formulário de criação, edição em
 * linha, desativar e excluir —, então a casca é uma só (`CatalogPanel`) e cada
 * aba entra só com os campos que tem.
 *
 * **Excluir não é o botão principal.** Categoria, competência e instrutor com
 * curso atrás não podem ser apagados: o service recusa com 409, e a tela mostra
 * o contador de cursos junto do item para que isso não seja surpresa. Desativar
 * é o caminho, e continua sendo o do meio.
 */

import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  COMPETENCY_DESCRIPTION_MAX_LENGTH,
  COMPETENCY_NAME_MAX_LENGTH,
  COURSE_CATEGORY_NAME_MAX_LENGTH,
  INSTRUCTOR_BIO_MAX_LENGTH,
  INSTRUCTOR_NAME_MAX_LENGTH,
  sortCategoriesAsTree,
  type CompetencyDTO,
  type CourseCategoryDTO,
  type InstructorDTO,
  type PublicUser,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { competenciesApi, courseCategoriesApi, instructorsApi } from '../../lib/learning-api'
import { apiFetch } from '../../lib/api'
import { errorMessage, inputCls } from './shared'

const CATEGORIES_KEY = ['admin', 'course-categories']
const COMPETENCIES_KEY = ['admin', 'competencies']
const INSTRUCTORS_KEY = ['admin', 'instructors']

/** Item do catálogo, como a lista o desenha: ícone, nome, apoio e contador. */
function CatalogRow({
  icon,
  title,
  support,
  courseCount,
  active,
  onToggleActive,
  onRemove,
  children,
}: {
  icon: string | null
  title: string
  support?: ReactNode
  courseCount: number
  active: boolean
  onToggleActive: () => void
  onRemove: () => void
  children?: ReactNode
}) {
  return (
    <li className="flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container p-md">
      <div className="flex flex-wrap items-center gap-sm">
        <span className="text-[20px] leading-none">{icon || '•'}</span>
        <span className="min-w-0 flex-1">
          <span className={`block font-label text-label-lg ${active ? 'text-on-surface' : 'text-on-surface-variant line-through'}`}>
            {title}
          </span>
          {support && <span className="block text-body-sm text-on-surface-variant">{support}</span>}
        </span>

        {/* O contador fica ao lado do excluir porque é ele que explica o 409. */}
        <span className="shrink-0 rounded-full bg-surface-container-highest px-sm py-0.5 font-label text-label-sm text-on-surface-variant">
          {courseCount} curso{courseCount === 1 ? '' : 's'}
        </span>

        <button
          type="button"
          onClick={onToggleActive}
          className="rounded-full px-sm py-0.5 font-label text-label-sm text-on-surface-variant hover:text-primary"
        >
          {active ? 'Desativar' : 'Reativar'}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Excluir ${title}`}
          className="rounded-full p-1 text-on-surface-variant hover:text-error"
        >
          <Icon name="delete" className="text-[18px]" />
        </button>
      </div>
      {children}
    </li>
  )
}

function CatalogPanel({
  title,
  description,
  error,
  children,
}: {
  title: string
  description: string
  error: string | null
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-md">
      <header>
        <h3 className="font-headline text-title-lg text-on-surface">{title}</h3>
        <p className="text-body-sm text-on-surface-variant">{description}</p>
      </header>
      {error && <p className="text-body-md text-error">{error}</p>}
      {children}
    </section>
  )
}

// --- Categorias --------------------------------------------------------------

export function CourseCategoriesTab() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [parentId, setParentId] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const { data } = useQuery({ queryKey: CATEGORIES_KEY, queryFn: courseCategoriesApi.list })
  const categorias = sortCategoriesAsTree(data?.categories ?? [])
  const invalidate = () => qc.invalidateQueries({ queryKey: CATEGORIES_KEY })

  const criar = useMutation({
    mutationFn: () =>
      courseCategoriesApi.create({
        name: name.trim(),
        icon: icon.trim() || null,
        parentId: parentId || null,
      }),
    onSuccess: () => {
      setName('')
      setIcon('')
      setParentId('')
      setErro(null)
      invalidate()
    },
    onError: (err) => setErro(errorMessage(err, 'Não foi possível criar a categoria.')),
  })

  const alternar = useMutation({
    mutationFn: (categoria: CourseCategoryDTO) =>
      courseCategoriesApi.update(categoria.id, { active: !categoria.active }),
    onSuccess: invalidate,
    onError: (err) => setErro(errorMessage(err, 'Não foi possível alterar a categoria.')),
  })

  const remover = useMutation({
    mutationFn: (id: string) => courseCategoriesApi.remove(id),
    onSuccess: () => {
      setErro(null)
      invalidate()
    },
    onError: (err) => setErro(errorMessage(err, 'Não foi possível excluir a categoria.')),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (name.trim()) criar.mutate()
  }

  // Só categoria raiz pode ser mãe: a 9.6 pede dois níveis, não uma árvore.
  const raizes = categorias.filter((c) => !c.parentId)

  return (
    <CatalogPanel
      title="Categorias"
      description="Como os cursos são organizados no catálogo. Uma categoria pode ter subcategorias."
      error={erro}
    >
      <form onSubmit={submit} className="flex flex-wrap items-end gap-sm rounded-lg border border-dashed border-outline-variant/50 p-md">
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Ícone</span>
          <input
            value={icon}
            onChange={(event) => setIcon(event.target.value)}
            maxLength={4}
            placeholder="🎯"
            className={`${inputCls} w-16 text-center`}
          />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Nome da categoria</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={COURSE_CATEGORY_NAME_MAX_LENGTH}
            className={inputCls}
          />
        </label>
        <div className="flex min-w-[12rem] flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Categoria raiz (opcional)</span>
          <Select
            ariaLabel="Categoria raiz"
            value={parentId}
            placeholder="— nenhuma —"
            options={raizes.map((c) => ({ value: c.id, label: c.name }))}
            onChange={setParentId}
          />
        </div>
        <button
          type="submit"
          disabled={!name.trim() || criar.isPending}
          className="rounded-md bg-primary px-lg py-2 font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Adicionar
        </button>
      </form>

      <ul className="flex flex-col gap-sm">
        {categorias.map((categoria) => (
          <CatalogRow
            key={categoria.id}
            icon={categoria.icon}
            title={categoria.name}
            support={categoria.parentName ? `em ${categoria.parentName}` : undefined}
            courseCount={categoria.courseCount}
            active={categoria.active}
            onToggleActive={() => alternar.mutate(categoria)}
            onRemove={() => remover.mutate(categoria.id)}
          />
        ))}
        {categorias.length === 0 && (
          <li className="text-body-sm text-on-surface-variant">Nenhuma categoria cadastrada.</li>
        )}
      </ul>
    </CatalogPanel>
  )
}

// --- Competências ------------------------------------------------------------

export function CompetenciesTab() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [description, setDescription] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const { data } = useQuery({ queryKey: COMPETENCIES_KEY, queryFn: competenciesApi.list })
  const competencias = data?.competencies ?? []
  const invalidate = () => qc.invalidateQueries({ queryKey: COMPETENCIES_KEY })

  const criar = useMutation({
    mutationFn: () =>
      competenciesApi.create({
        name: name.trim(),
        icon: icon.trim() || null,
        description: description.trim() || null,
      }),
    onSuccess: () => {
      setName('')
      setIcon('')
      setDescription('')
      setErro(null)
      invalidate()
    },
    onError: (err) => setErro(errorMessage(err, 'Não foi possível criar a competência.')),
  })

  const alternar = useMutation({
    mutationFn: (item: CompetencyDTO) => competenciesApi.update(item.id, { active: !item.active }),
    onSuccess: invalidate,
    onError: (err) => setErro(errorMessage(err, 'Não foi possível alterar a competência.')),
  })

  const remover = useMutation({
    mutationFn: (id: string) => competenciesApi.remove(id),
    onSuccess: () => {
      setErro(null)
      invalidate()
    },
    onError: (err) => setErro(errorMessage(err, 'Não foi possível excluir a competência.')),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (name.trim()) criar.mutate()
  }

  return (
    <CatalogPanel
      title="Competências"
      description="O que um curso desenvolve. É por aqui que o PDI recomenda curso."
      error={erro}
    >
      <form onSubmit={submit} className="flex flex-wrap items-end gap-sm rounded-lg border border-dashed border-outline-variant/50 p-md">
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Ícone</span>
          <input
            value={icon}
            onChange={(event) => setIcon(event.target.value)}
            maxLength={4}
            placeholder="🤖"
            className={`${inputCls} w-16 text-center`}
          />
        </label>
        <label className="flex min-w-[10rem] flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Nome</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={COMPETENCY_NAME_MAX_LENGTH}
            className={inputCls}
          />
        </label>
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Descrição curta</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={COMPETENCY_DESCRIPTION_MAX_LENGTH}
            className={inputCls}
          />
        </label>
        <button
          type="submit"
          disabled={!name.trim() || criar.isPending}
          className="rounded-md bg-primary px-lg py-2 font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Adicionar
        </button>
      </form>

      <ul className="flex flex-col gap-sm">
        {competencias.map((item) => (
          <CatalogRow
            key={item.id}
            icon={item.icon}
            title={item.name}
            support={item.description}
            courseCount={item.courseCount}
            active={item.active}
            onToggleActive={() => alternar.mutate(item)}
            onRemove={() => remover.mutate(item.id)}
          />
        ))}
        {competencias.length === 0 && (
          <li className="text-body-sm text-on-surface-variant">Nenhuma competência cadastrada.</li>
        )}
      </ul>
    </CatalogPanel>
  )
}

// --- Instrutores -------------------------------------------------------------

export function InstructorsTab() {
  const qc = useQueryClient()
  const [interno, setInterno] = useState(true)
  const [userId, setUserId] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [bio, setBio] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const { data } = useQuery({ queryKey: INSTRUCTORS_KEY, queryFn: instructorsApi.list })
  const instrutores = data?.instructors ?? []
  const invalidate = () => qc.invalidateQueries({ queryKey: INSTRUCTORS_KEY })

  // A base de colaboradores é a fonte do instrutor interno (seção 9.7).
  const { data: pessoas } = useQuery({
    queryKey: ['admin', 'users-for-instructors'],
    queryFn: () => apiFetch<{ users: PublicUser[] }>('/users'),
    enabled: interno,
  })
  const jaInstrutores = new Set(instrutores.map((i) => i.userId).filter(Boolean))
  const disponiveis = (pessoas?.users ?? []).filter((u) => !jaInstrutores.has(u.id))

  const criar = useMutation({
    mutationFn: () =>
      instructorsApi.create(
        interno
          ? { userId, bio: bio.trim() || null }
          : { name: name.trim(), email: email.trim() || null, bio: bio.trim() || null },
      ),
    onSuccess: () => {
      setUserId('')
      setName('')
      setEmail('')
      setBio('')
      setErro(null)
      invalidate()
    },
    onError: (err) => setErro(errorMessage(err, 'Não foi possível cadastrar o instrutor.')),
  })

  const alternar = useMutation({
    mutationFn: (item: InstructorDTO) => instructorsApi.update(item.id, { active: !item.active }),
    onSuccess: invalidate,
    onError: (err) => setErro(errorMessage(err, 'Não foi possível alterar o instrutor.')),
  })

  const remover = useMutation({
    mutationFn: (id: string) => instructorsApi.remove(id),
    onSuccess: () => {
      setErro(null)
      invalidate()
    },
    onError: (err) => setErro(errorMessage(err, 'Não foi possível excluir o instrutor.')),
  })

  const podeCriar = interno ? Boolean(userId) : name.trim().length > 0

  function submit(event: FormEvent) {
    event.preventDefault()
    if (podeCriar) criar.mutate()
  }

  return (
    <CatalogPanel
      title="Instrutores"
      description="Quem dá o curso. Um treinamento pode ter mais de um."
      error={erro}
    >
      <form onSubmit={submit} className="flex flex-col gap-sm rounded-lg border border-dashed border-outline-variant/50 p-md">
        <div className="flex flex-wrap gap-md">
          <label className="flex items-center gap-xs text-body-md text-on-surface-variant">
            <input type="radio" checked={interno} onChange={() => setInterno(true)} />
            Colaborador da EMR
          </label>
          <label className="flex items-center gap-xs text-body-md text-on-surface-variant">
            <input type="radio" checked={!interno} onChange={() => setInterno(false)} />
            Pessoa externa
          </label>
        </div>

        {interno ? (
          <div className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Colaborador</span>
            <Select
              ariaLabel="Colaborador"
              value={userId}
              placeholder="— escolher —"
              searchable
              options={disponiveis.map((u) => ({ value: u.id, label: u.name }))}
              onChange={setUserId}
            />
            {/* O que a 9.7 pede: nome e área vêm da base, não são redigitados. */}
            <p className="text-body-sm text-on-surface-variant">
              Nome, foto e área vêm do cadastro do colaborador.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-sm">
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Nome</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={INSTRUCTOR_NAME_MAX_LENGTH}
                className={inputCls}
              />
            </label>
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">E-mail (opcional)</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputCls}
              />
            </label>
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Bio (opcional)</span>
          <textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            maxLength={INSTRUCTOR_BIO_MAX_LENGTH}
            rows={2}
            className={inputCls}
          />
        </label>

        <button
          type="submit"
          disabled={!podeCriar || criar.isPending}
          className="w-fit rounded-md bg-primary px-lg py-2 font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Cadastrar instrutor
        </button>
      </form>

      <ul className="flex flex-col gap-sm">
        {instrutores.map((item) => (
          <CatalogRow
            key={item.id}
            icon={item.userId ? '👤' : '🌐'}
            title={item.name}
            support={[item.userId ? item.area : 'Externo', item.email].filter(Boolean).join(' · ')}
            courseCount={item.courseCount}
            active={item.active}
            onToggleActive={() => alternar.mutate(item)}
            onRemove={() => remover.mutate(item.id)}
          />
        ))}
        {instrutores.length === 0 && (
          <li className="text-body-sm text-on-surface-variant">Nenhum instrutor cadastrado.</li>
        )}
      </ul>
    </CatalogPanel>
  )
}
