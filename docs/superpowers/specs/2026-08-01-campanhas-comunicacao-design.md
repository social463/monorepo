# Campanhas de comunicação com IA — design

**Data:** 2026-08-01
**Origem:** portal EMR — `/app/admin/campanhas`
(`src/routes/app.admin.campanhas.tsx` + `src/lib/campaigns.functions.ts`)

## Problema

No Legends, comunicar é escrever um post por vez, na hora. Não existe
planejamento editorial: nem calendário, nem rascunho, nem agendamento, nem
responsável. Uma campanha de duas semanas hoje é alguém com um lembrete no
celular — e o que não foi lembrado, não foi comunicado.

No portal EMR a mesma dor já tem resposta: o time informa tema, janela de datas,
público e quantidade; a IA devolve N comunicados em preview editável; ao
confirmar, viram postagens agendadas num calendário editorial com responsável e
status. É esse fluxo que esta feature traz para o Legends.

## Escopo

Cinco etapas, nesta ordem:

1. **Gerar** — tema + janela + público + quantidade → N rascunhos propostos pela IA.
2. **Revisar** — preview editável. Nada é gravado antes da confirmação humana.
3. **Agendar** — ao confirmar, cada rascunho vira item de calendário com
   data/hora, responsável e status.
4. **Calendário editorial** — visão de mês, edição, reagendamento, cancelamento.
5. **Publicar** — o item vira post do Mural da empresa, com o vínculo registrado.

## Audiência e acesso

O “líder de Gente e Gestão” do portal EMR corresponde, no Legends, ao **SUBADMIN
do setor com a feature `gente-gestao`** — mais o **ADMIN global**, que entra
sempre.

As rotas usam `app.requireSectorFeature('gente-gestao')`, igual às outras oito
telas do bloco (People Analytics, Painéis de RH, Cursos, Termômetro, Manifesto,
Manuais, Benefícios, Benchmarking). O brief original pedia
`requireAdminOrSubadmin` com corte por `sectorId` dentro do service; foi
descartado porque `requireAdminOrSubadmin` libera SUBADMIN de **qualquer** setor
— inclusive o de Desenvolvimento de Produto —, exatamente o que o `AGENTS.md`
manda evitar em bloco de setor.

Consequência direta: **`Campaign` e `CampaignPost` não têm `sectorId`.** Campanha
é comunicação interna da empresa inteira, e quem alcança a tela já está filtrado
pelo guard. Sem `sectorId` não há filtro de setor no service, não há calendário
fatiado por time, e a “visão única do mês” continua sendo única.

No front, `AdminSectorFeatureOnly` + item no `AdminSidebar` com
`featureKey: 'gente-gestao'`.

## Decisão 1 — chave Gemini por empresa, sem fallback de ambiente

A geração usa `resolveGeminiCredentials(companyId)` do `ai-settings-service`, a
mesma credencial BYO cifrada em `AppSetting` que alimenta o agente de
Benchmarking. **Não** usa a `GEMINI_API_KEY` do ambiente.

O brief pedia `lib/gemini-client.ts` (env). Foi descartado pelo motivo que o
`AGENTS.md` já registra: a chave de ambiente é da EMR, e se as features de IA
caíssem nela, todo tenant sem chave própria gastaria a cota da EMR em silêncio —
o custo de um cliente apareceria na fatura de outro. A `GEMINI_API_KEY` segue
servindo **apenas** ao card do Destaque do Mês.

Sem chave cadastrada, `resolveGeminiCredentials` lança `AgentError` 503 com
mensagem tratada em português. É a degradação exigida: a aba **Gerar** mostra um
estado explicativo com link para Administração › Inteligência Artificial, e o
resto da tela — calendário, edição, criar item na mão — continua funcionando. A
IA é acelerador, não dependência.

## Decisão 2 — o corpo do comunicado cabe em 280 caracteres desde a geração

`CORPORATE_POST_MAX_LENGTH` é **280**. Um item agendado cujo corpo passe disso
nunca conseguiria virar post do Mural: ficaria eternamente `SCHEDULED`,
recusado na publicação, e o usuário só descobriria no fim do fluxo.

