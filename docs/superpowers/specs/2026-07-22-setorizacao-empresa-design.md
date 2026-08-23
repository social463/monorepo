# Setorização da empresa: setores, alocação, papéis e feature flags

**Data:** 2026-07-22
**Status:** aprovado para plano

## Contexto

Hoje o Legends atende um único setor da empresa (desenvolvimento de produto), internamente
dividido entre engenharia e produto via `User.area` (enum `ENGINEERING`/`PRODUCT`, usado só para o
manager ver o humor da própria área — `squad-mood-service.ts`). Precisamos escalar para o
organograma inteiro da empresa: o admin cria setores, aloca pessoas neles, decide quais
funcionalidades cada setor enxerga e quais papéis (roles) existem em cada setor. O escritório
virtual é uma funcionalidade conjunta (compartilhada entre todos os setores); a votação do Destaque
do Mês passa a ser segmentada — cada setor vota e elege seu próprio Destaque, com sua própria
janela de abertura/fechamento.

Já existe hoje um mecanismo parecido: `User.enabledFeatures` / `ThirdPartyInvite.enabledFeatures`
(feature flag por conta, mas só tem efeito para `role = THIRD_PARTY`; ver
`docs/superpowers/specs/2026-07-20-terceirizados-design.md`). Este spec generaliza esse catálogo de
features para ser aplicado por setor, e não muda o comportamento hoje existente de terceirizados
(continuam com allowlist individual via convite, independente do setor).

## Não-objetivos

- Qualquer noção de "funcionalidade global cross-setor" além do já decidido aqui (uma feature pode
  nascer habilitada por padrão em todo setor novo, caso do escritório — não há um flag especial de
  "global" no modelo, é só o valor default do checklist).
- Usuário alocado em mais de um setor simultaneamente (fica para um spec futuro, se surgir a
  necessidade).
- Papéis (roles) totalmente customizáveis por setor — continuam sendo os 6 valores fixos de
  `UserRole`; o setor só restringe quais deles aparecem como opção ao alocar alguém nele. Nenhuma
  checagem de permissão hoje existente (`role === 'ADMIN'`, `isLeaderRole`, etc.) muda de
  comportamento.
- Migração de `Area` (engenharia/produto) para squads reais — `Area` continua exatamente como está,
  como um metadado dentro do setor.
- Granularidade fina de permissão dentro do painel admin (hoje é tudo-ou-nada por `requireAdmin`) —
  fora de escopo.

## Modelo de dados

### `Sector` (novo model)

```prisma
model Sector {
  id              String   @id @default(cuid())
  name            String
  slug            String   @unique
  active          Boolean  @default(true)
  enabledFeatures Json     @default("[]")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  users         User[]
  roles         SectorRole[]
  votingPeriods VotingPeriod[]
}
```

`enabledFeatures` segue o mesmo formato de `User.enabledFeatures`: array de chaves do catálogo de
features (ver abaixo). Todo setor novo nasce com `escritorio` no array por padrão (funcionalidade
conjunta); as demais chaves o admin decide ao criar/editar o setor.

### `SectorRole` (novo model, join)

```prisma
model SectorRole {
  sectorId String
  role     UserRole

  sector Sector @relation(fields: [sectorId], references: [id], onDelete: Cascade)

  @@id([sectorId, role])
}
```

Existência da linha (`sectorId`, `role`) = esse papel aparece como opção no dropdown de alocação de
usuários daquele setor. Não é lido em nenhuma checagem de permissão — é curadoria de UI do admin.

### `User.sectorId`

Nova coluna `sectorId String` (FK para `Sector`, obrigatória após o backfill — ver Migração).
`squad` (texto livre) e `area` continuam exatamente como estão hoje, sem relação com `Sector`.

### `VotingPeriod.sectorId`

