# Multi-tenancy no Escritório — sub-fatia 1: dados + services — Design

## Contexto

Última linha de trabalho de multi-tenancy pendente do pedido original (Feedback, MoodEntry,
Notification e Review já commitados e mergeados em `feat/multi-empresa-auth-jwt-clean`, PR
#10609). O domínio de Escritório é o maior e mais arriscado subsistema ainda global — foi
explicitamente adiado desde a primeira spec da linha
(`docs/superpowers/specs/2026-07-23-multi-empresa-isolamento-design.md`, seção "Não-objetivos":
"`AppSetting`, `OfficeSetting` e toda a família `OfficeMap*`: continuam singletons globais [...]
decisão consciente adiada para uma fase seguinte, quando uma segunda empresa real existir").

Dado o tamanho (~3160 linhas de produção, ~4227 linhas de teste — maior que todas as fatias
anteriores somadas) e uma complicação estrutural nova (o WebSocket do escritório, ao contrário
do `reviewHub`, carrega presença/chat/posição reais, não só sinais de refetch), esta linha vira
3 sub-fatias sequenciais, cada uma com seu próprio spec/plan/implementação:

1. **Dados + services** (esta spec) — schema, `office-map-service.ts`,
   `office-setting-service.ts`, `office-guest-service.ts`.
2. **Rotas HTTP** — wire dos ~20 call-sites em `office-maps.ts`/`office-guests.ts`/
   `office-media.ts` pras novas assinaturas.
3. **`officeHub`/`office-ws.ts`** — a mais arriscada: particionar o hub de presença em memória
   por empresa, fechando o vazamento real de nome/posição/chat/anotações entre empresas
   diferentes compartilhando o mesmo processo.

## Escopo desta sub-fatia (dados + services)

### Models (11, todos sem `companyId` hoje)

`OfficeSetting`, `OfficeMap`, `OfficeMapDraft`, `OfficeMapAsset`, `OfficeMapEditLock`,
`OfficeMapPublication`, `OfficeMapPublicationAsset`, `OfficeRoom`, `OfficeRoomAccessGrant`,
`OfficeDesk`, `OfficeDeskClaim`, `OfficeGuestInvite`.

Nenhum tem FK direta pra `Sector`/`Company` hoje — as únicas FKs existentes são pra `User` (via
`createdById`/`userId`/`lastEditedById`), que não propaga isolamento de leitura/escrita.

### `OfficeSetting` deixa de ser singleton

Hoje: `id Int @id @default(1)` — uma linha fixa pro sistema inteiro, referenciada em todo o
service (`getActiveMapIdForEditing`, `activateOfficeMapPublication`, `getActiveOfficeMap`, o
`upsert({ where: { id: 1 }, ... })` dentro de `materializePublication`).

Depois: `companyId String @id` — uma linha por empresa. Toda leitura/escrita muda de
`where: { id: 1 }` pra `where: { companyId }`.

### Os outros 10 models ganham `companyId` denormalizado

Mesmo padrão já usado em `ReviewCommentReaction`/`ReviewShare`/etc.: cada linha carrega seu
próprio `companyId` (não derivado via join), todos entram em `TENANT_SCOPED_MODELS`
(`apps/api/src/lib/tenant-scope.ts`).

`OfficeGuestInvite` — hoje intencionalmente "sector/company-agnostic" (documentado no código) —
passa a herdar `companyId` de `createdById` (o admin que gerou o convite). O convidado em si
continua sem crachá-lo (a sessão de convidado resolve o mapa pela empresa do convite, não por um
`companyId` próprio do convidado).

### Invariante "filho herda companyId do pai" — mecanismo real neste domínio

A fatia de Review descobriu que nested-writes relacionais do Prisma (`data: { rel: { create:
[...] } } }`) NÃO passam pela injeção de `companyId` da extensão `scopedPrisma` (client
extensions só interceptam a operação top-level). `office-map-service.ts` não usa esse padrão —
usa `createMany` em lote dentro de uma transação interativa (`materializePublication`, a função
que publica um mapa: cria `OfficeRoom[]`/`OfficeRoomAccessGrant[]`/`OfficeDesk[]`/
`OfficeDeskClaim[]` via `tx.officeRoom.createMany(...)` etc., não `create` aninhado). A extensão
**intercepta `createMany`** e injeta `companyId` em cada linha do array — mecanismo já correto,
contanto que a transação rode através do client escopado.

**Mudança mecânica exigida:** trocar `prisma.$transaction(...)` por
`scopedPrisma(companyId).$transaction(...)` em `materializePublication`/`publishOfficeMap`
(preservando as opções de timeout já existentes, `PUBLISH_TRANSACTION_TIMEOUT = { maxWait:
10_000, timeout: 30_000 }` — comentário no código explica que esse timeout alargado já foi uma
correção anterior contra latência de rede real, não pode regredir). Com isso, todo `tx.<model>`
chamado dentro do callback herda a injeção automática de `companyId`, sem precisar tocar em cada
`createMany` individualmente.

### Convenção de assinatura (mesma das fatias anteriores)

`companyId` como novo campo em funções que já recebem um objeto de input; como novo parâmetro
posicional nas que recebem argumentos soltos. `getActiveOfficeMap(_userId?)` — o parâmetro hoje
não-usado — vira `getActiveOfficeMap(companyId: string)`, de fato usado pra resolver o
`OfficeSetting` daquela empresa.

### Fora de escopo desta sub-fatia

- Rotas (`office-maps.ts`, `office-guests.ts`, `office-media.ts`, `admin.ts` trecho de
  `/admin/office-settings`) — só vão parar de compilar até a sub-fatia 2 (mesmo handoff já
  usado entre tasks nas fatias anteriores).
- `officeHub`/`office-ws.ts` — sub-fatia 3. Continuam recebendo o resultado de
  `getActiveOfficeMap` como está hoje (sem `companyId`) até lá; a chamada em produção que
  alimenta o hub fica temporariamente quebrada/comentada ou usando um valor provisório —
  decisão de implementação a detalhar no plano, já que o hub em si só ganha particionamento na
  sub-fatia 3.
- Migração de dado existente: como só existe uma empresa hoje (`company-emr`), a migration usa
  `DEFAULT_COMPANY_ID` como default da coluna nova, mesmo padrão de todas as fatias anteriores.

## Testes

Mesmo padrão das fatias anteriores: fixture de 2ª empresa real, testes adversariais provando que
uma leitura/mutação escopada por uma empresa não enxerga/não afeta dado de outra. Cobertura
mínima:

- `office-map-service.test.ts`/`.merge.test.ts`: pelo menos um teste adversarial por família de
  operação (mapas, draft, lock, assets, publicação/ativação, salas, mesas) provando 404/lista
  vazia pra recurso de outra empresa.
- Teste específico pra `materializePublication`/`publishOfficeMap` com uma empresa não-default,
  confirmando que `OfficeRoom`/`OfficeDesk`/`OfficeRoomAccessGrant`/`OfficeDeskClaim` criados em
  lote herdam o `companyId` real (não o default do banco) — mesma lição da fatia de Review, mas
  aqui a implementação `createMany`-via-`scopedPrisma` já deveria resolver isso corretamente; o
  teste é a prova disso, não uma correção.
- `office-setting-service.test.ts`: teste de que a configuração de uma empresa não vaza/mistura
  com a de outra.
- `office-guest-service.test.ts`: convite criado por admin de uma empresa herda `companyId`
  correto; validação de convite continua funcionando (não fica escopada incorretamente, já que
  quem valida o token é o convidado, sem sessão de empresa própria).
