# Galeria de eventos — álbuns, fotos e interação

**Data:** 2026-08-02
**Origem:** portal EMR, `/app/admin/galeria` (`src/routes/app.admin.galeria.tsx`)
**Base:** `origin/main` em `fcb4384b`

## Problema

O Legends registra o presente — mural, feedback, destaque do mês — mas não guarda a
memória visual da empresa. Foto de confraternização, hackathon e onboarding vive numa
pasta de drive que ninguém abre. Não há onde publicar o álbum de um evento nem como as
pessoas reagirem a ele.

## Escopo

Entra:

- CRUD de álbum de evento (título, descrição, data do evento, capa) por Gente e Gestão.
- Upload de várias fotos de uma vez, com progresso por arquivo e remoção individual.
- Definição de capa a partir de uma foto do álbum.
- Galeria de consumo: grade de álbuns por data e lightbox de foto.
- Reação e comentário por foto, com o conjunto de emojis já padronizado no produto.

Não entra:

- Reconhecimento facial e marcação de pessoas.
- Edição de imagem (crop, filtro, rotação).
- Álbum privado por squad.
- Menção e notificação em comentário de foto (ver *Decisões*, D5).

## Decisões

### D1 — Escrita sob `requireSectorFeature('gente-gestao')`, não `requireAdminOrSubadmin`

O brief pedia `[app.authenticate, app.requireAdminOrSubadmin]` com o service restringindo
o SUBADMIN ao próprio `sectorId`. Duas coisas quebram nisso:

1. `AGENTS.md` é explícito — `requireAdminOrSubadmin` e `requireFeature` liberam **todo**
   SUBADMIN, de qualquer setor. Bloco administrativo de G&G se protege com
   `app.requireSectorFeature('gente-gestao')`, que é o que `culture.ts` já faz nos
   manuais, benefícios e manifesto.
2. `EventAlbum` não tem `sectorId` — álbum de confraternização é da empresa, não de um
   setor. Não havia em que apoiar a restrição proposta.

Fica: **ADMIN global sempre; entre os SUBADMINs, só o do setor com a feature de bloco
`gente-gestao` ligada.** O recorte por setor já vem da própria feature de bloco, sem
código de escopo novo no service.

### D2 — Leitura sob a feature de colaborador `galeria`

Chave nova `'galeria'` em `COLLABORATOR_FEATURE_KEYS` / `FEATURE_LABELS`
(`'Galeria de eventos'`). Rota web sob `FeatureGate`, leitura na API sob
`app.requireFeature('galeria')`.

A alternativa considerada era o precedente de Manifesto/Benefícios (todo usuário logado
lê, só a edição é gatilhada). Descartada: memória visual de evento é conteúdo que a
empresa pode querer ligar por setor, e a chave dá esse controle em
Administração › Setores. Não confundir com `gente-gestao`, que diz quem **administra**.

### D3 — Capa é FK (`coverPhotoId`), não `coverKey`

O brief guardava a chave crua do objeto no álbum. Com FK `@unique` para `EventPhoto` e
`onDelete: SetNull`, apagar a foto que era capa zera o campo sozinho e a grade cai no
fallback (foto mais antiga do álbum). Com `coverKey` string, o service teria que zerar a
capa à mão em toda exclusão de foto — e um esquecimento renderiza imagem morta na grade.

Custo aceito: a capa passa a ser obrigatoriamente uma foto do próprio álbum. Não há
upload de capa avulsa, e ninguém pediu um.

### D4 — URL pública, não URL assinada

Grava-se a **chave** (`storageKey`); `toEventPhotoDTO` resolve com `publicUrlFor`, exatamente
como `Challenge.imageKey`. Não expira, cacheia no browser, e a grade de 20 álbuns não paga
assinatura nenhuma.

O portal usava bucket privado com URL assinada. Descartado aqui porque assinatura quebra o
cache do browser numa tela que é *toda* imagem, e o conteúdo é foto de confraternização
interna — não é evidência de PDI nem manual restrito, que são os dois casos em que o repo
já paga o preço da URL assinada.

Contrapartida registrada: quem tiver o link exato do objeto vê a foto sem sessão.

### D5 — Interação enxuta