Nova coluna `sectorId String` (FK para `Sector`, obrigatória). A constraint única passa de
`monthRef @unique` para `@@unique([sectorId, monthRef])` — cada setor tem seu próprio calendário de
períodos, aberto/fechado independentemente pelo admin. `Vote` não muda de schema (continua
apontando para `VotingPeriod`), mas `voting-service.ts` passa a validar que `voter` e `voted`
pertencem ao mesmo `sectorId` do período; caso contrário, `VoteError` 400 ("Você só pode votar em
colegas do seu setor.").

### Catálogo de features (`@legends/shared`)

Renomeia `THIRD_PARTY_FEATURE_KEYS`/`THIRD_PARTY_FEATURE_LABELS` (`packages/shared/src/third-party.ts`)
para `FEATURE_KEYS`/`FEATURE_LABELS` — mesmo conteúdo, mesmo arquivo, usado agora tanto por
`ThirdPartyInvite`/`User.enabledFeatures` quanto por `Sector.enabledFeatures`. Nenhuma chave nova
adicionada nesta fatia.

## Backend

### Gate de acesso (`app.ts`)

`requireFeature(key)` generalizado:

- `role === 'ADMIN'` → sempre passa (admin enxerga tudo, sector-agnostic).
- `role === 'THIRD_PARTY'` → comportamento inalterado: checa contra `request.user.features` (a
  allowlist individual do convite), sector-agnostic.
- Demais roles (`LEGEND`/`LEAD`/`MANAGER`/`HEAD`) → checa contra as `enabledFeatures` do setor do
  usuário.

JWT (`lib/jwt.ts`) passa a embutir `sectorId` e as `features` efetivas do setor também para roles
não-`THIRD_PARTY` (hoje só embute `features` para `THIRD_PARTY`), para o gate não bater no banco a
cada request. Mudança de `enabledFeatures` do setor reflete no próximo refresh (janela de 15 min do
access token — mesma latência que já existe hoje para mudança de `role`).

### Rotas admin (`admin.ts`)

- `GET/POST/PATCH /admin/sectors` — CRUD de setor (nome, slug, active, enabledFeatures, roles
  habilitados). Exclusão bloqueada se houver usuário ou `VotingPeriod` associado (mesmo padrão de
  proteção usado em `Category`/`Squad` hoje).
- `POST /admin/users`, `PATCH /admin/users/:id` — passam a exigir/aceitar `sectorId`; validação
  garante que o `role` enviado está entre os habilitados (`SectorRole`) para aquele setor.
- `POST /admin/periods` — passa a exigir `sectorId`; listagem de períodos filtra por setor.
- `/admin/third-party-users` — ganha `sectorId` também (terceirizados são alocados a um setor como
  qualquer outra conta, mas seu acesso a features continua vindo do allowlist individual, não do
  setor).

### `voting-service.ts`

Elegibilidade de voto (`voter`/`voted` precisam ser `LEGEND` do mesmo setor do período) e cálculo do
vencedor do mês passam a ser escopados por `sectorId` do período — sem mudança na regra de negócio
em si (1 voto por período por votante, justificativa obrigatória), só no escopo do pool.

## Frontend

### Admin

- Nova aba "Setores" (`SectorsSection.tsx`), reaproveitando o padrão de `FeatureChecklist` de
  `ThirdPartySection.tsx` para o checklist de features, mais um checklist dos 6 papéis
  (`SectorRole`).
- `CollaboratorsSection.tsx` e `ThirdPartySection.tsx` ganham seletor de setor obrigatório
  (create/edit); o dropdown de `role` filtra pelas roles habilitadas no setor selecionado.
- `PeriodsSection.tsx` ganha seletor/abas de setor — cada setor tem sua própria lista de períodos,
  abertura e fechamento independentes.

### Área logada

- `PublicUser` (`@legends/shared`) ganha `sectorId` e as `enabledFeatures` efetivas do setor
  (calculadas no backend, não recalculadas no cliente).
- `buildNavItems` (`nav-items.ts`) deixa de filtrar só quando `role === 'THIRD_PARTY'` — passa a
  usar as `enabledFeatures` efetivas (do setor, ou do allowlist individual para terceirizados) para
  qualquer role exceto `ADMIN`.
- `FeatureGate` (`App.tsx`) mesma generalização: bloqueia por feature ausente para qualquer role
  não-admin, não só terceirizados.
- Tela de votação (`/votar`) e Destaques (`/destaques`) já herdam o escopo por setor via API (o
  backend só retorna candidatos/vencedor do setor do usuário logado) — sem necessidade de UI nova
  além do que já existe.

## Migração

Sequência de migrations (Prisma), sem editar nenhuma já aplicada:

1. Cria `Sector` e `SectorRole`; insere um setor default `"Desenvolvimento de Produto"`
   (`slug: "desenvolvimento-de-produto"`) com `enabledFeatures` = catálogo completo (todas as
   chaves, incluindo `escritorio`) e `SectorRole` para os 6 papéis — replica 1:1 o comportamento
   atual (ninguém perde acesso a nada).
2. Adiciona `User.sectorId` e `VotingPeriod.sectorId` como colunas nullable; backfill de todos os
   registros existentes para o setor default.
3. Migration seguinte: torna as duas colunas `NOT NULL` e troca a unique constraint de
   `VotingPeriod` (`monthRef` → `[sectorId, monthRef]`).

## Testes

Seguindo a convenção do repo (Vitest colocado ao lado do código, Postgres real para a API):

- `apps/api/src/services/sector-service.test.ts` (novo) — CRUD, proteção contra exclusão com
  vínculos, validação de `SectorRole`.
- `apps/api/src/routes/admin.test.ts` — extensão para `/admin/sectors`, `sectorId` obrigatório em
  create/update de usuário e período.
- `apps/api/src/services/voting-service.test.ts` — extensão: voto cross-setor rejeitado, vencedor
  calculado por setor, dois setores com períodos e vencedores independentes no mesmo `monthRef`.
- `apps/api/src/app.test.ts` (ou próximo a uma rota gated) — `requireFeature` generalizado para
  roles não-`THIRD_PARTY`.
- `apps/web/src/components/nav-items.test.ts` — filtragem por `enabledFeatures` efetivas para
  qualquer role não-admin.
- `apps/web/src/pages/admin/SectorsSection.test.tsx` (novo, se a convenção de teste de página for
  seguida nas seções vizinhas).

## Riscos / pontos de atenção

- Levantar, rota por rota, quais hoje não fazem nenhum gate de feature para roles não-terceirizadas
  (a generalização do `requireFeature` muda esse comportamento de "libera geral" para "gated pelo
  setor") — mapeamento fino fica para o plano, igual foi feito para terceirizados.
- WebSocket do escritório (`office-ws.ts`) já checa `escritorio` manualmente para `THIRD_PARTY`;
  como todo setor nasce com `escritorio` habilitado por padrão, o caso comum não deveria travar
  ninguém, mas a checagem ali precisa ser estendida para o setor também (mesmo padrão de risco já
  registrado na spec de terceirizados).
- Backfill de `VotingPeriod.sectorId`: hoje `monthRef` é único globalmente; ao setar todos os
  períodos existentes para o setor default, a constraint `[sectorId, monthRef]` continua satisfeita
  (não há duplicidade), mas vale conferir dado real antes de aplicar a migration em produção.
- Desalocar um usuário do setor default para outro setor no meio de um período de votação aberto:
  decidir no plano se isso é permitido livremente ou se exige o período fechado (evitar voto
  "atravessado" entre setores no mesmo mês).

## Addendum (pós-implementação): mural continua global — decisão consciente

A revisão final do branch (depois da implementação completa) encontrou que o mural da Home
(`GET /mural` — feedbacks, selos, humor e resenhas compartilhadas agregados de todo mundo) **não**
é filtrado por setor, diferente de `/votar`, `/lendas`, `/destaques` e das notificações de período
(essas sim escopadas, ver Task 11 do plano). Diferente daquelas quatro superfícies, o mural nunca
foi prometido como segmentado nesta spec — e a decisão consciente, tomada nesta revisão, foi
**deixá-lo global por enquanto**, no mesmo espírito do escritório virtual (funcionalidade conjunta).
Sem impacto na produção atual (só existe o setor default). Vira pauta de uma spec futura quando um
segundo setor real for criado — nesse momento, decidir explicitamente se o mural passa a ser
por-setor (mesmo padrão das outras quatro: filtrar `getMuralItems` por `sectorId` do viewer) ou se
permanece deliberadamente global.
