# Design — Destaque do Mês: apuração, card compartilhável (IA) e histórico

**Data:** 2026-06-10
**Status:** Aprovado no brainstorming (pendente revisão do spec escrito)

## Objetivo

Ao encerrar um período de votação, eleger o **destaque do mês** (o colaborador
mais votado) e produzir um **card compartilhável**: uma imagem com a foto do dev,
o mês, o selo e um **texto curto e impactante gerado por IA (Gemini)** que
parabeniza a pessoa e explica o porquê do destaque a partir das justificativas
escritas pelos colegas. O card fica **persistido** e acessível num **histórico de
destaques** (hall da fama mensal), onde qualquer colaborador pode clicar para
salvar/compartilhar.

Hoje não existe nenhuma apuração de vencedor: períodos só mudam de estado por data
e os reconhecimentos são acumulados ao longo da vida (ver `voting-service.ts`,
`profile-service.ts`, `period-state.ts`). Este design adiciona a eleição mensal.

## Decisões travadas no brainstorming

- **Escopo do destaque:** um único destaque **geral** por mês — o colaborador com
  mais votos recebidos no período (cada votante dá 1 voto/mês, ver constraint
  `@@unique([voterId, periodId])`).
- **Desempate:** entre empatados em nº de votos, vence **quem atingiu a pontuação
  vencedora primeiro** — isto é, ordena pelo `createdAt` do voto que levou o
  empatado ao total vencedor; o mais antigo ganha. Determinístico.
- **Fonte da verdade:** o resultado mora no próprio `VotingPeriod` (Abordagem A).
  O selo é o artefato de gamificação concedido na publicação.
- **Gatilho:** **botão "Gerar destaque" no admin**, com preview antes de publicar.
- **Geração única (controle de tokens):** o Gemini é chamado **uma única vez** por
  período, na transição `NONE → DRAFT`. Não há "regenerar". Uma vez em `DRAFT`/
  `PUBLISHED`, nenhuma nova chamada ao modelo é feita.
- **Edição livre até publicar:** em `DRAFT`, o admin edita o texto à mão quantas
  vezes quiser; cada salvar **re-renderiza apenas o card** (local, sem Gemini).
- **Publicação = liberação:** o resultado (vencedor + texto + card) só fica visível
  aos colaboradores quando o admin publica (`PUBLISHED`). Antes, é restrito ao admin.
- **Imagem:** card por **template SVG → PNG** (`@resvg/resvg-js`), na identidade
  visual do tema. Sem geração de imagem por IA. _(Refinamento no plano: o SVG é
  montado por string/template próprio em vez de satori — remove a dependência de
  carregar um buffer de fonte TTF e deixa o render determinístico/testável. Trade-off:
  quebra de linha do texto é aproximada por contagem de caracteres em vez de layout
  flex. Endurecimento futuro: embutir uma TTF e/ou voltar a satori se quisermos
  layouts mais ricos.)_
- **Foto do dev:** reaproveita a convenção do design de fotos
  (`2026-06-10-dev-photos-microsoft365-design.md`): arquivo nomeado pelo handle do
  email em `apps/api/assets/avatars/{handle}.jpg`, resolvido por `avatarPathFor`.
  **Fallback:** sem arquivo → renderiza o avatar atual do dev / iniciais no card.
- **Privacidade:** as justificativas vão ao Gemini **sem identificar os autores**
  (apenas os textos das justificativas, nunca nome/email de quem escreveu).

## Modelo de dados (Prisma)

`VotingPeriod` ganha o resultado do destaque:

```prisma
enum HighlightStatus {
  NONE       // default — ainda não gerado
  DRAFT      // preview gerado (texto + card), visível só ao admin
  PUBLISHED  // liberado aos colaboradores
}

model VotingPeriod {
  // ...campos atuais...
  winnerId           String?
  winnerVotes        Int?
  highlightText      String?          // texto final (Gemini, possivelmente editado)
  highlightImagePath String?          // caminho do PNG gerado
  highlightStatus    HighlightStatus  @default(NONE)

  winner User? @relation("PeriodWinner", fields: [winnerId], references: [id])
}
```

