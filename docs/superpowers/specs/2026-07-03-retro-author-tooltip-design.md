# Tooltip de autor no board de retrospectiva — design

**Data:** 2026-07-03
**Status:** aprovado (brainstorming)

## Problema

No board de retrospectiva, cada card mostra apenas o avatar do autor no canto
superior direito. É difícil identificar quem escreveu um card só pelo avatar, e
muitas vezes os avatares se confundem entre si.

Hoje o nome do autor até existe (`card.author.name`), mas é exposto **apenas pelo
atributo `title` nativo** do badge do avatar
([PostIt.tsx:155-161](../../../apps/web/src/pages/retro/PostIt.tsx#L155-L161)) —
o tooltip nativo é lento pra aparecer, discreto e some fácil.

## Decisão de UX

- **Manter o board limpo:** o nome **não** fica sempre visível. Continua só o
  avatar; a identificação vem via **tooltip no hover/focus**.
- **Trocar o tooltip nativo por um estilizado e instantâneo**, reaproveitando o
  padrão já existente no app.
- **Respeitar o modo anônimo:** em cards mascarados de outros autores, o tooltip
  mostra "Anônimo", nunca o nome real.

## Escopo

### 1. Tooltip estilizado no lugar do `title` nativo

Arquivo: [apps/web/src/pages/retro/PostIt.tsx](../../../apps/web/src/pages/retro/PostIt.tsx),
badge do avatar (linhas ~155-161).

Reaproveitar o padrão de tooltip por CSS já usado em
[FeedbackReactions.tsx:49-58](../../../apps/web/src/pages/profile/FeedbackReactions.tsx#L49-L58)
— sem dependência nova, sem componente genérico novo:

- Envolver o badge do avatar num wrapper `group relative`.
- Remover o `title={authorLabel}` (tooltip nativo lento).
- Adicionar um `<span role="tooltip">` filho com o `authorLabel`, que aparece via
  `group-hover`/`group-focus`: fundo escuro/surface, sombra, cantos arredondados,
  posicionado logo acima do avatar, `z-index` alto, `pointer-events-none`,
  transição de opacidade rápida.
- Manter `aria-label={authorLabel}` no badge (acessibilidade — leitores de tela
  continuam anunciando o autor).

### 2. Respeitar o modo anônimo

Arquivo: mesmo `PostIt.tsx`, cálculo do `authorLabel`
([PostIt.tsx:90](../../../apps/web/src/pages/retro/PostIt.tsx#L90)).

Hoje:
```ts
const authorLabel = card.mine ? 'Você' : card.author?.name ?? 'Anônimo'
```

Passa a checar `card.masked` antes de expor o nome real:
```ts
const authorLabel = card.mine
  ? 'Você'
  : card.masked
    ? 'Anônimo'
    : card.author?.name ?? 'Anônimo'
```

Isso corrige o vazamento atual (o nome ia no `title` mesmo em card mascarado) e
vale tanto para o tooltip quanto para o `aria-label`. `card.masked` já existe no
DTO ([packages/shared/src/retro.ts](../../../packages/shared/src/retro.ts), campo
`masked?: boolean`).

## Fora de escopo (YAGNI)

- Rótulo de nome sempre visível no card.
- Aumentar o avatar ou mudar o layout do card.
- Componente `<Tooltip>` genérico compartilhado.
- Qualquer mudança na API ou no contrato `@legends/shared`.

## Testes

Teste de componente em `apps/web/src/pages/retro/PostIt.test.tsx` (Vitest +
Testing Library + jsdom), cobrindo:

1. Card normal: o tooltip renderiza o nome do autor (`card.author.name`).
2. Card `masked` (de outro autor): mostra "Anônimo", **não** o nome real.
3. Card `mine`: mostra "Você".

## Impacto

- Somente frontend (`apps/web`). Sem migration, sem mudança de contrato, sem API.
- Mudança visual restrita ao badge de avatar do card de retro.