Reação com `REVIEW_REACTIONS` (mesmo conjunto do mural corporativo e da resenha — sem
emoji novo). Comentário em texto puro; o autor apaga o próprio, ADMIN/G&G apaga qualquer
um. Sem menção, sem edição, sem notificação: isso arrastaria parser de menção, model de
menção e `notification-service` para dentro de uma entrega que é sobre publicar fotos.

### D6 — Lote de 20 fotos, álbum sem teto

`EVENT_PHOTO_MAX_BATCH = 20`, validado na rota. Segura a barra de progresso e o payload de
confirmação sem limitar o tamanho do álbum — uma confraternização rende bem mais de 20
fotos, em várias levas.

## Dados (Prisma)

Quatro models novos. Todos com `companyId` (`@default("company-emr")`, como os demais) mais
índice, e **todos registrados em `TENANT_SCOPED_MODELS`** (`apps/api/src/lib/tenant-scope.ts`)
— sem isso o `scopedPrisma` os ignora em silêncio e o isolamento por empresa não existe.

```prisma
model EventAlbum {
  id           String    @id @default(cuid())
  title        String
  description  String?
  eventDate    DateTime?
  coverPhotoId String?   @unique
  createdById  String
  companyId    String    @default("company-emr")
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  cover     EventPhoto?  @relation("AlbumCover", fields: [coverPhotoId], references: [id], onDelete: SetNull)
  photos    EventPhoto[] @relation("AlbumPhotos")
  createdBy User         @relation(fields: [createdById], references: [id])
  company   Company      @relation(fields: [companyId], references: [id])

  @@index([companyId, eventDate])
}

model EventPhoto {
  id           String   @id @default(cuid())
  albumId      String
  storageKey   String
  width        Int?
  height       Int?
  uploadedById String
  companyId    String   @default("company-emr")
  createdAt    DateTime @default(now())

  album      EventAlbum          @relation("AlbumPhotos", fields: [albumId], references: [id], onDelete: Cascade)
  coverOf    EventAlbum?         @relation("AlbumCover")
  uploadedBy User                @relation(fields: [uploadedById], references: [id])
  company    Company             @relation(fields: [companyId], references: [id])
  reactions  EventPhotoReaction[]
  comments   EventPhotoComment[]

  @@index([albumId, createdAt])
  @@index([companyId])
}

model EventPhotoReaction {
  id        String   @id @default(cuid())
  photoId   String
  userId    String
  emoji     String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  photo   EventPhoto @relation(fields: [photoId], references: [id], onDelete: Cascade)
  user    User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company    @relation(fields: [companyId], references: [id])

  @@unique([photoId, userId, emoji])
  @@index([photoId])
  @@index([companyId])
}

model EventPhotoComment {
  id        String   @id @default(cuid())
  photoId   String
  authorId  String
  body      String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  photo   EventPhoto @relation(fields: [photoId], references: [id], onDelete: Cascade)
  author  User       @relation(fields: [authorId], references: [id], onDelete: Cascade)
  company Company    @relation(fields: [companyId], references: [id])

  @@index([photoId, createdAt])
  @@index([companyId])
}
```

`User` e `Company` ganham os campos de relação inversa correspondentes (`eventAlbums`,
`eventPhotos`, `eventPhotoReactions`, `eventPhotoComments`) — o Prisma exige o outro lado.

`EventAlbum` ↔ `EventPhoto` fecha um ciclo de FK (álbum aponta a capa, foto aponta o álbum).
Postgres aceita, e as ações de exclusão não se cruzam: apagar o álbum cascateia as fotos;
apagar a foto-capa só anula `coverPhotoId`.

Migration nova via `pnpm db:migrate`. Nenhuma migration existente é tocada.

## Contrato (`packages/shared/src/event-album.ts`)

Tipos e constantes primeiro, os dois lados depois — é a única fonte de verdade do contrato.
Exportado no barril `index.ts`.

- `EventAlbumDTO` — `id`, `title`, `description`, `eventDate` (ISO ou `null`), `coverUrl`
  (já resolvida), `photoCount`, `createdAt`.
- `EventPhotoDTO` — `id`, `albumId`, `url`, `width`, `height`, `createdAt`,
  `reactions: EventPhotoReactionSummary[]`, `commentCount`.
