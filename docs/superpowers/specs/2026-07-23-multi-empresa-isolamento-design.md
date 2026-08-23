# Multi-empresa: modelo de dados e isolamento no backend

**Data:** 2026-07-23
**Status:** aprovado para plano

## Contexto

O Legends hoje atende **uma única empresa**, internamente dividida em setores
([`Sector`](../specs/2026-07-22-setorizacao-empresa-design.md) — votação, categorias, badges,
squads e feature flags já são segmentados por setor). Para comercializar o produto para outras
empresas, precisamos de uma camada acima do setor — `Company` — de forma que cada empresa tenha
seus próprios setores, usuários, votações, categorias e badges, **sem nenhuma visibilidade ou ação
cross-empresa** por parte de usuários comuns ou admins.

Esta é a primeira de três fatias combinadas com o usuário:

1. **Esta spec** — modelo de dados (`Company`) + mecanismo de isolamento no backend.
2. Autenticação/login por empresa (JWT com `companyId`, wiring das rotas, admin escopado por
   empresa) — spec futura.
3. Front-end (contexto de empresa, telas) — spec futura.

## Não-objetivos

- **Wiring completo de auth/rotas**: o JWT ainda não vai carregar `companyId` nesta fatia; as
  rotas continuam obtendo o escopo do jeito que já fazem hoje. O objetivo aqui é a camada de
  dados + services aceitarem e respeitarem `companyId` como parâmetro explícito, de forma
  testável, para o wiring de auth (spec 2) só precisar plugar o valor certo.
- **Fluxo de criação de empresa** (self-service ou painel): fica para a spec de
  autenticação/admin. Nesta fatia, empresas são criadas via seed/migration apenas.
- **Isolar o escritório virtual, mural (Resenha), retro, notificações, feedback entre colegas,
  humor (`MoodEntry`), favoritos de personagem, convites de visitante e auditoria admin.**
  Nenhum desses models tem `sectorId` hoje (são globais mesmo antes desta spec, na mesma categoria
  do mural — ver addendum da spec de setorização). Continuam globais por enquanto; isolar por
  empresa é decisão consciente adiada para uma fase seguinte, quando uma segunda empresa real
  existir.
- **`AppSetting`, `OfficeSetting` e toda a família `OfficeMap*`**: continuam singletons globais,
  mesmo motivo acima.
- Múltiplas empresas por usuário (um email continua pertencendo a exatamente uma empresa).
- Papéis (`UserRole`) customizáveis por empresa: continuam fixos, só ganham o valor `SUPER_ADMIN`
  (ver abaixo).

## Modelo de dados

### `Company` (novo model)

```prisma
model Company {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  sectors    Sector[]
  users      User[]
  categories Category[]
  badges     Badge[]
}
```

Estrutura mínima, análoga ao `Sector` de hoje mas sem feature flags próprias — nenhuma
necessidade identificada ainda de comportamento habilitável por empresa (diferente de setor, que
já tem `enabledFeatures`).

### Propagação de `companyId`

Todo model que hoje é escopado (direta ou transitivamente) por `Sector` ganha uma coluna
`companyId` própria, **denormalizada** a partir do setor/empresa — evita que o mecanismo de
isolamento (ver abaixo) precise atravessar joins para saber a empresa de cada linha:

- `Sector.companyId` (fonte da verdade da relação setor → empresa)
- `User.companyId`
- `VotingPeriod.companyId`
- `Squad.companyId`
- `ThirdPartyInvite.companyId`
- `SectorRole` — sem coluna própria (ver "Join tables" abaixo)

`Category` e `Badge` **também ganham `companyId` direto**, deixando de ser um catálogo
compartilhado por toda a instância: hoje `global: true` significa "aplica a todos os setores desta
empresa"; cada empresa passa a ter seu próprio catálogo de categorias/badges, gerenciável
independentemente pelo admin daquela empresa. Isso é uma mudança de comportamento (hoje um
`Category.global` vale pra tudo, sem noção de empresa) necessária para o admin de uma empresa não
enxergar/editar o catálogo de outra.

### `User.email`

Continua `@unique` global (decisão já validada com o usuário) — sem mudança de constraint.

### `Badge.slug` — corrigido depois

`Badge` ganhou `companyId` aqui, mas o índice de `slug` ficou `@unique` global por descuido, o
que contradizia o "cada empresa passa a ter seu próprio catálogo" logo acima: o slug de uma
empresa bloqueava o da outra (409 "Já existe um selo com esse nome" entre inquilinos), e o
`destaque-do-mes` — que `publishHighlight` procura por slug — só podia existir uma vez na
instância inteira, então publicar destaque em qualquer empresa que não a primeira falhava com
500. Passou a ser `@@unique([companyId, slug])` na migration
`20260820160000_selo_unico_por_empresa`.

