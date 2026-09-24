# Plan — Ajustes do Documento 3, Lote A

Spec: `docs/superpowers/specs/2026-08-24-ajustes-doc3-lote-a-design.md`

Ordem de execução: os passos 1 a 5 são independentes entre si; o 6 depende da
decisão de schema registrada na spec.

## 1. Seção 4.3 — remover "Adesão da votação"

- [x] `packages/shared/src/people-analytics.ts`: remover `VotingAdoptionDTO` e o
      campo `votingAdoption` de `PeopleOverviewDTO`.
- [x] `apps/api/src/services/people-analytics-service.ts`: remover
      `loadVotingAdoption` e a entrada dele no `Promise.all` do overview.
- [x] `apps/web/src/pages/admin/PeopleAnalyticsSection.tsx`: remover o
      `ChartCard` "Adesão da votação"; "Feedbacks no período" passa a ocupar a
      faixa inteira.
- [x] Testes: limpar as asserções de `votingAdoption` em
      `people-analytics-service.test.ts` e `PeopleAnalyticsSection.test.tsx`.

## 2. Seção 6 (+ 4.5 parcial) — termômetro único

- [x] `PeopleAnalyticsSection.tsx`: `TABS` passa a ser
      `overview | profile | clima | engajamento`; a aba ativa vai para a URL
      (`?aba=`), no mesmo padrão de `LearningPage`.
- [x] Aba **Clima** renderiza `<MoodOverviewSection />`.
- [x] Aba **Engajamento** fica com o que sobra do `EngagementTab`: "Alcance do
      Feed Corporativo" e "Telas mais acessadas". O resumo de clima (humor médio,
      participantes, tendência, distribuição) sai — `MoodOverviewSection` já cobre.
- [x] `apps/web/src/components/admin-nav-items.ts`: remover
      `/admin/clima` do grupo Comunidade.
- [x] `apps/web/src/App.tsx`: a rota `admin/clima` vira
      `<Navigate to="/admin/pessoas?aba=clima" replace />`.
- [x] Testes: `PeopleAnalyticsSection.test.tsx` cobre as quatro abas e o `?aba=`;
      `admin-nav-items.test.ts` deixa de esperar o item de menu.

## 3. Seção 7 — Kit Visual com vários arquivos

- [x] `apps/web/src/pages/admin/culture/PersonalAssetsSection.tsx`:
      `FormState.storageKey` vira uma lista de arquivos enviados
      (`{ storageKey, fileName, fileSize, kind }[]`); o `<input type="file">`
      ganha `multiple`.
- [x] Upload sequencial por arquivo (`uploadPersonalAsset`), com progresso
      "enviando N de M" e lista dos que falharam — falha de um não aborta os demais.
- [x] Submit dispara um `POST /admin/culture/personal-assets` por arquivo, todos
      com o mesmo destinatário, título e descrição.
- [x] Trocar o destinatário continua descartando os arquivos já enviados (a chave
      no S3 nasce na pasta de quem recebe).
- [x] Teste novo `PersonalAssetsSection.test.tsx`: dois arquivos → dois POSTs;
      um upload falhando → o outro ainda é gravado e o erro aparece.

## 4. Seções 9.1 e 9.2 — cards da Home

- [x] `BirthdaysCard.tsx` e `WorkAnniversariesCard.tsx`: `upcoming.slice(0, 3)`
      no cliente. **Não** mexer em `nearestThreeDates` do `celebration-service` —
      `/aniversariantes` e `use-birthday-confetti` leem o mesmo `upcoming`.
- [x] `CelebrationTile.tsx`: segunda ação `celebration` ao lado do coração, com
      `onCongratulate?: (user: PublicUser) => void`; a linha `highlighted` ganha
      bolo e balões animados.
- [x] Componente novo `CongratsDialog.tsx`: diálogo sobre o
      `FeedbackComposer` já existente, com o destinatário fixo.
- [x] `MonthVacationsCard.tsx`: `PREVIEW` 4 → 3, avatar 40px → 32px, nome e
      período na mesma linha, "Ausente" vira ponto com `title`.
- [x] `TopEngagementCard.tsx`: linha compacta (avatar 32px, setor no mesmo
      parágrafo da posição). O limite continua `RANKING_TOP_LIMIT`.
