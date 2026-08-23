# Categorias e Selos: globais ou específicos de setor(es)

**Data:** 2026-07-23
**Status:** aprovado para plano

## Contexto

Hoje `Category` e `Badge` são entidades globais únicas: toda categoria ativa aparece pra qualquer colaborador votar, e todo selo é avaliado/exibido pra qualquer usuário, independente do setor. Com a setorização já em produção (setores com features/papéis próprios, períodos de votação independentes), um setor pode precisar de uma categoria de reconhecimento ou de um selo que não faz sentido pra outros — sem deixar de compartilhar a maioria das categorias/selos entre todos.

## Modelo de dados

`Category` e `Badge` ganham um campo `global: Boolean @default(true)` e uma tabela de junção cada, para representar associação com **um ou mais** setores específicos (não um único setor, como em `Squad`):

```prisma
model Category {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  description String?
  active      Boolean  @default(true)
  isSpecial   Boolean  @default(false)
  global      Boolean  @default(true)
  createdAt   DateTime @default(now())

  voteCategories VoteCategory[]
  sectors        CategorySector[]
}

model CategorySector {
  categoryId String
  sectorId   String
  category Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  sector   Sector   @relation(fields: [sectorId], references: [id], onDelete: Cascade)
  @@id([categoryId, sectorId])
}

model Badge {
  id           String    @id @default(cuid())
  slug         String    @unique
  name         String
  description  String
  kind         BadgeKind
  iconKey      String
  threshold    Int       @default(0)
  categorySlug String?
  global       Boolean   @default(true)

  awarded UserBadge[]
  sectors BadgeSector[]
}

model BadgeSector {
  badgeId  String
  sectorId String
  badge  Badge  @relation(fields: [badgeId], references: [id], onDelete: Cascade)
  sector Sector @relation(fields: [sectorId], references: [id], onDelete: Cascade)
  @@id([badgeId, sectorId])
}
```

`Sector` ganha as relações inversas `categorySectors CategorySector[]` e `badgeSectors BadgeSector[]`.

- `global = true`: visível/avaliado para todos os setores. A lista de setores associados é ignorada (nem precisa ter linhas em `CategorySector`/`BadgeSector`).
- `global = false`: visível/avaliado só para quem estiver num dos setores listados na tabela de junção. Uma lista vazia é um estado válido (rascunho "ainda não atribuído a nenhum setor" — fica invisível pra todo mundo até o admin associar pelo menos um).

**Migração:** `global` nasce com `@default(true)`, então toda categoria/selo já existente vira global automaticamente — nenhuma linha precisa de backfill manual, e o comportamento atual (todo mundo vê tudo) não muda para quem já usa o sistema hoje.

## Onde isso muda o comportamento

**Votação — `GET /categories`:** hoje devolve toda categoria `active`, sem filtro algum. Passa a devolver `active` **e** (`global = true` **ou** associada, via `CategorySector`, ao setor do usuário autenticado). O setor de referência é sempre o do usuário que está chamando a rota (votante e candidato já são do mesmo setor, pela regra que a setorização impõe às votações).

**Selos — catálogo (`GET /badges`) e avaliação automática (`evaluateBadgesForUser`, `apps/api/src/services/badge-service.ts`):** mesma lógica de conjunto efetivo. `evaluateBadgesForUser` hoje busca `prisma.badge.findMany()` (todos) e testa cada um contra o usuário; passa a buscar só "globais ou associados ao setor do usuário" antes de testar. Selos de tenure (`evaluateTenureBadgesForUser`) e o catálogo exibido (`getBadgeCatalog`) seguem a mesma regra. Selos já concedidos (`UserBadge`) **nunca são revogados** por uma mudança de escopo posterior — histórico é imutável, só o catálogo futuro muda.

