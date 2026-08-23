# Mural corporativo — Design Spec

- **Data:** 2026-07-30
- **Autor:** lucca.secco
- **Status:** aprovado

## Resumo

**Mural corporativo** é o feed da **empresa inteira**: comunicados da liderança
que todo mundo vê, independentemente do setor. Mesma mecânica e mesmo visual da
**Resenha do time** (texto ≤ 280 caracteres, GIF/imagem, menções, reações e
comentários planos, scroll infinito, tempo real por WebSocket), com duas
diferenças de fundo:

- **Não é setorizado.** O isolamento é só por empresa (`companyId`); não existe
  `sectorId` nos models do mural.
- **Só liderança publica.** `LEAD`, `MANAGER`, `HEAD`, `SUBADMIN` e `ADMIN`
  publicam; **lendas (e terceirizados) só reagem e comentam**.

Na **Home**, a seção "Resenha do time" dá lugar ao "Mural corporativo". A
**Resenha continua existindo**, isolada por setor, na rota `/resenha` e no menu.

## Decisões

- **Tabelas próprias** (`CorporatePost*`) em vez de reaproveitar `Review` com uma
  coluna `scope`. Custo aceito: duplicação de service/rotas/componentes. Ganho:
  zero risco de regressão na Resenha (feature madura, com ~540 linhas de teste em
  cima do isolamento por setor) e liberdade para o mural divergir (ex.: sem
  "compartilhar no mural", com selo de papel do autor no card).
- **Sem compartilhamento.** O `ReviewShare` existe para alimentar o carrossel do
  mural de compartilhamento; um post que já é da empresa toda não precisa ser
  "republicado". Não há `CorporatePostShare`, `shareCount` nem `sharedByMe`.
- **Feature key própria:** `mural-corporativo`, ligável por setor no admin como
  as demais. O conteúdo continua global — o flag controla só quem vê a seção.
  Uma migration de dados habilita a feature em todo setor (e terceirizado) que
  já tinha `resenha`, para ninguém perder a coluna principal da Home no deploy.
- **Permissão de publicar em `@legends/shared`** (`CORPORATE_POST_PUBLISHER_ROLES`
  + `canPublishCorporatePost`), no estilo do `isLeaderRole`: a API valida no
  service (403) e a web esconde o composer com a mesma função. `ADMIN`/`SUBADMIN`
  entram na lista porque já moderam a plataforma.
- **Exclusão:** autor exclui o seu; `ADMIN`/`SUBADMIN` excluem qualquer um,
  inline no feed (não há página de moderação dedicada, diferente da Resenha).
- **Menções alcançam a empresa toda** — `GET /users?scope=company`. O default do
  endpoint continua sendo o setor (`THIRD_PARTY` nunca escolhe: sempre o próprio).
- **Reações:** as mesmas 16 da Resenha (`CORPORATE_POST_REACTIONS` reexporta
  `REVIEW_REACTIONS`) — o mural "segue os mesmos estilos".
- **Tempo real:** hub próprio (`corporateMuralHub`), canal único global, para os
  eventos do mural não invalidarem as queries da resenha e vice-versa.

## Modelo de dados (Prisma)

Seis models novos, todos com `companyId` (e **sem** `sectorId`, de propósito):
`CorporatePost`, `CorporatePostComment`, `CorporatePostReaction`,
`CorporatePostCommentReaction`, `CorporatePostMention`,
`CorporatePostCommentMention`. Espelham 1:1 os equivalentes de `Review`, menos o
`Share`. Todos registrados em `TENANT_SCOPED_MODELS` (`lib/tenant-scope.ts`) —
esse registro é manual e é o que garante o isolamento por empresa.

`NotificationType` ganha `CORPORATE_POST_COMMENT`,
`CORPORATE_POST_COMMENT_REPLY`, `CORPORATE_POST_REACTION` e
`CORPORATE_POST_MENTION`.

