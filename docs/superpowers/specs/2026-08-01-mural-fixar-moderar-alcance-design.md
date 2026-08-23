# Mural da empresa: fixar, moderar e medir alcance — Design Spec

- **Data:** 2026-08-01
- **Autor:** waghner.reis
- **Status:** aprovado

## Resumo

O Mural corporativo (ver `2026-07-30-mural-corporativo-design.md`) é hoje um feed
plano: sem post fixado, sem registro de leitura e sem relatório. Quem comunica não
consegue responder **"quantas pessoas viram o aviso?"** — a pergunta que sempre vem.

Esta entrega fecha quatro lacunas:

- **Fixar** — a liderança prende um post no topo do mural. **No máximo um fixado
  por empresa por vez**; fixar o segundo desfixa o primeiro na mesma transação.
- **Moderar** — a exclusão de post/comentário de terceiro já funciona; passa a
  **gravar auditoria** de quem removeu.
- **Leitura** — o mural marca o post como lido quando ele entra na viewport.
- **Alcance** — painel por post: leitores únicos, % da base, comentários e reações.

## Decisões

- **Sem recorte de setor.** O mural não tem `sectorId` (é da empresa inteira, por
  desenho — ver `corporate-mural-service.ts`, `resolveMentions`). Logo não há por
  onde filtrar: **qualquer `SUBADMIN`, e o `ADMIN`, fixa, modera e vê o alcance do
  mural inteiro** — exatamente como o `deletePost` já se comporta hoje. Guard das
  rotas: `[app.authenticate, app.requireAdminOrSubadmin]`.
- **`pinnedAt` + `pinnedById`, não um booleano.** Guardar o instante e o autor da
  fixação preserva o histórico para auditoria.
- **Nenhum evento novo de WebSocket.** Fixar/desfixar reordena o feed, então emite
  o `feed:changed` que já existe — o mesmo que o post novo emite hoje
  (`routes/corporate-mural.ts`). **Leitura não é broadcast:** seria ruído inútil e
  vazaria quem leu o quê.
- **Agregação com Prisma, não `$queryRaw`.** `coin-admin-service.ts` documenta que
  SQL cru fura o isolamento por empresa do `scopedPrisma`; o relatório de coins é
  feito só com Prisma por causa disso. O `getPostReach` segue a mesma regra —
  `_count` + `groupBy` via `scopedPrisma(companyId)`.
- **`createMany({ skipDuplicates: true })` no lugar de `upsert`.** `scopedPrisma`
  **lança** `TenantScopeError` em `upsert` (`lib/tenant-scope.ts`). O
  `@@unique([postId, userId])` mais `skipDuplicates` dão a mesma idempotência em
  uma ida só ao banco.
- **Base do `readPct`: ativos, exceto `THIRD_PARTY`.** Terceirizado só enxerga o
  mural com a feature `mural-corporativo` na allowlist individual
  (`canSeeCorporateMural`); contá-lo no denominador deixaria o percentual
  cronicamente subestimado.
- **Painel como aba de Moderação.** O Legends não tem "People Analytics";
  `/admin/moderacao` ganha as abas **Votos** (o que existe) e **Mural** (alcance).
- **Caminhos seguem o repo:** `/corporate-posts/...`, sem prefixo `/corporate-mural`.
- **Privacidade:** o painel expõe **contagem**, nunca a lista nominal de quem leu.
  Nome de leitor não sai do banco — o DTO não tem campo para isso.

## Modelo de dados (Prisma)

`CorporatePost` ganha:

```prisma
pinnedAt   DateTime?
pinnedById String?
pinnedBy   User? @relation("CorporatePostsPinned", fields: [pinnedById], references: [id], onDelete: SetNull)
reads      CorporatePostRead[]

@@index([companyId, pinnedAt])
```

Model novo:

```prisma
model CorporatePostRead {
  id        String   @id @default(cuid())
  postId    String
  userId    String
  companyId String   @default("company-emr")
  readAt    DateTime @default(now())

  post    CorporatePost @relation(fields: [postId], references: [id], onDelete: Cascade)
  user    User          @relation("CorporatePostReads", fields: [userId], references: [id], onDelete: Cascade)
  company Company       @relation(fields: [companyId], references: [id])

  @@unique([postId, userId])
  @@index([companyId, postId])
}
```

`CorporatePostRead` **precisa entrar em `TENANT_SCOPED_MODELS`**
(`lib/tenant-scope.ts`) — o registro é manual e é o que garante o isolamento por
empresa. Migration nova via `pnpm db:migrate`; nenhuma migration existente é
editada. `AdminAuditAction` não muda: fixar/desfixar é `UPDATE`.

## Contrato (`packages/shared/src/corporate-mural.ts`)

- `CorporatePostDTO.pinnedAt: string | null`
- `CorporatePostReachDTO { postId, excerpt, readers, readPct, comments, reactions, createdAt }`
- `CorporatePostReachResponse { items: CorporatePostReachDTO[]; audience: number; total: number }`
  — `audience` é o denominador, para o painel dizer "12 de 48"; `total` é a
  contagem de posts, para a paginação.
- `canPinCorporatePost(role)` — fonte única do guard e do botão na web, espelhando
  `canPublishCorporatePost`. Verdadeiro para `ADMIN` e `SUBADMIN`.
- `CORPORATE_POST_EXCERPT_LENGTH` (80) — tamanho do trecho no painel.

`CorporateMuralEvent` **não muda**.

## Backend

### Service (`services/corporate-mural-service.ts`)