**Nota de coerência, não travada por validação:** um selo `kind: CATEGORY` referencia uma categoria por `categorySlug` para contar votos. Se o admin criar um selo específico de um setor que aponta pra uma categoria de outro setor (ou global só nesse ponto), o selo nunca será conquistado por ninguém do setor errado. Fica como responsabilidade do admin ao configurar — mesmo espírito de outras combinações hoje já possíveis de montar incorretamente (ex.: threshold em uma categoria desativada). Não é adicionada nenhuma trava nova para este caso.

**Admin (`GET/POST/PATCH /admin/categories`, `/admin/badges`):** o admin continua vendo e gerenciando tudo, sem filtro. `POST`/`PATCH` passam a aceitar `global?: boolean` e `sectorIds?: string[]` (a lista só é significativa quando `global = false`); o create/update dessas duas entidades — hoje já implementado inline nas rotas de `admin.ts`, sem service dedicado — passa a rodar dentro de um `prisma.$transaction`, igual ao padrão já usado em `DELETE /admin/badges/:id`: grava os campos escalares e, se `global = false`, substitui as linhas da tabela de junção pelo novo conjunto (se `global = true`, remove qualquer linha residual — mantém o invariante "global implica zero linhas na junção"). O log de auditoria (já existente para `Category`/`Badge`) passa a incluir `sectorIds` no payload gravado, não só os campos escalares — o record bruto do Prisma não carrega a relação automaticamente, então o `before`/`after` passado a `recordAuditLog` precisa compor esse array explicitamente.

**DTOs (`@legends/shared`):** `CategoryDTO` e `BadgeDTO` ganham `global: boolean` e `sectorIds: string[]`.

## Tela do admin (Categorias e Selos)

**Formulário de criar/editar:** ganha um checkbox **"Global"** (marcado por padrão). Quando desmarcado, aparece uma lista de checkboxes com os setores existentes — mesmo padrão visual que `SectorsSection`/`ThirdPartySection` já usam para habilitar features/papéis por setor (`FeatureChecklist`/`RoleChecklist`) — o admin marca um ou mais setores.

**Lista/organização:** como um item específico pode pertencer a mais de um setor ao mesmo tempo, a lógica de agrupamento usada em Lendas/Squads (`groupBySector`, onde cada item pertence a exatamente um grupo) não se aplica diretamente. Um helper novo, `groupBySectorMulti` (ao lado do `groupBySector` já existente em `apps/web/src/pages/admin/shared.tsx`):

- Sempre gera um grupo **"Global"** primeiro, com todo item `global = true`.
- Depois um grupo por setor (ordem alfabética), cada um contendo os itens `global = false` associados àquele setor — um item específico de dois setores aparece nos dois acordeões correspondentes.

Cada grupo continua sendo um acordeão recolhido por padrão, reaproveitando o componente `SectorAccordion` já existente (mesmo padrão criado nesta sessão para Lendas e Squads).

## Testes

Seguindo a convenção do repo (Vitest colocado ao lado do código; API testa contra Postgres real):

- Rotas públicas: `GET /categories` só devolve globais + as do setor do usuário (dois setores, duas categorias específicas diferentes, prova isolamento). `GET /badges` idem para o catálogo.
- `evaluateBadgesForUser`/`evaluateTenureBadgesForUser`: um selo específico de outro setor não é avaliado/concedido; um selo global continua sendo.
- Admin: criar/editar categoria e selo com `global: false` + `sectorIds`; trocar de global para específico e vice-versa (limpa a junção corretamente); log de auditoria contém `sectorIds` no `before`/`after`.
- Frontend: `groupBySectorMulti` — item global cai só no grupo Global; item de dois setores aparece nos dois acordeões; formulário mostra/esconde a lista de setores conforme o checkbox "Global".

## Fora de escopo

- Não valida a coerência entre o setor de um selo `CATEGORY` e o setor da categoria que ele referencia (nota acima).
- Não adiciona um `sectorId` de filtro em `GET /admin/categories`/`GET /admin/badges` — admin sempre vê a lista completa (mesmo padrão de Lendas/Squads, agrupamento é só de exibição).
- Não migra dados existentes para "específico" — toda categoria/selo já cadastrado permanece `global = true` após a migration.
