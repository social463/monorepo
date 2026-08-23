# Desafios — CRUD de administração e vitrine

**Data:** 2026-08-01
**Origem:** portal EMR, `/app/admin/desafios` (`src/routes/app.admin.desafios.tsx`)
**PBI dependente:** Resultados de Desafios (fila de submissões) — fora deste escopo

## Problema

O Legends reconhece o que **já aconteceu**: voto, selo, destaque. Não existe forma de
**propor uma ação** — "participe do desafio de bem-estar desta semana". Falta a peça que
cria a missão e a recompensa atrelada a ela.

## Escopo

Entra:

- CRUD de desafio com categoria, imagem, descrição rica, ordem e visibilidade.
- Recompensa por desafio em coins.
- Flags: ativo, exige moderação, privado, em destaque.
- Vitrine: lista de desafios ativos para a pessoa, com detalhe e botão de participar
  (a participação em si — `createSubmission` — já existe na base).

Não entra:

- Fila de submissões e aprovação (PBI "Resultados de Desafios").
- Loja de produtos e pontos por eixo (ver *Decisões*, D2).

## Base: esta branch nasce de `feat-resultados-desafios-fila`

O PBI de submissões — que na descrição *depende* deste — já implementou o model
`Challenge`, o contrato compartilhado e o CRUD de admin no service. A branch é **local,
sem push**, e por isso invisível em `git branch -r` e em qualquer listagem de PR.

O que já existe na base:

| Peça | Estado |
| --- | --- |
| `model Challenge` + `model ChallengeSubmission` | migration `20260801150159_add_challenges` |
| `packages/shared/src/challenge.ts` | contrato de desafio e submissão |
| `challenge-service.ts` | `createChallenge`, `updateChallenge`, `deleteChallenge`, `listChallengesForAdmin`, `listMyChallenges`, `createSubmission`, escopo por setor |
| `coin-service.awardFixedCoins` | crédito de valor explícito no razão |
| `tenant-scope.ts` | models registrados |

O que **não** existe e é o trabalho desta branch: rotas, web, auditoria, e os campos de
catálogo (categoria, imagem, ordem, flags de visibilidade).

Construir o brief a partir de `origin/main` criaria a mesma tabela em duas migrations e
disputaria `challenge.ts` e `challenge-service.ts` — colisão garantida no merge, além de
reimplementar um CRUD que já passa nos testes.

## Modelo de dados

Uma migration **aditiva** sobre a base.

### `Challenge` — alterações

```prisma
model Challenge {
  // … campos existentes: id, title, description, rewardCoins, startsAt, endsAt,
  //    sectorId, companyId, createdById, createdAt, updatedAt

  isActive        Boolean @default(true)   // renomeado de `active`
  category        String                    // ver CHALLENGE_CATEGORIES
  detailsMarkdown String?                   // corpo longo em Markdown
  imageKey        String?                   // chave do S3, nunca a URL
  position        Int     @default(0)
  requiresReview  Boolean @default(true)
  isPrivate       Boolean @default(false)
  isFeatured      Boolean @default(false)

  @@index([companyId, isActive, position])
}
```

`active` → `isActive`: booleano chamado `status`/`active` é armadilha de leitura no call
site (`if (challenge.active)` não diz *ativo o quê*). A renomeação alcança o
`orderBy` de `listChallengesForAdmin` e os testes da base.

### Sem `ChallengeReward`

A recompensa é só `rewardCoins`, coluna que já existe em `Challenge`.

Uma tabela 1:1 guardando um único inteiro custa um join em toda leitura e uma transação
em toda escrita, sem nada em troca. Pior: o caminho de aprovação da base já lê
`challenge.rewardCoins` para creditar o razão, então extrair a coluna obrigaria a
refatorar código que funciona e tem teste.

**Consequência no critério de aceite.** "Criar desafio com recompensa grava os dois de
forma atômica: falha na recompensa não deixa desafio órfão" deixa de ter objeto — com uma
coluna não há segunda escrita que possa falhar. O critério é satisfeito **por
construção**, não por transação. Registrado aqui para não passar por requisito omitido.

## Contrato (`packages/shared/src/challenge.ts`)

Estende o arquivo da base; não cria um novo.

```ts
export const CHALLENGE_CATEGORIES = [
  'Cultura', 'Bem-estar', 'Inovação', 'Sustentabilidade',
  'Conhecimento', 'Engajamento', 'Especial',
] as const
export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number]
```

Categoria é `String` no Prisma, validada por um Zod enum derivado da const compartilhada.
Categoria fora da lista → **400**. Enum do Prisma foi descartado de propósito: incluir uma
categoria viraria migration, e o valor é catálogo de produto, não invariante do banco.

`is_special` do portal não vem: "Especial" é **categoria**, não flag.

`ChallengeDTO` ganha `category`, `detailsMarkdown`, `imageUrl` (derivada de `imageKey`),
`position`, `requiresReview`, `isPrivate`, `isFeatured`, e `active` vira `isActive`.

