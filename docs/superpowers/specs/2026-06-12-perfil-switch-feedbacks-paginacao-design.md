# Switch Reconhecimentos/Feedbacks no perfil DEV + paginação

**Data:** 2026-06-12
**Status:** Aprovado para implementação

## Objetivo

No perfil de desenvolvedor (`/perfil/:id`, role DEV), adicionar um controle
segmentado que alterna a visualização entre **Reconhecimentos** (votos recebidos)
e **Feedbacks**, reutilizando o `FeedbackSection` existente. Adicionar paginação
incremental ("Carregar mais", lotes de 10) nas duas listas — histórico de
reconhecimento e feedbacks — sem que o bloco da galeria de selos cresça junto.

## Contexto atual

- **ProfilePage** (`apps/web/src/pages/ProfilePage.tsx`, rota `/perfil/:id`):
  - `isLead = user.role === 'LEAD'`. Para **DEV** (`!isLead`) renderiza um bento
    de 12 colunas: Galeria de selos (col-span-5) + Histórico de reconhecimento
    (col-span-7) + Categorias reconhecidas (col-span-12). Para **LEAD** renderiza
    Galeria de selos (col-span-5) + `<FeedbackSection targetId={user.id} />`
    (col-span-7). A galeria de selos está **duplicada** entre os dois branches.
  - Hero com "Resumo de impacto" (votos/meses/selos) e botão "Reconhecer" só para
    `!isLead`.
- **Reconhecimentos = votos recebidos.** `GET /users/:id/votes?month=&categorySlug=`
  → `{ votes: VoteDTO[] }` (sem paginação). Service `listVotesReceived(userId, { month, categorySlug })`
  (`apps/api/src/services/profile-service.ts:104`).
- **Feedbacks.** Sistema completo já existe: `GET /users/:id/feedbacks` →
  `{ feedbacks: FeedbackDTO[] }` (sem paginação); POST/PATCH/DELETE; `FeedbackSection`
  (`apps/web/src/pages/profile/FeedbackSection.tsx`) cuida de listar/criar/editar/
  excluir e das permissões (`canWrite = !ADMIN && !self`). Hoje só aparece em
  perfis LEAD.
- Testes existentes: `apps/web/src/pages/ProfilePage.test.tsx`,
  `apps/web/src/pages/profile/FeedbackSection.test.tsx`, e testes de rota da API.

## Decisões (do brainstorming)

1. **Escopo:** switch só em perfis **DEV**. LEAD/ADMIN inalterados.
2. **Layout de Feedbacks:** Galeria de selos (5) + `FeedbackSection` (7) — igual ao
   layout de LEAD.
3. **Switch:** controle segmentado (2 pills "Reconhecimentos | Feedbacks").
4. **Paginação:** "Carregar mais" incremental, 10 por vez, nas duas listas.
5. **Selos não cresce junto:** grids com `items-start`.

## Front-end (ProfilePage)

- Novo estado `const [profileView, setProfileView] = useState<'reconhecimentos' | 'feedbacks'>('reconhecimentos')`.
- **Controle segmentado** (componente local enxuto no `ProfilePage.tsx`, 2 botões
  `type="button"` com `aria-pressed`): pill ativo `bg-primary text-on-primary`,
  inativo `text-on-surface-variant hover:text-on-surface`; só renderizado para DEV,
  acima do bento.
- **Extrair `BadgeGallery`** → `apps/web/src/pages/profile/BadgeGallery.tsx`
  (props: `badges: AwardedBadgeDTO[]`, `emptyLabel: string`, `className?: string`).
  Usado nos 3 lugares (DEV-reconhecimentos, DEV-feedbacks, LEAD), removendo a
  duplicação atual. Empty-label: "Nenhum selo conquistado ainda." (DEV) e
  "Nenhum selo atribuído ainda." (LEAD).
- **Bloco DEV** passa a:
  ```
  {!isLead && (
    <>
      <SegmentedControl value={profileView} onChange={setProfileView} />
      <div className="grid grid-cols-12 items-start gap-lg">
        <BadgeGallery badges={badges} emptyLabel="Nenhum selo conquistado ainda." className="lg:col-span-5" />
        {profileView === 'reconhecimentos'
          ? <RecognitionHistory … className="lg:col-span-7" />
          : <FeedbackSection targetId={user.id} />}
        {profileView === 'reconhecimentos' && <CategoryBreakdown … className="col-span-12" />}
      </div>
    </>
  )}
  ```
  (O "Histórico de reconhecimento" e "Categorias reconhecidas" continuam com o
  mesmo markup; podem permanecer inline no ProfilePage.)