Então o limite entra desde a origem: `CAMPAIGN_BODY_MAX_LENGTH` é reexportado de
`CORPORATE_POST_MAX_LENGTH` (com o comentário do porquê), o prompt informa o
limite ao modelo, o parser Zod recusa rascunho acima dele, e o campo da tela
mostra contador. O `title` (≤ 120) é rótulo editorial do calendário e **não**
entra no conteúdo do post — `CorporatePost` só tem `content`, e concatenar
título + corpo faria os 280 caracteres estourarem por um motivo invisível.

## Decisão 3 — as datas são calculadas pelo service, não pela IA

Pedir ao modelo que distribua N datas numa janela produz colisão, item fora do
intervalo e formato instável. O service calcula a **grade de datas** — N pontos
igualmente espaçados entre `startsAt` e `endsAt`, às **09:00 no fuso de São
Paulo** (`lib/sao-paulo-date.ts`) — e o prompt recebe as datas já prontas,
pedindo ao modelo apenas o texto de cada uma. Quando N passa do número de dias da
janela, mais de um item cai no mesmo dia, em horários distintos (09:00, 11:00,
14:00, 16:00); o calendário mostra os dois no mesmo quadrado, ordenados por hora.

O modelo **não devolve data alguma**: ele recebe as datas como contexto (para
adequar o texto ao dia) e responde só com título, corpo e sugestão visual, na
mesma ordem. O parser atribui `scheduledFor` a partir da grade, por posição.

Com isso, o critério “todos os rascunhos dentro da janela informada” é garantido
por construção — não há caminho pelo qual uma data do modelo chegue ao banco. A
validação de janela vira teste de `buildScheduleSlots`, não do parser.

Quando a quantidade pedida não cabe na janela (mais de 4 itens por dia, os
horários 09:00, 11:00, 14:00 e 16:00), o service recusa com 400 pedindo para
reduzir a quantidade ou ampliar a janela. É preferível a empilhar comunicados no
mesmo horário.

## Decisão 4 — preview não grava, e o confirm grava o que está na tela

`POST /admin/campaigns/preview` é puramente de leitura: gera e devolve. Nenhuma
linha em `Campaign` ou `CampaignPost`.

`POST /admin/campaigns` recebe os rascunhos **como o usuário os deixou** — o
service não regenera nem reaproveita o texto original. É essa escolha que faz a
edição feita no preview sobreviver até o item agendado; qualquer desenho em que
o confirm só recebesse um `previewId` perderia a edição ou exigiria gravar o
preview, contrariando o requisito.

Se a IA devolver JSON fora do schema, o parser lança `CampaignError` 400 com
mensagem em português. Como nada foi gravado nessa etapa, não existe item pela
metade no banco — a propriedade vem do desenho, não de um `try/catch`.

## Decisão 5 — público gravado, entrega não segmentada, aviso explícito

`audience` (`ALL` | `LEADERSHIP`) entra no prompt e é gravado no item: é dado
editorial legítimo (“este comunicado é para a liderança”) e muda o texto que a IA
produz.

Mas o Mural **não segmenta** — `CorporatePost` não tem alcance por público, e
todo post é visto por todos. Um item com público Liderança, ao ser publicado, vai
para a empresa inteira. A tela diz isso com todas as letras num aviso acima do
botão de confirmar. Segmentar o Mural de verdade mexeria em model, feed, contagem
de leitura e testes do mural — é outra feature, não esta.

## Decisão 6 — canais registrados, entrega só no Mural

`channel` guarda `MURAL`, `TEAMS` ou `EMAIL`, mas só `MURAL` publica.

- **Teams**: `lib/teams-client.ts` existe, mas o webhook do Legends é **por
  usuário** (`User.teamsWebhookUrl`, usado em nudge individual). Não há webhook
  de canal de empresa — logo não há para onde mandar um comunicado corporativo.
- **E-mail**: não existe no Legends.

Os dois ficam gravados no dado e a tela deixa claro que a entrega desses canais é
manual. Nada promete envio que não acontece.

## Modelo de dados

