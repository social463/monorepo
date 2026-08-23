# Design — Ações de Retrospectivas: contexto, observação e squad

**Data:** 2026-07-06
**Slug:** acoes-retro-mostrar-problema

## Problema

A seção "Ações de Retrospectivas" no perfil lista cada _to-do_ apenas pela
descrição do plano (`plan`). Faltam três coisas para o item ser compreensível e útil:

1. **Contexto** — sem o problema que originou a ação, não dá para saber _por que_
   ela existe.
2. **Observação do responsável** — não há onde o responsável registrar como está
   tratando a ação, nem esse registro chega a quem audita na retro seguinte.
3. **Squad de origem** — não dá para saber de qual squad veio a ação (só a sprint).

Objetivo: exibir o problema de origem como título; permitir uma observação do
responsável que persiste e reflete na auditoria da retro consequente; e mostrar
o nome da squad de origem ao lado da sprint.

## Contexto no código

Cada ação do perfil é um `RetroCard` que:

- vive numa região de ação (`went_bad` / `start` / `stop`);
- tem `actionPlan` preenchido (é isso que `listUserActions` filtra);
- tem em `text` o **problema de origem** — o próprio texto do card.

O problema **já existe no banco** (`RetroCard.text`) — só não é exposto/renderizado.
O card espelho ("Origem: ...") não entra na listagem porque não tem `actionPlan`.

A **auditoria** da retro seguinte acontece em `apps/web/src/pages/retro/CarryoverCard.tsx`
(tipo `validate`, botões Validar/Reprovar, só para líder), alimentada por
`RetroCarryoverItemDTO` (`listCarryover` em `retro-service.ts`). Hoje ela mostra
plano/responsável/prazo/sprint — nenhuma observação.

A **escrita do responsável** já tem um caminho: `PATCH /retro/actions/:cardId`
(`setActionDone`), que só o `actionResponsible` pode chamar.

Uma sala de retro pode ter **mais de uma squad** (`RetroRoomSquad`, N-N). Já existe
a convenção `retroRoomTitle`/`retroRoomSquadDTOs` que junta nomes ordenados com `, `.

Arquivos envolvidos:

- `apps/api/prisma/schema.prisma` — model `RetroCard` (nova coluna `actionNote`)
- `packages/shared/src/retro.ts` — `RetroActionItemDTO`, `RetroCarryoverItemDTO`
- `apps/api/src/lib/serialize.ts` — `toRetroActionItemDTO`, `toRetroCarryoverItemDTO`
- `apps/api/src/services/profile-service.ts` — `listUserActions`
- `apps/api/src/services/retro-service.ts` — `setActionDone` (→ `updateAction`)
- `apps/api/src/routes/retro.ts` — `PATCH /retro/actions/:cardId`
- `apps/web/src/pages/ProfilePage.tsx` — render + edição da seção
- `apps/web/src/lib/retro-api.ts` — client da PATCH
- `apps/web/src/pages/retro/CarryoverCard.tsx` — auditoria

## Mudança 1 — Problema de origem como título

### Contrato (`@legends/shared`)

Adicionar `problem` ao DTO (o contrato é a fonte da verdade, muda primeiro):

```ts
export interface RetroActionItemDTO {
  id: string
  plan: string
  problem: string            // texto do card de origem (RetroCard.text)
  note: string | null        // observação do responsável (Mudança 2)
  dueDate: string
  done: boolean
  doneAt: string | null
  sprint: number
  squad: string              // nomes das squads de origem, ordenados e juntos com ", " (Mudança 3)
  roomId: string
  auditStatus: 'VALIDATED' | 'REJECTED' | null
}
```

### API (`serialize.ts`)

Em `toRetroActionItemDTO`: ampliar o `Pick<RetroCard, ...>` para incluir `'text'` e
`'actionNote'`; preencher `problem: card.text ?? ''`.

### Front (`ProfilePage.tsx`)

Layout escolhido: **problema em destaque, ação abaixo**.

- **Título** do item = `a.problem` — `text-body-md text-on-surface`.
- **Abaixo**, o plano prefixado: `Ação: {a.plan}` — `text-body-sm text-on-surface-variant`.
- **Estado concluído:** aplicar `line-through`/dim no bloco (problema + ação).
- **Fallback dado legado:** se `problem` vier vazio, usar `plan` como título e
  omitir a linha "Ação:".