`BadgeKind` ganha `HIGHLIGHT`. Seed de um `Badge` `destaque-do-mes`
(kind `HIGHLIGHT`, `threshold` 0, ícone próprio). O selo é concedido na publicação.

`UserBadge`: trocar `@@unique([userId, badgeId])` por
`@@unique([userId, badgeId, periodId])`. Hoje o constraint impede ganhar o mesmo
selo 2x; o Destaque é mensal e recorrente. Selos existentes têm `periodId = null`
e, no Postgres, **dois NULL não colidem** num índice único — então o comportamento
dos selos atuais (CATEGORY/IMPACT/RECURRENCE, um por usuário) é preservado sem
backfill.

Migração: uma migration Prisma adiciona colunas/enum e ajusta o índice único.

## Máquina de estados do destaque

```
NONE  --[admin: "Gerar destaque"]-->  DRAFT  --[admin: "Publicar"]-->  PUBLISHED
                (1 chamada Gemini)       |
                                         '--[admin edita texto]--> DRAFT (re-render local, sem Gemini)
```

- Só `NONE → DRAFT` chama o Gemini (uma vez). A rota recusa gerar se o status já
  for `DRAFT`/`PUBLISHED` (guarda anti-reprocessamento / anti-gasto de tokens).
- Edição de texto só é permitida em `DRAFT`.
- `PUBLISHED` é terminal para o MVP (sem despublicar/regerar).

## Componentes e interfaces

Backend (novos), todos pequenos e testáveis isoladamente:

- `highlight-service.ts`
  - `electWinner(periodId)` — apuração pura sobre os votos do período: agrupa por
    `votedId`, acha o topo, aplica o desempate (voto mais antigo que atingiu o total
    vencedor). Retorna `{ winnerId, winnerVotes }` ou `null` se 0 votos.
  - `generateHighlightDraft(periodId)` — orquestra: `electWinner` →
    `buildCongratsText` (Gemini) → `renderCard` → grava `DRAFT` em transação.
    Recusa se status ≠ `NONE`.
  - `updateHighlightText(periodId, text)` — em `DRAFT`: salva texto e re-renderiza
    o card (sem Gemini).
  - `publishHighlight(periodId)` — em `DRAFT`: seta `PUBLISHED` e concede o
    `UserBadge` HIGHLIGHT (`periodId` preenchido), em transação.
  - `listPublishedHighlights()` — para o histórico.

- `gemini-client.ts` — `buildCongratsText({ winnerName, justifications })`. Interface
  estreita e **mockável**. Monta o prompt (justificativas anônimas + nome do
  vencedor + mês), chama `@google/genai` com `GEMINI_API_KEY` e `GEMINI_MODEL`
  (default `gemini-2.5-flash`). Sem chave → erro claro.

- `card-renderer.ts` — `renderCard(data): Promise<Buffer>` via satori (JSX/HTML →
  SVG) + `@resvg/resvg-js` (SVG → PNG). Recebe foto resolvida (caminho em disco ou
  fallback de avatar/iniciais), nome, mês, texto e selo. Escreve em
  `apps/api/storage/highlights/{monthRef}.png` e devolve o caminho.

- Reuso: `avatarPathFor(email)` (definido no design de fotos) para localizar a foto
  do vencedor em disco; se ausente, fallback de avatar/iniciais no próprio card.

Rotas (admin protegidas por role ADMIN; histórico autenticado):

- `POST /admin/periods/:id/highlight` → gera o DRAFT (1x). 409 se já gerado.
- `PATCH /admin/periods/:id/highlight` → edita o texto (DRAFT).
- `POST /admin/periods/:id/highlight/publish`→ publica + concede selo.
- `GET  /admin/periods/:id/highlight` → estado atual (preview p/ o admin).
- `GET  /highlights` → histórico (somente `PUBLISHED`).

Arquivos estáticos:

- `@fastify/static` (já previsto no design de fotos) serve **dois** diretórios:
  `assets/avatars` sob `/avatars/` (fotos) e `storage/highlights` sob `/highlights/`
  (cards gerados). O card é referenciado por URL relativa `/api/highlights/{monthRef}.png`.