- **Bloco LEAD** passa a usar `<BadgeGallery emptyLabel="Nenhum selo atribuído ainda." />`
  + `<FeedbackSection />`, com `items-start` no grid.
- O "Resumo de impacto" e o botão "Reconhecer" do hero permanecem visíveis em
  ambos os modos (governados por `!isLead`, não pelo switch).

## Paginação — API

Ambos os endpoints ganham `offset` e `limit` (defaults `0` e `10`; `limit` limitado
a no máximo `50`), preservando os params atuais. `hasMore` é detectado buscando
`take: limit + 1` e cortando o excedente (sem query de count).

- `GET /users/:id/votes?month=&categorySlug=&offset=&limit=` →
  `{ votes: VoteDTO[], hasMore: boolean }`.
  - `listVotesReceived(userId, { month, categorySlug, offset, limit })` usa
    `skip: offset, take: limit + 1`, retorna `{ rows, hasMore }` (ou a rota faz o
    corte). `orderBy: createdAt desc` mantido.
- `GET /users/:id/feedbacks?offset=&limit=` →
  `{ feedbacks: FeedbackDTO[], hasMore: boolean }`.
  - `listFeedbacksForUser(targetId, { offset, limit })` com `skip`/`take: limit + 1`.

As chaves `votes`/`feedbacks` permanecem; `hasMore` é aditivo (não quebra
consumidores).

## Paginação — Web

- **Histórico de reconhecimento (ProfilePage):** trocar o `useQuery` de votos por
  `useInfiniteQuery`:
  - `queryKey: ['profile-votes', id, categorySlug, month]`;
  - `queryFn: ({ pageParam }) => apiFetch(`/users/${id}/votes?…&offset=${pageParam}&limit=10`)`;
  - `initialPageParam: 0`;
  - `getNextPageParam: (lastPage, allPages) => lastPage.hasMore ? allPages.reduce((n, p) => n + p.votes.length, 0) : undefined`;
  - lista = `data.pages.flatMap(p => p.votes)`. Trocar mês/categoria reinicia
    (faz parte da key).
- **FeedbackSection:** migrar de `useQuery` para `useInfiniteQuery` no mesmo
  padrão (`queryKey: ['feedbacks', targetId]`, offset/limit 10, `getNextPageParam`
  análogo somando `p.feedbacks.length`). A lista = `data.pages.flatMap(p => p.feedbacks)`.
  As mutations de criar/editar/excluir continuam invalidando `['feedbacks', targetId]`
  (o React Query refaz as páginas já carregadas).
- **Botão "Carregar mais":** ao fim de cada lista, um botão centralizado no padrão
  do tema que chama `fetchNextPage`; renderizado só quando `hasNextPage`; desabilita
  durante `isFetchingNextPage` (texto "Carregando…"). Aplicado às duas listas.

## Tratamento de erros

Inalterado: estados de erro/empty já existentes nas listas e no `FeedbackSection`
permanecem. `limit` inválido/fora do intervalo é normalizado (default 10, teto 50)
no back-end.

## Testes

- **API (`apps/api/src/routes/profile.test.ts` e `feedback.test.ts`, ou onde estiverem):**
  - `/users/:id/votes`: com `limit=2` retorna 2 itens e `hasMore: true` quando há
    mais; última página `hasMore: false`; `offset` pula corretamente; filtros
    (month/category) continuam funcionando com paginação.
  - `/users/:id/feedbacks`: mesmos casos de offset/limit/hasMore.
- **`ProfilePage.test.tsx`:**
  - Perfil DEV: o controle segmentado aparece; default mostra "Histórico de
    reconhecimento"; clicar "Feedbacks" mostra a seção de feedbacks e esconde o
    histórico; clicar "Reconhecimentos" volta.
  - Perfil LEAD: o controle segmentado **não** aparece.
  - "Carregar mais" nos reconhecimentos: com mock retornando `hasMore: true`, o
    botão aparece e ao clicar anexa o próximo lote; some quando `hasMore: false`.
  - Ajustar mocks de `apiFetch` para a nova forma `{ votes, hasMore }` e o
    offset/limit.
- **`FeedbackSection.test.tsx`:** ajustar mocks para `{ feedbacks, hasMore }`;
  adicionar caso de "Carregar mais"; manter os testes de criar/editar/excluir
  passando (agora lendo de `data.pages`).

## Fora de escopo (YAGNI)

- Paginação por páginas numeradas (escolhido "Carregar mais").
- Paginação/contagem total exposta na UI (só "Carregar mais"/`hasMore`).
- Mudar quem pode dar/ver feedback (reusa as regras atuais do `FeedbackSection`).
- Cursor-based pagination (offset basta para o volume esperado).
- Tornar o switch disponível para LEAD/ADMIN.
