# Feed Corporativo — 2ª rodada de ajustes da G&G — Design Spec

- **Data:** 2026-08-17
- **Autor:** lucca.secco
- **Status:** implementado

## Resumo

Segunda rodada de pedidos da G&G para o item 3.1 do documento do Portal EMR
(Comunicação → Feed Corporativo). O que existe hoje no Legends é o **Mural
corporativo** (`2026-07-30-mural-corporativo-design.md`) mais fixar/moderar/
alcance (`2026-08-01-mural-fixar-moderar-alcance-design.md`): feed plano, texto
curto (280), GIF/imagem, reações, comentários, menções, fixar e painel de
alcance.

Esta entrega fecha oito lacunas:

1. **Quem publica** — o composer deixa de ser exclusivo da liderança. Todo mundo
   escreve; quem não é admin cai numa **fila de aprovação**.
2. **Destino** — post passa a ter público-alvo: empresa toda ou N setores.
3. **Texto rico** — negrito, itálico, sublinhado, tamanho, citação, listas,
   link, cor do texto e cor de preenchimento.
4. **Título** — campo separado, opcional, com destaque automático.
5. **Anexos** — foto, **vídeo**, **documento** e GIF.
6. **Identidade e edição** — autoria com setor, data e hora; admin edita, e o
   post editado exibe a marca **"editado"**.
7. **XP** — +1 reagir, +2 primeiro comentário, +3 ler o conteúdo completo, com
   **estorno** ao desfazer.
8. **Aviso** — comunicado novo cai no sininho e aparece como **toast** para quem
   está com a plataforma aberta. Botão de IA passa a **gerar** o comunicado a
   partir de instruções, em vez de "melhorar o texto".

## Decisões

### 1. Texto rico é documento fechado (JSON), não HTML

O repo tem posição explícita e documentada sobre isso em `components/Markdown.tsx`:
*"nada de `dangerouslySetInnerHTML` … o que não é reconhecido pelo parser vira
texto. Isso tira a classe inteira de XSS do caminho, sem precisar de sanitizador
nem de dependência nova."* Guardar HTML de post escrito por **qualquer
colaborador** (é isso que a lacuna 1 destrava) e injetá-lo no DOM seria XSS
armazenado com alcance de empresa inteira — inclusive contra a sessão do admin
que abre a fila de aprovação.

Então o contrato é um **documento fechado** em `@legends/shared`
(`rich-text.ts`): blocos (`paragraph`, `quote`, `bullet`, `ordered`) com
`spans` que carregam marcas (`bold`, `italic`, `underline`, `size`, `color`,
`highlight`, `link`, `mention`). O Zod da rota valida o documento inteiro —
cor fora da paleta, tamanho fora da escala ou `href` que não passa em
`isSafeHref` são **400**, não sanitização silenciosa. A web renderiza como
**elementos React**, igual ao `Markdown`.

Consequência boa de graça: `richDocToPlainText` dá o texto puro para excerto do
alcance, prévia da Home, notificação e busca — sem regex sobre markup.

- `content` (coluna que já existe) continua sendo **o texto puro** e a fonte de
  compatibilidade: post antigo, publicação de campanha e qualquer leitor que só
  quer texto seguem funcionando sem migração de dado.
- `contentJson` (nova, `Json?`) guarda o documento rico. Nulo = post de texto
  puro (todos os que já existem).

### 2. Aprovação é status no post, não tabela de rascunho

`CorporatePost.status`: `PENDING | PUBLISHED | REJECTED`. Rascunho em tabela à
parte obrigaria a duplicar anexos, menções e público-alvo e a "promover" a linha
na aprovação — mais código e uma janela onde o id do post muda (o deep-link da
notificação quebraria). Com status na própria linha, aprovar é um `UPDATE`.

`canPublishCorporatePost` deixa de ser o guard de **quem escreve** e passa a ser
o de **quem publica direto**: quem não passa nele cria com `status: PENDING`.
Post pendente não entra em `listFeed`, não conta no alcance, não notifica
ninguém além dos admins e **não aparece para o próprio autor no feed** — ele o vê
na fila ("Meus envios"), que é onde o estado dele faz sentido.

Renomear: `canPublishCorporatePost` → `canPublishCorporatePostDirectly`, para o
nome não mentir agora que todo mundo pode escrever.

### 3. Público-alvo revoga a decisão "sem recorte de setor"

A spec de 01/08 decidiu que o mural não tem `sectorId`. A G&G pediu o seletor de
destino de volta, então a decisão cai — com o cuidado que ela apontava:

- `audienceScope: ALL | SECTORS` + tabela `CorporatePostSector`. Escopo em
  coluna, não "lista vazia = todos": o `ALL` explícito sobrevive a alguém apagar
  um setor.
