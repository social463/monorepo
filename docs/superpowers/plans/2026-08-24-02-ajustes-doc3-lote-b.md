# Plan — Ajustes do Documento 3, Lote B

Spec: `docs/superpowers/specs/2026-08-24-ajustes-doc3-lote-b-design.md`

O passo 1 é base dos passos 2, 3 e 6 (todos leem a janela resolvida). Os passos
4, 5, 7 e 8 são independentes.

## 1. Janela de período (base de 4.1, 4.2 e 4.6)

- [x] `@legends/shared`: `PEOPLE_ANALYTICS_RANGES` ganha `hoje` e `ano`; tipo novo
      `AnalyticsWindow = { range: PeopleAnalyticsRange | 'custom'; from?: string; to?: string }`.
- [x] `resolveWindow(window, now)` ficou na **API**, não em `@legends/shared`:
      os helpers de data civil de São Paulo vivem em `apps/api/src/lib`. Teto de
      **366 dias** e `AnalyticsWindowError` para `from > to` e para janela sem as
      duas pontas; a rota traduz em 400 com mensagem em português.
- [x] `describeAnalyticsWindow(window, days)` em `@legends/shared`: o texto da
      legenda dinâmica. O `days` vem da janela **efetiva** devolvida pelo
      servidor — a tela não recalcula data nenhuma.
- [x] `apps/api`: `analyticsQuerySchema` aceita `range=custom` + `from`/`to`
      (`YYYY-MM-DD`); `resolveWindow` do `people-analytics-service` passa a
      receber a janela resolvida.
- [x] Componente `PeriodFilter` no web: atalhos (Hoje, 7, 30, 90 dias, Este ano) +
      "Personalizado" com data inicial e final.

## 2. Seção 4.1 — cards e legendas

- [x] `PeopleOverviewDTO`: `uniqueUsers7d`/`uniqueUsers30d` saem; entram
      `uniqueUsersInRange` e `accessesInRange`. `adoptionRate` passa a ser sobre
      a janela.
- [x] `getPeopleOverview` deixa de usar `trailingSince(7|30)` — era isso que
      fazia os cards ignorarem o filtro.
- [x] `OverviewTab`: quatro cards com legendas de `describeAnalyticsWindow`.
- [x] Testes: trocar o range muda os quatro números; a legenda acompanha.

## 3. Seção 4.2 — mapa de calor

- [x] `GET /admin/people/heatmap?range=&from=&to=&sectorId=` → células +
      `avgSessionMinutes`.
- [x] `computeAverageSessionMinutes` no service: acessos ordenados por pessoa,
      corte de sessão em **30 min** de intervalo, duração do primeiro ao último.
- [x] `accessHeatmap` sai do overview (o bloco tem recorte próprio agora).
- [x] `AccessHeatmapCard`: filtros próprios de período e setor, que nascem com o
      valor do cabeçalho; card de tempo médio com a ressalva do piso na legenda.
- [x] Testes: sessões separadas por > 30 min contam como duas; acesso único
      conta zero.

## 4. Seção 4.3 (2ª frase) — feedback por competência

- [x] `PeopleOverviewDTO`: `feedbacksByCategory` e `feedbacksByTag`
      (`DistributionSliceDTO[]`).
- [x] Service: `groupBy` em `FeedbackRecognitionCategory` e em
      `Feedback.customCategory` na janela, respeitando o setor do autor.
- [x] `OverviewTab`: duas barras no bloco "Feedbacks no período", com a legenda
      dizendo que a soma passa do total (um feedback tem N competências).

## 5. Seção 4.4 — Ficha & Perfil tabular

- [x] `CollaboratorsSection`: acordeão por setor → tabela com Nome, Setor, Cargo,
      Líder, Tags e Status. Editar continua expandindo a linha.
- [x] Tags derivadas de `viewerAudienceTags` (`@legends/shared`) — sem campo novo.
- [x] `filterCollaborators`: busca cobre líder; filtros novos de cargo, líder,
      tag e status.