### `Sector.slug`, `Squad.name`, `Squad.slug` — mesma correção

Mesma herança e mesmo efeito: `createSector` recusava com 409 "Já existe um setor com esse nome"
e `createSquad` com 409 "Já existe uma squad com esse nome" um nome que só existia em **outra**
empresa — e "Engenharia" ou "Produto" é o primeiro setor que qualquer cliente novo cadastra.
Viraram `@@unique([companyId, …])` na migration
`20260820170000_setor_e_squad_unicos_por_empresa`.

Nenhum dos dois é buscado por slug em runtime (tudo é por `id`), então a mudança não teve efeito
fora do seed e dos testes. Vale a regra geral: **em model tenant-scoped, todo índice único de
nome/slug leva `companyId` junto** — `Company.slug` é a exceção legítima, porque é ele que
identifica o inquilino.

### Join tables (`SectorRole`, `CategorySector`, `BadgeSector`, `VoteCategory`, `SquadMember`)

Não ganham `companyId` próprio — ambos os lados de cada join já pertencem à mesma empresa por
construção (ex: `CategorySector` só liga uma `Category` e um `Sector` que já são da mesma
empresa). Essas tabelas **não são cobertas automaticamente** pela extensão de isolamento (ver
abaixo); a garantia vem do service layer, que ao criar o vínculo valida explicitamente que os dois
lados pertencem à mesma empresa (mesmo padrão de validação cruzada que já existe hoje entre
`Category`/`Sector`) — isso deve ser coberto por teste explícito de tentativa de vínculo
cross-empresa.

### `UserRole`: novo valor `SUPER_ADMIN`

```prisma
enum UserRole {
  LEGEND
  LEAD
  MANAGER
  HEAD
  ADMIN
  SUBADMIN
  THIRD_PARTY
  SUPER_ADMIN
}
```

`SUPER_ADMIN` é a equipe interna (dona do produto), com visibilidade cross-empresa para
suporte/gestão. Um `SUPER_ADMIN` ainda pertence a uma `Company` (a FK de `User.companyId`
continua `NOT NULL` — sem caso especial de usuário sem empresa), mas a uma empresa reservada e
interna, criada na mesma migration (`slug: "legends-internal"`). O que muda é que o código que lê
`request.user.role === 'SUPER_ADMIN'` tem permissão de usar o Prisma client **sem** a extensão de
escopo (ver abaixo) — isso ainda não tem nenhuma rota/endpoint nesta fatia; o objetivo aqui é só
o modelo já contemplar a existência do papel, para a spec de auth plugar os endpoints de gestão
de empresas em cima disso sem precisar de migration nova.

## Mecanismo de isolamento: Prisma Client Extension

Uma extensão (`$extends`) construída por chamada, parametrizada por `companyId`, que injeta
automaticamente o filtro/valor de `companyId` nas operações dos models tenant-aware:

```ts
// apps/api/src/lib/tenant-scope.ts
const TENANT_SCOPED_MODELS = new Set([
  'Sector', 'User', 'VotingPeriod', 'Vote', 'Squad',
  'ThirdPartyInvite', 'Category', 'Badge',
])

export function scopedPrisma(companyId: string) {
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED_MODELS.has(model)) return query(args)
          return query(applyCompanyScope(operation, args, companyId))
        },
      },
    },
  })
}
```

`applyCompanyScope` injeta `where: { ..., companyId }` em leituras/updates/deletes e
`data: { ..., companyId }` em creates (recusando sobrescrever um `companyId` diferente, se um
service tentar passar um explicitamente — erro, não silenciosamente ignorado).

`Vote` entra na allowlist mesmo sem coluna própria de `companyId` planejada — nesta fatia
`Vote` **ganha** `companyId` direto também (junto de `VotingPeriod`), já que é o model mais
sensível a vazamento (dado de voto de uma empresa não pode aparecer em cálculo de vencedor de
outra) e se beneficia do mesmo mecanismo direto sem depender de join até `VotingPeriod`.

### Como os services usam isso

Nesta fatia, **services que hoje recebem `sectorId` como parâmetro passam a também receber
`companyId`**, e usam `scopedPrisma(companyId)` no lugar do client singleton para toda operação
sobre um model da allowlist. O wiring de onde o `companyId` vem (JWT, request) é o escopo da
spec seguinte — aqui o objetivo é a assinatura e o comportamento do service já exigirem e
respeitarem esse parâmetro, com teste garantindo que é impossível chamar o service sem ele ou
com um valor que não bate com as entidades envolvidas.

### `SUPER_ADMIN` / operações cross-empresa