- O filtro vale em **todo** ponto de leitura: `listFeed`, `getPost`,
  comentários, reações, marcar leitura. Sem isso o deep-link da notificação
  entregaria o comunicado a quem não é do público.
- No alcance, o **denominador passa a ser o público do post**, não a empresa
  inteira — "12 de 48" com 40 pessoas fora do público seria mentira.
- ADMIN/SUBADMIN enxergam qualquer post independentemente do público: sem isso
  o G&G não conseguiria moderar o que segmentou.

### 4. XP estorna apagando a transação, não debitando

`xp.ts` é explícito: *"XP é acumulado e nunca é debitado"*, e `XpTransaction`
não tem `kind` justamente por isso. Lançar valor negativo obrigaria a revisar
`computeLevel`, o extrato e o backfill. Então desfazer a reação/comentário
**apaga a linha** do ledger (`revokeXp`), e a unique `(userId, dedupeKey)`
deixa recreditar se a pessoa refizer a ação. O invariante de sinal continua de pé
e o saldo bate com o que a G&G pediu.

Três eventos novos, com regra por empresa como todos os outros
(`XpRule`, CRUD do admin) — o valor da spec (1/2/3) é o **default do seed**, não
número cravado no código:

| Evento | Valor | Referência do dedupe | Estorna? |
|---|---|---|---|
| `CORPORATE_POST_REACTION` | +1 | `postId` | sim, quando some a **última** reação da pessoa no post |
| `CORPORATE_POST_COMMENT` | +2 | `postId` | sim, quando some o **último** comentário da pessoa no post |
| `CORPORATE_POST_READ_FULL` | +3 | `postId` | não |

A referência é o `postId`, e não `postId:emoji`, porque a regra é "vale uma vez
por publicação" — três emojis no mesmo post continuam valendo 1.

### 5. Ler o conteúdo completo é um evento explícito, decidido no servidor

O crédito de +3 só existe onde há o botão "Ver conteúdo completo". Quem decide
se o post é longo é o **servidor** (`isCollapsibleCorporatePost`, fonte única em
`@legends/shared`, usada também pela web para decidir se corta): se dependesse
do cliente, qualquer um mandaria `full: true` num post de uma linha.

`POST /corporate-posts/:id/read` ganha `{ full?: boolean }`. Sem `full`, é a
marcação de leitura do painel de alcance, que continua saindo do
`IntersectionObserver` e **não** paga XP. Com `full: true`, marca leitura **e**
credita — se o post for de fato longo.

### 6. Toast não carrega conteúdo no WebSocket

`CorporateMuralHub` é **canal único e global, sem salas** (está escrito no
arquivo). Colocar título/trecho do comunicado no broadcast vazaria comunicado de
uma empresa para conexões de outra. Então o evento novo é magro —
`{ type: 'post:published', postId }` — e o cliente busca `GET /corporate-posts/:id`
para montar o toast. A rota é escopada por empresa e pelo público-alvo: quem não
deve ver recebe 404 e nenhum toast aparece. Rota nova, porque não existia jeito
de ler um post isolado.

### 7. Anexos em tabela, imagem e GIF onde já estão

`CorporatePostAttachment` (kind `IMAGE | VIDEO | DOCUMENT`) cobre o pedido de
vídeo e documento e aceita mais de um arquivo. `gifUrl`/`imageUrl` do post
continuam onde estão: post antigo não precisa de backfill e o DTO devolve a
imagem legada dentro da mesma lista, então a web tem um só caminho de render.

Vídeo e documento sobem por presign, como a imagem. `/uploads/documents/presign`
hoje é `requireAdminOrSubadmin` (era para manual interno) — o feed precisa de um
caminho que o colaborador use, então entra `/uploads/media/presign`, autenticado,
com allowlist própria (`video/mp4`, `video/webm`, PDF e os formatos do Office) e
teto de 50 MB para vídeo.

### 8. Cor da marca na reação, não coração verde cravado

O pedido "personalizar para que o coração padrão seja verde" vira 💚 no conjunto
de reações. Coração vermelho é o emoji ❤️ do Unicode — não dá para tingi-lo por
CSS sem virar imagem. 💚 é um emoji próprio e resolve o pedido sem sair do
padrão de reações já usado na galeria/resenha, que é o que a spec pede para
seguir.

### 9. "Editado" tem coluna própria

`editedAt`, não `updatedAt`. `updatedAt` já muda ao fixar, ao aprovar e a
qualquer `UPDATE` — usá-lo marcaria como "editado" um post que ninguém tocou no
texto.

### 10. IA reusa o caminho das campanhas

