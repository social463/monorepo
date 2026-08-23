# Visualização de features por setor — corrigir vazamentos entre setores

## Contexto

O repo já tem dois mecanismos de setorização em produção:

- **Toggle de features por setor** (`Sector.enabledFeatures`, `apps/api/prisma/schema.prisma:305`):
  admin liga/desliga por setor quais das `FEATURE_KEYS` (`packages/shared/src/third-party.ts`)
  aparecem para os usuários daquele setor. O JWT carrega `features: string[]` resolvido por setor
  (`apps/api/src/lib/jwt.ts`), e o menu lateral (`apps/web/src/components/nav-items.ts`) já filtra
  os links com base nisso.
- **Isolamento de dados por setor** (`docs/superpowers/specs/2026-07-22-setorizacao-empresa-design.md`):
  votação, categorias/selos e terceirizados já são escopados por `sectorId`.

O que falta — e é o motivador desta spec — é que **várias telas ainda vazam dado/UX entre
setores ou ignoram o toggle de feature**, mesmo quando ele já diz que um setor não deveria ver
aquilo:

1. A Home renderiza a seção de Resenha **sem checar a feature**, então um setor sem `resenha`
   habilitada vê um card de "Erro ao carregar a resenha" (na verdade é um 403 do toggle,
   mal-tratado como erro genérico).
2. `Review` (Resenha) é hoje **100% global**: todo mundo com a feature habilitada vê os posts de
   todos os setores, misturado.
3. **Mural do time** é global **por decisão consciente já documentada** (mesmo spec de
   setorização, addendum), registrada como pendência para "quando existir um segundo setor real"
   — que é agora.
4. **Lista de time** (`GET /users`) lista todo mundo ativo da empresa, sem filtrar por setor —
   diferente de `/users/showcase`, que já é sectorizado.
5. Partes da UI **ligadas à votação** continuam aparecendo mesmo quando a feature `votar` está
   desligada para o setor: o card "Minhas Conquistas" na Home (`MyStatsCard`, 100% sobre selos), e
   na `ProfilePage` o botão "Reconhecer", o painel "Impacto acumulado" (votos recebidos, meses
   reconhecido, contagem de selos), a aba/histórico "Reconhecimentos" (toggle Reconhecimentos ×
   Feedbacks) e "Categorias reconhecidas". Nenhum desses é gated pela feature `votar` hoje.

**Fora de escopo, explicitamente:** Escritório virtual continua global para a empresa toda (decisão
do usuário). Um "Mural da empresa" cross-setor é uma ideia futura — este design não fecha essa
porta, mas também não a implementa agora.

## Arquitetura

Nenhuma migration é necessária. `User.sectorId` já existe (obrigatório, com `@default`, vale para
todo papel incluindo `THIRD_PARTY`) e todo request autenticado já carrega `request.user.sectorId`
(vem do JWT, `apps/api/src/lib/jwt.ts:7`). A sectorização de dados (itens B, C, D abaixo) é feita
**via relation filter no Prisma** — o mesmo padrão que `GET /users/showcase` já usa
(`profile-service.ts`, `sectorId: request.user.sectorId`) — sem precisar de coluna nova em
`Review`, `Feedback`, `UserBadge`, `MoodEntry` ou `ReviewShare`: cada uma dessas tabelas já tem uma
relação para um `User`, e o `User` já tem `sectorId`. O item E (UI de votação) não mexe em dado,
só em visibilidade condicional no frontend a partir de uma flag de feature já resolvida no
backend.

Erros de "não encontrado por causa de outro setor" reusam o erro 404 que os services já lançam para
"não existe" (`ReviewError('Resenha não encontrada.', 404)` etc.) — um id de outro setor deve se
comportar exatamente como um id inexistente, sem vazar que o registro existe em outro setor.

## Componentes

### A. Home — parar de tratar feature desabilitada como erro