## Mudança 2 — Observação do responsável

### Banco (migration nova)

Adicionar coluna nullable à model `RetroCard`:

```prisma
actionNote String?
```

`pnpm db:migrate`. Não-quebra dados existentes.

### Contrato

`RetroActionItemDTO.note: string | null` (perfil lê/edita) e
`RetroCarryoverItemDTO.note: string | null` (auditor lê) — ver blocos das Mudanças 1 e 3.

### API — escrita

`PATCH /retro/actions/:cardId` passa a aceitar `{ done?: boolean, note?: string }`
(pelo menos um campo presente). Schema Zod: `note` string até **500** chars.

Service: renomear `setActionDone` → `updateAction({ cardId, userId, done?, note? })`;
segue exigindo que só o `actionResponsible` chame. Regras:

- Se `done !== undefined`: comportamento atual — seta `actionDone`/`actionDoneAt` e
  **reseta auditoria** (`auditStatus`/`auditedById`/`auditedAt` = null).
- Se `note !== undefined`: grava `actionNote` (trim; vazio → `null`) **sem** tocar na
  auditoria. Nota é coluna separada — alternar "concluída" não apaga a observação.
- Ambos podem vir na mesma chamada.

### API — leitura

`serialize.ts`: preencher `note: card.actionNote` em `toRetroActionItemDTO` e
`toRetroCarryoverItemDTO`. `listCarryover` já carrega o card completo dos rooms de
origem; confirmar que `actionNote` está disponível (findMany sem `select` restritivo,
ou incluir `actionNote` no `select`).

### Front — perfil (`ProfilePage.tsx`)

- Em cada ação, **só no próprio perfil**: um `<textarea>` compacto com placeholder
  "Adicionar observação…", pré-preenchido com `a.note ?? ''`. Salva no **blur**
  quando o valor mudou, via mutation própria (`updateActionNoteM`) que chama a PATCH
  com `{ note }` e invalida a query do perfil.
- Em perfil de terceiros: se `a.note` existir, mostrar como texto read-only
  ("Observação: …"); se vazio, não renderizar nada.

### Front — auditoria (`CarryoverCard.tsx`)

No card tipo `validate`, quando `item.note` existir, renderizar um bloco
"Observação do responsável: {item.note}" antes dos botões Validar/Reprovar.

## Mudança 3 — Squad de origem ao lado da sprint

### Contrato

`RetroActionItemDTO.squad: string` — nomes das squads de origem, ordenados (pt-BR) e
juntos com `, ` (ex.: "Alpha" ou "Alpha, Beta"); `''` se não houver squad.

### API

- `listUserActions` (`profile-service.ts`): ampliar o `include` do room para trazer
  as squads: `room: { select: { id: true, sprint: true, squads: { select: { squad: { select: { name: true } } } } } }`.
- `toRetroActionItemDTO`: receber os nomes das squads e preencher `squad`. A rota
  `GET /users/:id/profile` monta a string (ordenar por nome pt-BR, `join(', ')`) e
  passa ao serialize — reaproveitar a mesma ideia de `retroRoomSquadDTOs`.

### Front (`ProfilePage.tsx`)

Na linha de metadados, ao lado do link "Sprint {a.sprint}", exibir a squad:
`Sprint 12 · Alpha`. Renderizar o separador + nome só quando `a.squad` não for vazio.

## Testes

- **API serialize:** `toRetroActionItemDTO` reflete `problem` (`card.text`),
  `note` (`card.actionNote`) e `squad` (nomes juntos); `toRetroCarryoverItemDTO`
  reflete `note`.
- **API rota/service:** `PATCH /retro/actions/:cardId` com `{ note }` persiste e
  **não** reseta auditoria; com `{ done }` reseta como hoje; não-responsável recebe
  erro; `GET /users/:id/profile` retorna `squad` com o nome da squad de origem.
- **Web:** `ProfilePage` renderiza problema como título, "Ação: …" abaixo, a squad ao
  lado da sprint, e salva a observação no blur (no próprio perfil); fallback sem
  `problem`. `CarryoverCard` exibe a observação do responsável no card `validate`.

## Fora de escopo

- Nenhuma mudança no fluxo de criação de ações no board de retro.
- Não editar a observação pelo board nem por perfil de terceiros.
- Sem alteração no texto do card espelho (`actionCardText`).