O gerador de campanhas (`campaign-service`) já resolve credenciais por empresa
(`resolveAiCredentials`) e chama `requestAgentCompletion`. O botão do composer
usa o mesmo caminho, com prompt próprio (`lib/corporate-post-prompt.ts`) que
devolve **título + corpo**. Sem chave cadastrada, 503 tratado — igual aos demais
agentes. O prompt **não** menciona tom de voz institucional enquanto o manual da
G&G não existir; há um único ponto marcado com `TODO(tom-de-voz)` para plugá-lo.

## Modelo de dados (Prisma)

`CorporatePost` ganha:

```prisma
title           String?
contentJson     Json?
status          CorporatePostStatus @default(PUBLISHED)
audienceScope   CorporatePostAudience @default(ALL)
editedAt        DateTime?
reviewedAt      DateTime?
reviewedById    String?
rejectionReason String?

reviewedBy      User? @relation("CorporatePostsReviewed", fields: [reviewedById], references: [id], onDelete: SetNull)
sectors         CorporatePostSector[]
attachments     CorporatePostAttachment[]

@@index([companyId, status, createdAt])
```

Models novos: `CorporatePostSector` (`@@unique([postId, sectorId])`) e
`CorporatePostAttachment`. Enums novos: `CorporatePostStatus`,
`CorporatePostAudience`, `CorporatePostAttachmentKind`. `XpEvent` ganha três
valores e `NotificationType` ganha quatro.

Os dois models novos **entram em `TENANT_SCOPED_MODELS`** (`lib/tenant-scope.ts`)
— o registro é manual e é o que garante o isolamento por empresa.

## Contrato (`packages/shared`)

- `rich-text.ts` — `RichDoc`, `RichBlock`, `RichSpan`, `RICH_TEXT_COLORS`,
  `RICH_TEXT_SIZES`, `richDocToPlainText`, `isRichDoc`, `richDocLineCount`.
- `corporate-mural.ts` — `CORPORATE_POST_BODY_MAX_LENGTH` (5000, sobre o texto
  puro), `CORPORATE_POST_TITLE_MAX_LENGTH` (120), `CORPORATE_COMMENT_MAX_LENGTH`
  (280, era `CORPORATE_POST_MAX_LENGTH`), `CORPORATE_POST_COLLAPSE_LINES` (3),
  `isCollapsibleCorporatePost`, `canPublishCorporatePostDirectly`,
  `canModerateCorporatePost`, `canEditCorporatePost`, os DTOs de post
  (com `title`, `body`, `status`, `audience`, `attachments`, `editedAt`,
  `authorSectorName`) e o DTO da fila de aprovação.

## Backend

### Service (`services/corporate-mural-service.ts`)

- `createPost` — aceita `title`, `body` (RichDoc), `audience`, `attachments`.
  Deriva `content` do documento, valida tamanho no texto puro, resolve setores
  do público (só setores ativos da empresa) e grava `status` conforme o papel.
- `updatePost` — edição por admin (ou pelo autor **enquanto pendente**), grava
  `editedAt` e auditoria `UPDATE`.
- `approvePost` / `rejectPost` — `updateMany` condicional em `status: PENDING`
  serializa duas aprovações concorrentes (mesmo padrão de `publishCampaignPost`),
  grava auditoria e notifica o autor.
- `listPendingPosts` — fila da G&G.
- `listFeed` / `getPost` / comentários / reações / `markPostRead` — todos
  passam a filtrar por `status: PUBLISHED` e pelo público-alvo do viewer.
- `getPostReach` — denominador por post: público do post, não a empresa.

### Rotas (`routes/corporate-mural.ts`)

| Método | Rota | Guard | Resposta |
|---|---|---|---|
| GET | `/corporate-posts/:id` | mural | `200 { post }` |
| PATCH | `/corporate-posts/:id` | mural (service decide) | `200 { post }` |
| GET | `/corporate-posts/pending` | admin/subadmin | `200 { items }` |
| POST | `/corporate-posts/:id/approve` | admin/subadmin | `200 { post }` |
| POST | `/corporate-posts/:id/reject` | admin/subadmin | `200 { post }` |
| POST | `/corporate-posts/ai/generate` | mural | `200 { title, body }` |
| POST | `/corporate-posts/:id/read` | mural | `204` (agora com `{ full? }`) |

`POST /uploads/media/presign` entra em `routes/image-uploads.ts`.

## Frontend

- `components/rich-text/RichTextEditor.tsx` — `contenteditable` + barra de
  ferramentas; ao mudar, o DOM é **traduzido** para `RichDoc` (não guardamos o
  HTML do navegador). `RichTextView.tsx` faz o caminho inverso, em elementos
  React.
- `CorporatePostComposer` — título, editor, seletor de destino, anexos, botão de
  IA (diálogo de instruções) e aviso de "vai para aprovação" para quem não
  publica direto.