- `apps/web/src/pages/HomePage.tsx` hoje renderiza `<ResenhaFeed />` incondicionalmente.
- Vai usar o mesmo dado que `nav-items.ts` já usa para montar o `Set` de features habilitadas
  (`enabledFeatures`/`sectorFeatures` do usuário autenticado, via contexto de auth) e só renderizar
  a seção de Resenha quando `resenha` estiver no set — mesmo critério que já faz o link `/resenha`
  sumir do menu.
- Quando desabilitada: a seção inteira (título + feed) não é renderizada. Não é um estado vazio
  nem uma mensagem — é a mesma UX de "essa feature não existe pra você", igual ao menu.

### B. Resenha (`Review`) sectorizada

Em `apps/api/src/services/review-service.ts`, cada função que hoje recebe `viewerId` passa a
também receber `viewerSectorId` (as rotas em `apps/api/src/routes/review.ts` repassam
`request.user.sectorId`):

- `listFeed`: adiciona `author: { active: true, sectorId: viewerSectorId }` ao `where` do feed.
- `getReviewForViewer`, `deleteReview`, `listComments`, `createComment`, `deleteComment`,
  `toggleReviewReaction`, `toggleCommentReaction`, criação/remoção de share: cada lookup por
  `reviewId`/`commentId` passa a incluir a checagem de que a resenha pertence ao setor de quem
  está agindo (via `author.sectorId` na seleção/where). Se não pertencer, mesmo erro 404 já
  existente ("Resenha não encontrada." / "Comentário não encontrado.") — não um 403 novo, pra não
  diferenciar "não existe" de "existe mas não é seu setor".
- `resolveMentions` (linha ~83): hoje permite mencionar qualquer usuário ativo não-admin. Passa a
  também filtrar por `sectorId` igual ao do autor do post/comentário — não faz sentido permitir
  mencionar alguém que nunca vai poder ver a resenha.

### C. Mural do time sectorizado

Reverte a decisão registrada no addendum de `2026-07-22-setorizacao-empresa-design.md` (mural
global "até existir um 2º setor real"). Em `apps/api/src/services/mural-service.ts`,
`getMuralItems` passa a receber `viewerSectorId` e cada uma das 4 queries em paralelo ganha um
filtro de relação:

- `feedback`: `target: { active: true, sectorId: viewerSectorId }` — quem recebeu o reconhecimento
  precisa ser do mesmo setor de quem está vendo o mural.
- `userBadge`: `user: { active: true, sectorId: viewerSectorId }`.
- `moodEntry`: `user: { active: true, sectorId: viewerSectorId }`.
- `reviewShare`: `review: { author: { active: true, sectorId: viewerSectorId } }` — consistente com
  a resenha já ser sectorizada por autor (item B).

A rota `GET /mural` (`apps/api/src/routes/mural.ts`) passa `request.user.sectorId` para o service.

Registro explícito para o futuro: quando existir um "Mural da empresa" cross-setor, o filtro por
`sectorId` aqui deve virar opcional/parametrizável — não é implementado nesta spec.

### D. Lista de time sectorizada

`GET /users` (`apps/api/src/routes/users.ts`) ganha `sectorId: request.user.sectorId` no `where`
do `prisma.user.findMany`, mesmo padrão que `GET /users/showcase` já usa.

### E. Esconder UI de votação/reconhecimento quando `votar` está desligada

Duas superfícies mostram dado derivado de votação sem checar a feature `votar`. Escopo
explicitamente **não** inclui a Galeria de Selos (`BadgeGallery`) nem o toggle de feature `selos`
— selos têm ciclo de vida próprio (podem ser concedidos manualmente por admin) e continuam
visíveis mesmo com `votar` desligada.

- **Home / `MyStatsCard`**: card inteiro é sobre selos+reconhecimento — usa o `sectorFeatures` do
  próprio usuário autenticado (mesmo dado que `nav-items.ts` já consome) e só renderiza quando
  `votar` está no set. Sem `votar`, o card não aparece (grid da Home vira uma coluna só, sem o
  espaço reservado de 320px).