```prisma
enum CampaignAudience   { ALL LEADERSHIP }
enum CampaignChannel    { MURAL TEAMS EMAIL }
enum CampaignPostStatus { SCHEDULED PUBLISHED CANCELLED }

model Campaign {
  id          String           @id @default(cuid())
  theme       String
  startsAt    DateTime
  endsAt      DateTime
  audience    CampaignAudience
  notes       String?
  createdById String
  companyId   String           @default("company-emr")
  createdAt   DateTime         @default(now())

  createdBy User           @relation(fields: [createdById], references: [id], onDelete: Cascade)
  company   Company        @relation(fields: [companyId], references: [id])
  posts     CampaignPost[]

  @@index([companyId, createdAt])
}

model CampaignPost {
  id              String             @id @default(cuid())
  campaignId      String?
  title           String
  body            String
  visualHint      String?
  scheduledFor    DateTime
  channel         CampaignChannel
  audience        CampaignAudience
  status          CampaignPostStatus @default(SCHEDULED)
  responsibleId   String?
  publishedPostId String?            @unique
  publishedAt     DateTime?
  companyId       String             @default("company-emr")
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt

  campaign      Campaign?      @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  responsible   User?          @relation(fields: [responsibleId], references: [id], onDelete: SetNull)
  publishedPost CorporatePost? @relation(fields: [publishedPostId], references: [id], onDelete: SetNull)
  company       Company        @relation(fields: [companyId], references: [id])

  @@index([companyId, scheduledFor])
  @@index([companyId, status])
}
```

Dois pontos deliberados:

- **`campaignId` é opcional.** É o que permite criar item na mão quando a IA está
  indisponível. Se o item exigisse campanha, a degradação sem chave de IA seria
  falsa: o calendário viraria somente-leitura.
- **`publishedPostId` é `SetNull`.** Apagar um post do Mural não pode derrubar o
  histórico editorial; o item continua `PUBLISHED`, apenas sem o vínculo.

Ambos os models entram em `TENANT_SCOPED_MODELS` (`lib/tenant-scope.ts`) e toda
leitura/escrita passa por `scopedPrisma(companyId)`. Migration nova via
`pnpm db:migrate`.

## Contrato — `packages/shared/src/campaign.ts`

Exportado no barril `index.ts`:

- `CAMPAIGN_QUANTITY_MIN = 1`, `CAMPAIGN_QUANTITY_MAX = 20`
- `CAMPAIGN_TITLE_MAX_LENGTH = 120`
- `CAMPAIGN_BODY_MAX_LENGTH = CORPORATE_POST_MAX_LENGTH` (280)
- `CAMPAIGN_THEME_MAX_LENGTH`, `CAMPAIGN_NOTES_MAX_LENGTH`
- `CAMPAIGN_AUDIENCES`, `CAMPAIGN_CHANNELS`, `CAMPAIGN_POST_STATUSES` — `as const`
  + tipo union derivado, no estilo de `challenge.ts`
- `GenerateCampaignRequest`, `CampaignDraftDTO`, `CampaignPostDTO`,
  `ConfirmCampaignRequest`, `CreateCampaignPostRequest`,
  `UpdateCampaignPostRequest`

## Backend — `apps/api`

**`lib/campaign-schedule.ts`** (puro) — `buildScheduleSlots({ startsAt, endsAt,
quantity })` devolve a grade de `Date` da Decisão 3.

**`lib/campaign-prompt.ts`** (puro, testável sem rede)
`buildCampaignPrompt(input)` monta o prompt a partir de tema, público, nome da
empresa e a grade de datas já calculada. `parseCampaignDrafts(raw, slots)` valida
com Zod: array de exatamente `slots.length` itens, cada um com `title`, `body`
dentro do limite e `visualHint`; a data sai da grade. Segue o padrão de
`buildCongratsPrompt` / `buildBenchmarkSystemPrompt` — prompt separado da chamada.

**Chamada ao provedor** — reusa `requestAgentCompletion`
(`lib/gemini-agent-client.ts`), que já traz timeout de 55s e tradução de falha do
provedor em `AgentError` com mensagem em português. O service recebe a função por
parâmetro (`AgentCompletionFn`), como o `agent-service`, para o teste injetar um
duplo sem rede nem chave.

**`lib/campaign-error.ts`** — `CampaignError` (classe tipada com `status`, padrão
`VoteError`/`AgentError`). Mora em `lib/` porque tanto o parser quanto o service
o lançam.

**`services/campaign-service.ts`** — regra de negócio: grade de datas, geração do
preview, confirmação transacional, edição, publicação, cancelamento. Erros de
domínio em `CampaignError` (classe tipada com `status`, padrão `VoteError`).
Toda mutação grava `recordAuditLog` dentro da mesma transação.

**`routes/campaigns.ts`** — rotas finas, Zod `safeParse` → `400 { message, issues }`,
serialização em `lib/serialize.ts`. Todas sob
`onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')]`.