- `CorporatePostCard` — título em destaque, autoria com **setor · data e hora**,
  marca "editado", corpo cortado em `CORPORATE_POST_COLLAPSE_LINES` linhas com
  "Ver conteúdo completo" (que dispara o `read` com `full: true`), imagem
  compacta (`max-h-56`, era `max-h-80`), anexos de vídeo e documento.
- `pages/admin/CorporateFeedApprovalTab.tsx` — fila de pendentes na Moderação.
- `components/CorporatePostToasts.tsx` — montado no `AppLayout`, escuta
  `post:published` e mostra a prévia no canto inferior.

## Testes

- `packages/shared` — round-trip do `RichDoc`, `richDocToPlainText`,
  `isCollapsibleCorporatePost`, guards de permissão.
- `services/corporate-mural-service.test.ts` — pendente não entra no feed;
  aprovar dois em paralelo credita um só; público-alvo esconde o post de quem é
  de outro setor (inclusive no deep-link e nos comentários); admin vê tudo;
  denominador do alcance é o público; `editedAt` só na edição de texto.
- `routes/corporate-mural.test.ts` — 403/404 dos guards novos; `read` com
  `full: true` em post curto não credita XP; documento rico inválido dá 400.
- `services/xp-service.test.ts` — `revokeXp` apaga e permite recrédito.
- Web — editor traduz DOM→`RichDoc`; card corta e expande; composer avisa
  aprovação; fila aprova/recusa; toast some sozinho.

## O que a implementação acrescentou ao desenho

- **`pages/mural-corporativo/MeusEnviosPage.tsx`** (rota
  `/mural-corporativo/meus-envios`). O desenho decidiu que post pendente não
  aparece no feed "nem para o próprio autor", mas não disse **onde** ele
  aparece. Sem esta tela, quem escrevia via o comunicado sumir, e a notificação
  de recusa não teria para onde apontar. A mesma rota
  (`GET /corporate-posts/pending`) serve as duas leituras: fila da empresa para
  quem administra, "Meus envios" para o autor — o escopo é do servidor.
- **`CorporatePostEditForm`**, usado no card (quem administra) e em Meus envios
  (o autor, enquanto pendente). O `PATCH` estava previsto; a porta para ele, não.
- **`@legends/shared/media.ts`** — allowlist e tetos do anexo (vídeo 50MB, PDF e
  Office 20MB, imagem 10MB) e `mediaKindFor`, que é o que faz a **espécie do
  anexo sair do content-type**, nunca do rótulo mandado pelo cliente.
- **`lib/corporate-mural-error.ts`** — a classe de erro saiu do service para um
  arquivo próprio (mesmo padrão de `campaign-error.ts`), senão o prompt da IA e
  o service se importariam em ciclo.
- **`createdAt` é recarimbado na aprovação.** O feed ordena por ele; manter a
  data do envio faria o comunicado aprovado dias depois nascer no meio do feed,
  onde ninguém veria. `reviewedAt` guarda quando a revisão aconteceu.
- **Backfill**: `XpAction.event` passou a ser um subconjunto explícito de
  `XpEvent` (`BackfillableXpEvent`). A mesma fila alimenta `awardCoins`, e os
  três eventos novos existem em XP e não em coins.

## Adendo — coluna lateral do Feed (Figura 1 do documento)

A figura de referência da G&G mostra a tela do Feed em **duas colunas**: feed à
esquerda, e à direita "Como ganhar pontos" e o ranking. O editor, o
direcionamento por setor e o corte com "Ver conteúdo completo" da figura já
tinham saído nesta rodada; faltava a coluna.

- `MuralCorporativoPage` vira `lg:grid-cols-[minmax(0,1fr)_320px]`, com a lateral
  `sticky` — sem isso ela some depois de duas rolagens do scroll infinito e o
  ranking deixa de existir na prática. Abaixo de `lg` a coluna desce para o fim:
  colocar o placar antes do composer esconderia o que se veio fazer na tela.
- `HowToEarnPointsCard` (novo) lê `GET /xp/rules` — a mesma rota do Manual do
  Game, que devolve **só regra ativa**. O 1/2/3 da figura é o default do seed,
  não número de tela: empresa que mudou o valor vê o valor dela, e evento com a
  regra desligada **não aparece na lista**. Sem nenhuma das três, o card não é
  montado.
- `TopEngagementCard` é reusado como está (já existia na Home, spec de 15/08),
  com o "Ver ranking completo" que a figura pede.
- O botão "Ver conteúdo completo" passa a anunciar `(+N pts)`, pelo mesmo
  `useXpAmount` — e some o sufixo quando a empresa não paga o evento.

## Fora de escopo

Envio por e-mail/Teams (é do gerador de campanhas), agendamento de publicação,
mais de um post fixado, edição de comentário, e o manual de tom de voz — que
entra no prompt quando a G&G entregar.