- **`pinPost({ postId, actorId, companyId })`** — dentro de `db.$transaction`:
  `updateMany({ where: { pinnedAt: { not: null } }, data: { pinnedAt: null, pinnedById: null } })`
  desfixa o anterior, depois grava `pinnedAt: new Date()` e `pinnedById: actorId`
  no alvo, e `recordAuditLog({ entityType: 'CorporatePost', action: 'UPDATE', before, after, tx })`
  no mesmo `tx` — padrão de `badge-admin-service.ts`. Post inexistente → 404.
- **`unpinPost`** — simétrico. Post já não fixado é no-op bem-sucedido
  (idempotente) e **não gera log** — auditoria só quando houve o que desfixar.
- **`markPostRead({ postId, userId, companyId })`** — valida que o post existe
  (404) e `createMany({ data: [{ postId, userId }], skipDuplicates: true })`.
- **`getPostReach(companyId, { sort, page, pageSize })`** — `findMany` com
  `_count: { select: { comments: true, reactions: true, reads: true } }`. O
  `@@unique([postId, userId])` faz `_count.reads` já ser **leitores únicos**;
  `_count.reactions` é o **total de reações** (uma pessoa com três emojis conta
  três), que é o mesmo número que o card do mural exibe. Denominador:
  `user.count({ where: { active: true, role: { not: 'THIRD_PARTY' } } })`.
  `readPct = audience > 0 ? readers / audience * 100 : 0`, arredondado a uma casa.
  `sort`: `date_desc` (default) ou `date_asc`.
- **`listFeed`** — o post fixado **sai do keyset** e é **prefixado só na primeira
  página** (quando não há `cursor`); todas as páginas excluem o id fixado, então
  ele nunca aparece duas vezes. A alternativa — ordenar por `pinnedAt` e carregar
  o cursor com ele — obrigaria a mudar o formato do cursor sem ganho, já que no
  máximo um post fica fixado.
- **`deletePost` / `deleteComment`** — passam a gravar `recordAuditLog`
  (`action: 'DELETE'`) **quando quem apaga não é o autor**, isto é, quando é ato de
  moderação. Auto-exclusão continua sem log.

### Rotas (`routes/corporate-mural.ts`)

| Método | Rota | Guard | Resposta |
|---|---|---|---|
| POST | `/corporate-posts/:id/pin` | `[authenticate, requireAdminOrSubadmin]` | `200 { post }` |
| DELETE | `/corporate-posts/:id/pin` | idem | `200 { post }` |
| POST | `/corporate-posts/:id/read` | guard do mural (`requireCorporateMuralAccess`) | `204` |
| GET | `/admin/corporate-posts/reach?sort&page&pageSize` | `[authenticate, requireAdminOrSubadmin]` | `200 CorporatePostReachResponse` |

Rotas finas: Zod `safeParse` → `400 { message, issues }`, service, serialize.
`CorporateMuralError` continua tratado por `instanceof` com `err.status`. O
`reach` fica em `corporate-mural.ts`, não em `admin.ts` (já com ~46 KB).
`pin`/`unpin` emitem `corporateMuralHub.broadcast({ type: 'feed:changed' })`;
`read` não emite nada.

## Frontend

- **`CorporatePostCard`** — selo **"Fixado"** quando `post.pinnedAt`; ação de
  fixar/desfixar visível sob `canPinCorporatePost(user.role)`, ao lado da lixeira
  que já existe.
- **Leitura** — hook `useMarkPostRead` com `IntersectionObserver` (dispara com
  ≥50% do card visível) e um `Set<string>` de módulo com os ids já enviados: **uma
  vez por post por sessão**. Não faz `setState` e **não invalida o feed** — o
  gotcha de render→setState→render descrito no `AGENTS.md` mora exatamente aí, e
  invalidar traria refetch em cascata durante o scroll.
- **`MuralCorporativoFeed`** — o post fixado vem primeiro da API; nada de
  reordenar no cliente.
- **`ModerationSection`** — ganha abas **Votos** (conteúdo atual) e **Mural**
  (`CorporateMuralReachTab`): tabela com trecho do post, leitores únicos, % da
  base, comentários, reações e data, ordenável por data, com o denominador
  visível ("12 de 48"). Dados por React Query + `apiFetch`.

Nada muda no `AdminSidebar`: o item "Moderação" já existe e já é visível ao
subadmin.

## Testes

- **`services/corporate-mural-service.test.ts`** — fixar o segundo post desfixa o
  primeiro (nunca há dois fixados); `unpinPost` idempotente; `markPostRead` duas
  vezes gera uma linha só; `readPct` calculado sobre ativos não-`THIRD_PARTY`;
  post e leituras de outra empresa fora do painel; feed devolve o fixado primeiro
  sem duplicá-lo na segunda página; auditoria gravada em pin, unpin e exclusão de
  terceiro (e ausente na auto-exclusão).
- **`routes/corporate-mural.test.ts`** — 403 para não-admin em `pin` e em `reach`;
  `read` responde 204 e é idempotente; 404 em post inexistente.
- **`pages/mural-corporativo/…`** — selo "Fixado" renderizado; ação de fixar
  escondida para não-admin; `IntersectionObserver` dispara `read` uma única vez.
- **`pages/admin/ModerationSection.test.tsx`** — troca de abas e render da tabela
  de alcance.

API roda contra Postgres real: `pnpm db:up` (nesta máquina `LEGENDS_DB_PORT=5442`).

## Fora de escopo

Envio por e-mail/Teams, agendamento de publicação (é o PBI do gerador de
campanhas), segmentação de público por post, título e capa no post
(`cover_url` do portal de origem), mais de um post fixado, e recorte por setor do
painel de alcance.