## Contrato (`packages/shared/src/corporate-mural.ts`)

`CORPORATE_POST_MAX_LENGTH` (280), `MAX_CORPORATE_POST_MENTIONS` (10),
`CORPORATE_POST_REACTIONS`, `CORPORATE_POST_PUBLISHER_ROLES`,
`canPublishCorporatePost`, `CorporatePostDTO`, `CorporatePostCommentDTO`,
`CorporatePostFeedResponse`, `CorporatePostCommentsResponse`,
`CreateCorporatePostRequest`, `CreateCorporatePostCommentRequest` e
`CorporateMuralEvent` (`feed:changed` | `post:changed` | `comments:changed`).
`MentionDTO` e `ReactorRef` são reaproveitados de `review.ts`.

## Backend

`routes/corporate-mural.ts` (fina, Zod + `app.requireFeature('mural-corporativo')`)
→ `services/corporate-mural-service.ts` (regra, `CorporateMuralError` com
`status`) → Prisma escopado por empresa. Endpoints:

| Método | Rota |
|---|---|
| GET | `/corporate-posts?cursor&limit` (devolve também `canPublish`) |
| POST | `/corporate-posts` (403 para quem não é liderança) |
| DELETE | `/corporate-posts/:id` |
| POST | `/corporate-posts/:id/reactions/toggle` |
| GET/POST | `/corporate-posts/:id/comments` |
| DELETE | `/corporate-posts/comments/:commentId` |
| POST | `/corporate-posts/comments/:commentId/reactions/toggle` |
| GET | `/corporate-posts/ws` (WebSocket, token na query) |

Paginação do feed por cursor (`createdAt|id` em base64url); comentários por
offset/limit. Notificações best-effort (falha logada, não derruba a request),
com link `/mural-corporativo#<postId>`.

## Frontend

`pages/mural-corporativo/`: `MuralCorporativoPage` (rota `/mural-corporativo`,
sob `FeatureGate`), `MuralCorporativoFeed` (composer + lista + scroll infinito +
deep-link + socket), `CorporatePostCard`, `CorporatePostComposer`,
`CorporatePostComments`. Hooks em `lib/use-corporate-mural.ts` e socket em
`lib/useCorporateMuralSocket.ts`, espelhando `use-reviews.ts` /
`useReviewSocket.ts` (inclusive o toggle otimista de reação, que reusa
`applyReactionToggle`).

O composer só aparece quando `canPublish` (do feed; enquanto ele não chega, o
papel do usuário decide, para não piscar). O card mostra o papel do autor
("Head", "Gerente"…) ao lado do nome — é um mural de comunicados.

Home: a seção passa a ser "Mural corporativo" (`features.has('mural-corporativo')`),
com "Ver tudo" para `/mural-corporativo`. Menu ganha o item "Mural corporativo"
(ícone `campaign`), acima de "Resenha".

## Testes

- `services/corporate-mural-service.test.ts`: quem publica (matriz de papéis),
  lenda comenta/reage, feed sem recorte de setor, menção cross-setor, cursor,
  autor inativo, reply recipients, toggle de reação, permissão de exclusão,
  escopo por empresa (404 nas mutações, menção de outra empresa ignorada).
- `routes/corporate-mural.test.ts`: 201/403 por papel, feed igual entre setores +
  `canPublish`, comentário/reação com notificação, exclusão, gate de feature.
- `pages/mural-corporativo/MuralCorporativoFeed.test.tsx`: lista, composer
  escondido para lenda e visível para liderança, conexão WebSocket.
- Atualizados: `HomePage.test.tsx`, `App.home-route.test.tsx`, `nav-items.test.ts`.

## Fora de escopo

Página de moderação dedicada (`/admin/mural-corporativo`), fixar post no topo,
segmentar por setor/lista de destinatários, agendamento de publicação, edição de
post, anexos além de GIF/imagem.