| Rota | Efeito |
|---|---|
| `POST /admin/campaigns/preview` | gera N rascunhos; não grava nada |
| `POST /admin/campaigns` | confirma: `Campaign` + N `CampaignPost` numa transação |
| `POST /admin/campaigns/posts` | cria item na mão, sem IA |
| `GET /admin/campaigns/posts?from&to` | itens da janela, para o calendário |
| `PATCH /admin/campaigns/posts/:id` | editar, reagendar, trocar responsável |
| `POST /admin/campaigns/posts/:id/publish` | cria o `CorporatePost` e liga `publishedPostId` |
| `DELETE /admin/campaigns/posts/:id` | cancela (status `CANCELLED`; não apaga) |

`endsAt < startsAt` é recusado no Zod com `.refine` e mensagem em português.
Cancelar nunca cria post.

Publicar reusa `createPost` do `corporate-mural-service`, que ganha um parâmetro
opcional `tx`. É a única mudança em código existente: sem ela, o post nasceria
fora da transação que marca o item como publicado, e uma falha no meio deixaria
post no Mural com item ainda `SCHEDULED` — a próxima tentativa duplicaria o
comunicado. Publicar um item já publicado ou cancelado é 409.

## Frontend — `apps/web`

`src/pages/admin/CampaignsSection.tsx`, rota `/admin/campanhas` aninhada sob
`/admin` no `App.tsx`, item no `AdminSidebar` dentro do bloco Gente e Gestão.
Dados via React Query + `apiFetch`.

**Aba Calendário** (padrão) — grade de mês com navegação anterior/próximo. Cada
dia lista seus itens em pílulas coloridas por status (Agendado / Publicado /
Cancelado). Clicar abre painel lateral com edição inline (título, corpo com
contador até 280, data/hora, responsável, canal) e as ações Publicar agora e
Cancelar. Botão “Novo item” cria na mão. Chave de query
`['campaign-posts', ano, mês]`, invalidada a cada mutação.

**Aba Gerar** — formulário (tema, janela, público, canal, quantidade 1–20) →
preview de N cartões editáveis, cada um com título, corpo, sugestão visual,
data/hora e responsável, mais a ação de descartar o cartão. A tela deixa
explícito que nada foi gravado ainda. “Confirmar e agendar” envia os cartões como
estão. Público Liderança exibe o aviso da Decisão 5. Sem chave de IA, a aba
mostra o estado 503 com link para Administração › Inteligência Artificial.

## Testes

Vitest, arquivos ao lado do código. API contra Postgres real
(`pnpm db:up`; nesta máquina `LEGENDS_DB_PORT=5442`).

- **`campaign-schedule.test.ts`** — a grade cai inteira dentro da janela, em
  ordem crescente; quantidade acima da capacidade da janela é recusada.
- **`campaign-prompt.test.ts`** — snapshot do prompt puro; parser aceita JSON
  válido e rejeita quantidade errada, corpo acima de 280 e JSON malformado.
- **`campaign-service.test.ts`** —
  `endsAt < startsAt` é recusado; confirmar cria exatamente N itens com o texto
  recebido (inclusive editado); publicar cria o `CorporatePost` e liga
  `publishedPostId`; cancelar não cria post.
- **`campaigns.test.ts`** — preview não grava (contagem antes/depois idêntica); o
  guard barra SUBADMIN de outro setor; auditoria gravada nas mutações; 503 sem
  chave da empresa.
- **`CampaignsSection.test.tsx`** — preview renderiza N cartões; edição persiste
  no payload do confirm; o estado 503 na aba Gerar não afeta o calendário.

## Fora de escopo / dívida assumida

- **Publicação automática no horário.** Não há scheduler no processo da API —
  `apps/api/src/scheduler/nudges.ts` é disparado de fora. Um `setInterval` dentro
  do Fastify seria um job invisível que morre no primeiro restart e duplica em
  qualquer deploy com mais de uma instância. No MVP, o item é publicado quando
  G&G o marca como publicado. Automatizar é task separada, com decisão de infra.
- **Disparo de e-mail** e **entrega automática no Teams** (ver Decisão 6).
- **Aprovação em múltiplas etapas.**
- **Geração de imagem por IA** — `visualHint` é texto sugerindo o visual.
- **Segmentação de público no Mural** (ver Decisão 5).