- [x] Testes: `HomePage.test.tsx` (no máximo 3 por bloco de celebração), teste do
      diálogo de parabéns.

## 5. Seção 12 — link de envio de certificados

- [x] `apps/web/src/pages/learning/LearningPage.tsx`: bloco fixo no topo da
      `CertificatesTab` com o link do Notion, `target="_blank"` e
      `rel="noopener noreferrer"`, visível também no estado vazio.
- [x] Teste em `LearningPage.test.tsx`: o link aparece com a lista vazia.

## 6. Seção 9.3 — limite de 3 e marcação "Novo"

Decisão 1 da spec fechada: **por aba, coluna em `User`**.

- [x] `packages/shared/src/feedback.ts`: `FEEDBACK_WALL_PREVIEW_SIZE` 2 → 3.
- [x] `packages/shared/src/corporate-mural.ts`: DTO do post ganha
      `viewerRead: boolean`.
- [x] `corporate-mural-service.ts`: `corporatePostInclude` virou **função**
      `corporatePostInclude(viewerId)` — `reads` precisa do `where` por viewer,
      senão uma página do feed traria todos os leitores de todos os comunicados
      para responder um booleano. `viewerRead` sai de `post.reads.length > 0`.
- [x] Migration `20260824120000_mural_feedbacks_visto_em`:
      `User.feedbackWallSeenAt DateTime?` (nullable — quem nunca abriu vê tudo
      como novo, que é o comportamento correto).
- [x] Rota `POST /feedbacks/mural/seen`, chamada ao abrir `/mural-feedbacks`
      (`useMarkFeedbackWallSeen`).
- [x] **`wallSeenAt` na resposta, e não `isNew` por item.** "Novo" é relação
      entre feedback e leitor, não propriedade do feedback: com campo por item,
      `toSharedFeedbackDTO` — que também serve Recebidos e Enviados, onde a
      marcação não existe — teria de mentir um `false`.
- [x] `CorporateFeedPreview.tsx` e `FeedbackWallSection.tsx`: selo "Novo" —
      retângulo verde no canto superior direito do item.
- [x] Testes: post não lido marcado / post lido sem marca; feedback publicado
      depois do `seenAt` marcado.

## 7. Fechamento

- [x] `pnpm test` com o Postgres de pé (`LEGENDS_DB_PORT=5442 pnpm db:up`).
      Shared 526/526, web 2510/2510, api 2879/2885 — as 6 falhas restantes são
      `notification-service`/`nudges` por `TEAMS_NOTIFICATIONS_ENABLED=false` no
      `.env` local; passam com a variável ligada e são anteriores a este lote.
- [ ] Atualizar o checklist da seção 14 do documento da G&G. **Não feito**: o
      documento é o original da G&G, em `~/Downloads` — quem marca o andamento
      lá é o time, não este repositório. Os itens entregues estão listados na
      seção 8 abaixo.

## 8. Itens do checklist da G&G (seção 14) que este lote fecha

`4.3` remover "Adesão da votação" · `4.5` separar Clima e Engajamento ·
`6` remover a duplicidade do Termômetro · `7` upload múltiplo no Kit Visual ·
`9.1` limitar a 3 aniversariantes, parabéns pelo bloco, animação do dia ·
`9.2` blocagem compacta de Férias e Ranking · `9.3` limitar a 3 comunicados e 3
feedbacks, marcação "Novo" · `12` link do Notion para envio de certificados.

## 9. O que este lote NÃO cobre (para o Lote B)

- **4.5/4.6/4.7 só em parte.** As abas Clima e Engajamento existem, e a aba
  Clima já traz o card fixo "Distribuição de hoje" (o `MoodOverviewSection` já o
  tinha). Continuam pendentes: filtro de período personalizável (4.6),
  comentários do termômetro identificados (4.6) e mover `/admin/engajamento`
  para dentro da aba (4.7).
- **4.3, segunda frase.** "Analisar feedbacks por tags e competências" é análise
  nova, não remoção — foi deslocada para o Lote B.
- **Achado para o Lote D (4.8).** O subtítulo "Não há telemetria de visualização
  por post", no painel de Engajamento, está **desatualizado**: `CorporatePostRead`
  e `getPostReach` existem. A taxa de leitura da seção 4.8 tem base de cálculo —
  o que falta é o painel, não o dado.