- `EventPhotoReactionSummary` — `emoji`, `count`, `reactedByMe`, `reactors: ReactorRef[]`
  (mesma forma do mural, reusando `ReactorRef` de `review.ts`).
- `EventPhotoCommentDTO` — `id`, `photoId`, `author`, `body`, `createdAt`, `canDelete`.
- Requests — `CreateEventAlbumRequest`, `UpdateEventAlbumRequest`,
  `AddEventPhotosRequest` (`photos: { storageKey, width?, height? }[]`),
  `SetAlbumCoverRequest` (`photoId`), `CreateEventPhotoCommentRequest`.
- Constantes — `EVENT_PHOTO_MAX_BATCH = 20`, `EVENT_ALBUM_TITLE_MAX_LENGTH`,
  `EVENT_PHOTO_COMMENT_MAX_LENGTH`, `EVENT_PHOTO_REACTIONS = REVIEW_REACTIONS`.

Em `third-party.ts`: `'galeria'` em `COLLABORATOR_FEATURE_KEYS` e
`FEATURE_LABELS['galeria'] = 'Galeria de eventos'`.

## Storage

- `buildEventPhotoKey(companyId, contentType)` → `event-photos/<companyId>/<uuid>.<ext>`
  em `lib/s3-client.ts`. Prefixo próprio, como manuais e evidências têm o deles. A chave
  nasce **no servidor** — o cliente nunca escolhe onde o objeto é gravado.
- `POST /uploads/event-photos/presign` em `routes/image-uploads.ts`, sob a guarda de G&G,
  reusando `presignImageUpload`, `ALLOWED_IMAGE_CONTENT_TYPES` e `IMAGE_MAX_BYTES`. Tipo
  fora da lista → 400 `'Formato não suportado. Use JPEG, PNG, WebP ou GIF.'`; acima do
  limite → 400 `'Imagem muito grande (máx. 10MB).'`. Sem S3 configurado → 503.
- No web, `uploadEventPhoto(file)` em `lib/upload.ts`, seguindo `uploadImage`
  (valida → dimensões → presign → PUT direto no S3).

**Exclusão sem órfão.** O service coleta as `storageKey` **antes**, apaga álbum, fotos,
reações e comentários numa transação (com `recordAuditLog` dentro dela) e só então chama
`deleteS3Object` por chave. S3 não participa de transação: essa etapa é best-effort com
falha logada, como a avaliação de selos pós-voto. O banco nunca fica inconsistente; o pior
caso é um objeto sobrando no bucket, nunca uma foto fantasma na tela.

## Rotas (`apps/api/src/routes/event-albums.ts`)

Rota fina: Zod `safeParse` → `400 { message, issues }` → service → `serialize.ts`.
Registrada em `app.ts` (`buildApp`).

| Guarda | Endpoints |
| --- | --- |
| `[authenticate, requireFeature('galeria')]` | `GET /event-albums` · `GET /event-albums/:id` · `GET /event-albums/photos/:photoId/comments` · `POST`/`DELETE /event-albums/photos/:photoId/reactions` · `POST /event-albums/photos/:photoId/comments` · `DELETE /event-albums/comments/:id` |
| `[authenticate, requireSectorFeature('gente-gestao')]` | `POST /admin/event-albums` · `PATCH`/`DELETE /admin/event-albums/:id` · `POST /admin/event-albums/:id/photos` · `DELETE /admin/event-albums/:albumId/photos/:photoId` · `PATCH /admin/event-albums/:id/cover` |

Toda mutação de admin grava auditoria com `recordAuditLog` (`entityType: 'EventAlbum'`,
ação `CREATE` / `UPDATE` / `DELETE`), dentro da mesma transação quando houver.

## Service (`apps/api/src/services/event-album-service.ts`)

Regra de negócio inteira aqui; `scopedPrisma(companyId)` em toda leitura e escrita. Erros
de domínio em `EventAlbumError` com `status` HTTP, no padrão de `VoteError` — a rota faz
`instanceof` e responde com `err.status`.