Endpoints cross-empresa (ainda não construídos nesta fatia) usam o `prisma` singleton **sem**
a extensão, explicitamente, e só quando `request.user.role === 'SUPER_ADMIN'` — sem meio-termo:
não existe um "modo parcialmente escopado". Essa checagem de papel é responsabilidade da rota,
não da extensão.

### SQL raw

Qualquer uso de `$queryRaw`/`$executeRaw` (auditar se existe algum no repo) não é coberto pela
extensão — precisa de filtro manual de `companyId`, sinalizado explicitamente no código
(comentário citando esta spec) para não passar despercebido em revisão futura.

## Migração

Sequência de migrations (Prisma), sem editar nenhuma já aplicada:

1. Cria `Company`; insere duas linhas: a empresa padrão (`slug: "emr"`, `name: "EMR"` — mesma
   organização que já opera a instância atual) e a empresa interna (`slug: "legends-internal"`,
   `name: "Legends Internal"`) para `SUPER_ADMIN`.
2. Adiciona `companyId` (nullable) em `Sector`, `User`, `VotingPeriod`, `Vote`, `Squad`,
   `ThirdPartyInvite`, `Category`, `Badge`; backfill de **todos** os registros existentes para a
   empresa padrão (`emr`).
3. Migration seguinte: torna as colunas `NOT NULL`.
4. Adiciona `SUPER_ADMIN` ao enum `UserRole` (migration separada, sem necessidade de backfill —
   nenhum usuário existente usa esse valor ainda).

Backfill roda dentro da própria migration (SQL gerado + `UPDATE` explícito), seguindo o mesmo
padrão usado na migration de `Sector` (`sectorId` nullable → backfill → `NOT NULL`).

## Testes

Seguindo a convenção do repo (Vitest colocado ao lado do código, Postgres real para a API):

- `apps/api/src/lib/tenant-scope.test.ts` (novo) — a extensão nunca retorna/atualiza/apaga linha
  de `companyId` diferente do escopo, para cada model da allowlist; tentativa de `create` com
  `companyId` divergente do escopo lança erro em vez de ser ignorada silenciosamente.
- Para cada service que passa a exigir `companyId` (votação, setores, squads, terceirizados,
  categorias, badges): teste criando duas empresas com dados equivalentes (ex: mesmo `monthRef`
  em `VotingPeriod` de setores de empresas diferentes) e garantindo que uma operação escopada
  para a empresa A nunca lê/edita/apaga dado da empresa B — incluindo tentativas adversariais
  (passar um id de entidade que pertence à empresa errada).
- Join tables (`CategorySector`, `BadgeSector`, etc.): teste que a criação de um vínculo entre
  entidades de empresas diferentes é rejeitada explicitamente pelo service.
- Teste de migração/backfill: dados existentes ficam 100% associados à empresa padrão, nada
  quebra.

## Riscos / pontos de atenção

- **Inventário exaustivo**: o plano precisa enumerar, model por model, todos os que hoje
  dependem de `sectorId` (direto ou via relação) para garantir que nenhum ficou de fora da lista
  desta fatia (`Sector`, `User`, `VotingPeriod`, `Vote`, `Squad`, `ThirdPartyInvite`, `Category`,
  `Badge` + as join tables). Qualquer novo model tenant-scoped criado depois desta spec precisa
  ser adicionado manualmente à allowlist da extensão — não há enforcement automático de
  "todo model com `companyId` entra na allowlist"; é uma lista mantida à mão.
- **Todos os call-sites do `prisma` singleton** que hoje operam sobre um model da allowlist
  precisam migrar para `scopedPrisma(companyId)` — levantamento rota por rota / service por
  service fica para o plano, igual foi feito nas duas fatias anteriores de setorização.
  Qualquer chamada esquecida usando o client singleton diretamente **não tem isolamento** (a
  extensão só existe quando alguém constrói o client escopado) — esse é o principal risco de
  regressão de segurança desta mudança.
- **`Category`/`Badge` deixarem de ser globais pra virarem por-empresa** é a mudança de
  comportamento mais visível: hoje existe um catálogo único; a migration duplica esse catálogo
  como pertencente à empresa padrão, e qualquer empresa nova nasce sem categorias/badges (a menos
  que o plano decida clonar um catálogo-base na criação de empresa — decisão a tomar no plano,
  não nesta spec, já que criação de empresa é não-objetivo aqui).
- **Escopo deliberadamente incompleto**: ao final desta fatia, o sistema tem isolamento real para
  setor/usuário/votação/categoria/badge/squad/terceirizados, mas **não** para escritório, mural,
  retro, notificações, feedback, humor e afins — que continuam compartilhados entre todas as
  empresas até uma fase futura decidir o contrário. Isso deve ficar visível para quem for testar
  "isolamento total" nesta entrega: é isolamento parcial por design, não um bug.