- **`ProfilePage`**: aqui o critério é o **setor de quem está sendo visto** (o dono do perfil), não
  o do viewer — os dados (votos recebidos, meses reconhecido) pertencem ao setor do perfil, não de
  quem está olhando. Isso exige expor no `ProfileDTO` (`packages/shared/src/profile.ts`) se o
  `votar` está habilitado para o setor do usuário do perfil — ex. `votingEnabled: boolean`,
  resolvido no `profile-service.ts` a partir de `sectorFeaturesFor(user.sectorId)` (já existe em
  `apps/api/src/routes/auth.ts:26-29`, vira uma função exportável reaproveitada aqui). Quando
  `false`:
  - Botão "Reconhecer" (`Link to="/votar"`, linha ~233) não renderiza.
  - Painel "Impacto acumulado" (linha ~246) não renderiza.
  - `profileView` fixa em `"feedbacks"` e o `ViewToggle`/aba "Reconhecimentos" não renderiza (só
    `FeedbackSection` ocupando a largura toda) — sem sentido oferecer uma aba vazia.
  - Bloco "Categorias reconhecidas" (linha ~511) não renderiza (implícito, já é condicionado a
    `profileView === "reconhecimentos"`, que deixa de ser alcançável).
  - Usuários `isLead` já não têm nenhuma dessas seções (líderes não recebem voto) — comportamento
    inalterado.

## Erros e casos de borda

- Usuário tenta agir (comentar/reagir/deletar) num `reviewId`/`commentId` válido mas de outro
  setor: trata como não encontrado (404), igual a um id inexistente.
- Admin/Subadmin: `requireFeature` já ignora o bypass de feature para ADMIN/SUBADMIN
  (`apps/api/src/app.ts:69-77`) — isso não muda aqui. Mas Admin/Subadmin **não** ganham bypass da
  sectorização de dados nesta spec (mural, resenha, lista de time) — eles veem o setor deles como
  qualquer usuário, igual já acontece hoje em `/users/showcase`. Não introduzir um "modo
  todos os setores" para Admin é consciente: manter o escopo pequeno; se for necessário no futuro,
  é uma spec própria.
- Usuário `THIRD_PARTY`: `sectorId` é obrigatório em `User` para todo papel (`schema.prisma:86`,
  `@default`), então terceirizados também têm um setor real e o mesmo filtro se aplica sem caso
  especial.

## Testes

- `review-service.test.ts`: cobrir que `listFeed`, `getReviewForViewer` e as mutações (comment,
  reaction, delete, share) respeitam o setor — usuário de setor B não vê/não consegue agir em
  resenha de setor A (404, não 403).
- `mural-service.test.ts`: cobrir que os 4 tipos de item (feedback, badge, mood, review share) só
  aparecem pra viewer do mesmo setor do protagonista.
- `users.test.ts` (rota): cobrir que `GET /users` só retorna colegas do mesmo setor.
- Frontend: teste de `HomePage` cobrindo que a seção de Resenha não renderiza quando a feature está
  desabilitada para o setor do usuário (hoje não há teste unitário disso — `HomePage.tsx` não tem
  arquivo de teste ao lado; criar um), e que `MyStatsCard` não renderiza sem `votar`.
- `profile-service.test.ts`: cobrir que `ProfileDTO.votingEnabled` reflete `votar` do setor do
  usuário do perfil (não do viewer).
- `ProfilePage.test.tsx`: cobrir que, com `votingEnabled: false`, não renderizam o botão
  "Reconhecer", "Impacto acumulado", o `ViewToggle`/aba Reconhecimentos e "Categorias
  reconhecidas" — mas `BadgeGallery` e `FeedbackSection` continuam.

## Não-objetivos

- Migration de schema (não é necessária).
- Mudança no toggle de feature em si (`Sector.enabledFeatures`, telas de admin) — já funciona.
- Escritório virtual — continua global, fora de escopo.
- "Mural da empresa" cross-setor — ideia futura, não implementada aqui.
- Bypass de Admin/Subadmin para ver todos os setores nas 3 telas — fora de escopo.
- Galeria de Selos (`BadgeGallery`) e a feature `selos` em si — continuam do jeito que estão,
  independentes de `votar`.