- **Listagem sem N+1.** Uma query de álbuns (capa via `include`) e **um**
  `groupBy(['albumId'])` para as contagens. A URL da capa é montagem de string, sem I/O.
  20 álbuns = 2 queries, independente da quantidade. O portal contava fotos e assinava a
  capa álbum a álbum, em laço — é justamente o que não se repete aqui.
- **Reação idempotente.** `POST` cria e trata `P2002` como no-op, devolvendo o estado
  atual; `DELETE` remove. O front alterna escolhendo o verbo. Reagir duas vezes com o
  mesmo emoji não duplica nem se auto-desfaz por corrida de clique.
- **Comentário.** Autor apaga o próprio; ADMIN e SUBADMIN de G&G apagam qualquer um.
  `canDelete` no DTO para o front não oferecer o que a API vai negar.
- **Capa.** `setCover` recusa (400) `photoId` que não pertence ao álbum.

Serialização em `lib/serialize.ts`: `toEventAlbumDTO`, `toEventPhotoDTO`,
`toEventPhotoCommentDTO`.

## Web

- **`apps/web/src/pages/GalleryPage.tsx`** — grade de álbuns por `eventDate` decrescente
  (capa, título, contagem de fotos); álbum abre em grade de fotos; lightbox com navegação
  por seta e `Esc`, com painel de reações e comentários. Rota `/galeria` em `App.tsx` sob
  `FeatureGate feature="galeria"`; item no grupo *Cultura* de `components/nav-items.ts`
  com `feature: 'galeria'`.
- **`apps/web/src/pages/admin/EventAlbumsSection.tsx`** — CRUD do álbum, upload múltiplo
  com progresso e erro **por arquivo** (um arquivo recusado não derruba o lote), remoção
  de foto e definição de capa. Rota `/admin/galeria` sob
  `AdminSectorFeatureOnly feature="gente-gestao"`; item no grupo *Cultura* do
  `AdminSidebar.tsx` com `featureKey: 'gente-gestao'`.

Dados via React Query + `apiFetch`. Textos ao usuário em português.

## Testes

Vitest, colocados ao lado do arquivo.

**`packages/shared`** — `event-album.test.ts`: `'galeria'` presente em `FEATURE_KEYS` com
label, e `EVENT_PHOTO_MAX_BATCH` exportado.

**`apps/api`** (Postgres real; `pnpm db:up`, nesta máquina `LEGENDS_DB_PORT=5442`):

- Guardas — colaborador não escreve (403); SUBADMIN de setor sem `gente-gestao` toma 403;
  ADMIN global passa; sem feature `galeria` a leitura é negada.
- Upload — tipo fora do permitido e arquivo acima do limite recusados com a mensagem em
  português; lote acima de `EVENT_PHOTO_MAX_BATCH` → 400.
- Exclusão — apagar álbum remove fotos, reações e comentários do banco **e** chama
  `deleteS3Object` com cada chave (`vi.mock` de `../lib/s3-client`, como o precedente do
  PDI); nada fica órfão.
- Capa — apagar a foto-capa anula `coverPhotoId` e a grade cai no fallback; `photoId` de
  outro álbum → 400.
- Reação — dois `POST` com o mesmo `(foto, pessoa, emoji)` deixam uma linha só.
- Multi-empresa — álbum de outra empresa não aparece na listagem nem é acessível por id.
- N+1 — listar 20 álbuns dispara um número **constante** de queries.

**`apps/web`** — `GalleryPage.test.tsx` (grade, lightbox, reação otimista, comentário) e
`EventAlbumsSection.test.tsx` (upload em lote com progresso, remoção de foto, definição de
capa).

## Critérios de aceite

1. G&G cria álbum, sobe várias fotos de uma vez e define uma delas como capa.
2. Excluir o álbum remove as fotos do banco e os arquivos do storage — nada fica órfão.
3. Arquivo fora dos tipos permitidos ou acima do limite é recusado com mensagem em
   português.
4. Quem tem a feature `galeria` vê a galeria; só ADMIN e o SUBADMIN de G&G cria, edita ou
   exclui.
5. Reagir duas vezes com o mesmo emoji na mesma foto não duplica a reação.
6. Álbum de outra empresa nunca aparece na listagem.
7. Listar 20 álbuns não dispara consulta por álbum.