- [x] Importação: `USER_IMPORT_IGNORED_COLUMNS` perde `Situação`/`Desligado em`;
      ação nova `DEACTIVATE` no preview e no commit. **Nunca reativa.**
- [x] Testes: linha "Desligado" desativa e grava `leftAt`; linha "Ativo" sobre
      alguém inativo não reativa; histórico intacto.

## 6. Seção 4.6 — aba Clima

- [x] `GET /admin/mood/overview` aceita `from`/`to`; a aba passa o `PeriodFilter`.
- [x] `MoodCommentDTO` ganha `author: PublicUser`; o comentário de topo de
      `mood-analytics.ts` foi reescrito (ele afirmava o contrário).
- [x] O piso de anonimato **deixou de filtrar o comentário** — ele existia para o
      autor não ser deduzido, e esconder por dedução o que agora vem assinado
      seria incoerente. O piso continua valendo para os agregados.
- [x] Service: consulta nova de comentários de **toda a escala** (a atual é só
      `negativeWhere`), com `include` do autor.
- [x] `MoodOverviewSection`: Caixa 1 "Causas de alerta" (só HARD/LOW) e Caixa 2
      "Comentários" (escala inteira), ambas com avatar e nome. "Motivos
      declarados" continua, abaixo.
- [x] **Copy do colaborador** (`MoodOfDay`): a frase "seu retorno entra no clima
      do time de forma confidencial" sai; o texto passa a dizer que Gente e Gestão
      lê o comentário com o nome.
- [x] Testes: comentário positivo aparece só na Caixa 2; o nome vem nas duas; o
      piso continua suprimindo agregados.

## 7. Seção 4.7 — painel de Engajamento na aba

- [x] `EngagementSection` vira componente sem `<header>` próprio, montado dentro
      da aba Engajamento, visível **só ao ADMIN pleno**.
- [x] Rota `/admin/engajamento` → `Navigate` para `/admin/pessoas?aba=engajamento`;
      item sai do menu.

## 8. Seção 3 — aba Dashboard

- [x] `PeopleOverviewDTO`: `postsPublished` e `engagementSeries`
      (feedbacks + reações + comentários por dia).
- [x] Aba `dashboard` como **primeira** de `TABS`, com os quatro KPIs e os dois
      gráficos.
- [x] `/admin` redireciona para `/admin/pessoas?aba=dashboard` para quem acessa
      People Analytics; quem não tem `gente-gestao` continua no resumo por setor.
- [x] Testes: o SUBADMIN sem o bloco não é redirecionado.

## 9. Fechamento

- [x] `pnpm test` com o Postgres de pé (`LEGENDS_DB_PORT=5442 pnpm db:up`).
      Shared 526/526, web 2518/2519 (a falha é o flake de relógio conhecido do
      `RoomAudioPlayer`, que passa isolado), api verde nos 7 arquivos tocados
      (137 testes). As falhas restantes da suíte completa da API são as de
      sempre: Teams por `TEAMS_NOTIFICATIONS_ENABLED=false` no `.env` local e
      timeouts do `super-admin` sob carga — todas passam isoladas.
- [x] Conferido no app rodando, contra os dados de desenvolvimento:
      `hoje` 3 únicos / 45 acessos, `7d` 24 / 355, personalizado 01–24/08
      38 / 4577 — os quatro cards finalmente acompanham o filtro. Intervalo
      invertido responde 400 com a mensagem em português. Mapa de calor: 948
      sessões, média de 8,3 min. Termômetro: 14 comentários, 4 na caixa de
      alerta, todos com o nome de quem escreveu.

## 10. Fora do escopo entregue

- **CPF na busca (4.4).** `User` não tem o campo, o template de importação não
  tem a coluna, e guardar CPF de todo colaborador é decisão de finalidade e
  retenção — não um `ALTER TABLE`. Registrado como pendência na spec.
- **"Sincronizar planilha" (4.4).** O documento cita três botões; existem dois
  (Exportar CSV e Importar planilha). A importação já é upsert, que é o que
  "sincronizar" descreveria. Confirmar com a G&G.