## Texto rico: Markdown, não HTML

`detailsMarkdown` renderizado pelo `apps/web/src/components/Markdown.tsx` que já existe:
subset fechado de Markdown convertido em **elementos React**, sem
`dangerouslySetInnerHTML` no caminho do conteúdo e sem dependência de sanitizador.

É a convenção declarada do repo — `culture.ts`: *"nada de HTML cru vindo do banco"*.

Critério "HTML com `<script>` no detalhe é sanitizado e nunca executa" fica satisfeito por
construção: o que o parser não reconhece vira **texto**. Não existe sanitizador para
errar, nem allowlist para furar.

## Visibilidade

Vitrine da pessoa mostra o desafio quando:

```
isActive && !isPrivate && dentro da janela && (sectorId == null || sectorId == setor da pessoa)
```

`isPrivate` significa **não listado**: some da vitrine, mas o endpoint de detalhe continua
servindo para quem está no escopo, de modo que um link compartilhado funciona. A leitura
alternativa — privado = inacessível — deixaria a flag quase redundante com `isActive`.

`requiresReview` é **persistido e exposto, sem comportamento nesta branch**: auto-aprovar
submissão é comportamento de submissão, que está fora do escopo. A semântica fica
documentada para o PBI da fila consumir.

Janela `startsAt`/`endsAt` da base é mantida. O brief não pedia janela, mas ela existe,
funciona e tem teste; `isActive` é a chave manual sobreposta a ela.

## Camadas

### Service (`challenge-service.ts`, estendido)

- `createChallenge` / `updateChallenge` passam a aceitar os campos novos.
- `reorderChallenges(actor, ids[])` — uma transação, respeitando o escopo de setor.
- **Auditoria** via `recordAuditLog` em toda mutação de admin, na mesma transação. A base
  não registra auditoria hoje; entra junto.
- Escopo de setor reaproveita `assertCanManageChallenge` e `ChallengeSectorForbiddenError`
  que já existem: SUBADMIN só gerencia o próprio `sectorId`, ADMIN escolhe por filtro.

### Rotas

- `routes/challenges.ts` — vitrine, `onRequest: [app.authenticate]`.
- `routes/admin-challenges.ts` — `onRequest: [app.authenticate, app.requireAdminOrSubadmin]`.

Rota fina: `safeParse` → `400 { message, issues }`, chama o service, serializa. Erro de
domínio é classe tipada com `status`; a rota faz `instanceof`.

### Imagem

Presign pelo `routes/image-uploads.ts` que já existe. Guarda-se a **chave**; o DTO expõe
`imageUrl` derivada.

### Feature gate

Chave `'desafios'` em `FEATURE_KEYS` e rótulo em `FEATURE_LABELS`
(`packages/shared/src/third-party.ts`).

### Web

- `pages/admin/ChallengesSection.tsx` — lista, editor, reordenação.
- `pages/ChallengesPage.tsx` — vitrine com detalhe e botão de participar.

Rota aninhada em `App.tsx` sob `/admin`, item no `AdminSidebar.tsx`, dados via React Query
+ `apiFetch`.

## Testes

Vitest ao lado do arquivo. API contra Postgres real (`pnpm db:up`; nesta máquina
`LEGENDS_DB_PORT=5442`).

Cobertura por critério de aceite:

| Critério | Onde |
| --- | --- |
| Desafio inativo ou privado não aparece na vitrine | `challenge-service.test.ts` |
| Reordenar altera a ordem da vitrine | `challenge-service.test.ts` |
| Categoria fora da lista → 400 | `admin-challenges.test.ts` (categoria é escrita pelo admin) |
| `<script>` no detalhe nunca executa | `Markdown.test.tsx` (já coberto) + teste da vitrine |
| Só admin/subadmin cria e edita; resto 403 | `admin-challenges.test.ts` |
| SUBADMIN restrito ao próprio setor | `challenge-service.test.ts` (base já cobre; estender) |

## Decisões

**D1 — Base em `feat-resultados-desafios-fila`, não em `origin/main`.**
Evita colisão de tabela, de contrato e de service. Custo: esta branch só mergeia depois
daquela.

**D2 — Recompensa só em coins.**
Não existe loja nem sistema de pontos por eixo no Legends. `EMR Coins` é razão
append-only (`CoinRule`, `CoinTransaction`), sem catálogo de produto e sem resgate.
`fitPoints`/`ecoPoints`/`knowledgePoints`/`culturePoints` e `productId` seriam colunas que
nada lê, escreve ou valida — e o critério "voucher precisa ser produto ativo da mesma
empresa" não tem tabela contra a qual verificar. Quando loja e eixos existirem, uma
migration aditiva acrescenta.

**D3 — Sem `ChallengeReward`.** Ver *Modelo de dados*.

**D4 — Markdown no lugar de HTML.** Ver *Texto rico*.

**D5 — Categoria como `String` + Zod, não enum do Prisma.** Ver *Contrato*.

**D6 — `isPrivate` = não listado.** Ver *Visibilidade*.