Frontend:

- Admin (`AdminPage`): lista de períodos `ENDED` sem destaque publicado com botão
  **Gerar destaque**; ao gerar, abre preview (card + textarea editável) com **Salvar
  texto** e **Publicar**. Botão Gerar fica desabilitado quando status ≠ `NONE`.
- Nova seção/página de **Histórico de destaques**: grid de cards publicados (mês,
  vencedor, nº de votos, texto, imagem). Clicar abre/baixa o PNG para compartilhar.

## Fluxo de dados

```
admin clica "Gerar destaque"
  → POST /admin/periods/:id/highlight
     → electWinner (votos do período)               [Postgres]
     → buildCongratsText (justificativas ANÔNIMAS)   [Gemini]   (1x)
     → renderCard (foto + texto + selo) → PNG         [satori+resvg → storage/highlights]
     → grava DRAFT (winnerId, winnerVotes, text, imagePath)
  → admin revisa; edita texto → PATCH (re-render local, sem Gemini)
  → admin publica → POST .../publish → PUBLISHED + UserBadge HIGHLIGHT

colaborador → GET /highlights → cards PUBLISHED → <img src=/api/highlights/{mês}.png>
```

## Tratamento de erros / bordas

- **0 votos no período:** `electWinner` retorna null; a rota responde erro amigável
  ("sem votos para apurar") e o status permanece `NONE`.
- **Falha do Gemini ou do render:** nenhuma escrita parcial — sem `DRAFT` criado; o
  admin pode tentar de novo (status segue `NONE`, então o botão continua válido).
  A geração é, portanto, atômica por período.
- **Sem `GEMINI_API_KEY`:** a geração falha com mensagem clara; resto do app intacto.
- **Anti-gasto:** guarda de status garante 1 chamada ao Gemini por período; edição e
  re-render são locais e não consomem token.
- **Foto ausente:** fallback de avatar/iniciais no card (nunca quebra o render).
- **Idempotência:** publicar concede o selo via upsert na unique
  `(userId, badgeId, periodId)` — republicação acidental não duplica.
- **Visibilidade:** enquanto não `PUBLISHED`, vencedor/texto/card não aparecem em
  `/highlights` nem em telas de colaborador.

## Configuração

- `GEMINI_API_KEY` (obrigatória para gerar texto) e `GEMINI_MODEL`
  (default `gemini-2.5-flash`) em `apps/api/.env` (+ `.env.example`).
- `storage/highlights/` fora do versionamento (conteúdo gerado); criado em runtime.

## Testes

- **Unit (apuração):** `electWinner` — topo simples, empate resolvido pelo voto mais
  antigo que atingiu o total vencedor, e caso 0 votos → null.
- **Unit (texto):** montagem do prompt anonimiza autores (nenhum nome/email de
  votante no payload); `gemini-client` por trás de mock.
- **Unit (render):** `renderCard` produz PNG não-vazio com foto real e com fallback.
- **Rotas:** gerar 2x → segunda dá 409; editar fora de DRAFT → erro; publicar
  concede selo e expõe em `/highlights`; `/highlights` lista só `PUBLISHED`.
- **Estáticos:** `GET /highlights/<existente>.png` → 200 image; inexistente → 404.

## Fora de escopo (evoluções futuras)

- Destaque por categoria (vencedor por categoria além do geral).
- Regerar/despublicar destaque; versionar múltiplos cards por mês.
- Apuração automática por job/cron após `endsAt`.
- Compartilhamento direto em redes (deep links), além do salvar/baixar.
- Geração de imagem artística por IA.

## Dependência entre specs

A parte de fotos depende da convenção definida em
`2026-06-10-dev-photos-microsoft365-design.md` (`assets/avatars/{handle}.jpg`,
`@fastify/static`, `avatarPathFor`). Se aquele design ainda não estiver implementado,
o registro do `@fastify/static` e o helper `avatarPathFor` entram como parte deste
trabalho; o card simplesmente usa o fallback de avatar/iniciais até as fotos existirem.
