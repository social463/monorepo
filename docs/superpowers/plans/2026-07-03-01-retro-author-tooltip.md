# Tooltip de autor no board de retrospectiva — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o `title` nativo lento do avatar de cada card de retro por um tooltip estilizado e instantâneo com o nome do autor, respeitando o modo anônimo.

**Architecture:** Mudança só de frontend em um componente ([apps/web/src/pages/retro/PostIt.tsx](../../../apps/web/src/pages/retro/PostIt.tsx)). Reaproveita o padrão de tooltip por CSS (`group` + `role="tooltip"` + `group-hover`) já usado em [FeedbackReactions.tsx](../../../apps/web/src/pages/profile/FeedbackReactions.tsx). Sem API, sem contrato novo, sem dependência nova.

**Tech Stack:** React 18, Tailwind 3, Vitest + Testing Library (jsdom).

**Spec:** [docs/superpowers/specs/2026-07-03-retro-author-tooltip-design.md](../specs/2026-07-03-retro-author-tooltip-design.md)

## Global Constraints

- TypeScript strict, ESM. Mensagens ao usuário em português.
- Sem dependência nova, sem componente genérico de tooltip.
- Escopo restrito a `apps/web/src/pages/retro/PostIt.tsx` e seu teste.
- Rodar `pnpm --filter @legends/web test` antes de concluir.

---

### Task 1: Tooltip de autor com respeito ao modo anônimo

**Files:**
- Modify: `apps/web/src/pages/retro/PostIt.tsx:90` (cálculo do `authorLabel`) e `:155-161` (badge do avatar)
- Test: `apps/web/src/pages/retro/PostIt.test.tsx` (adicionar casos ao `describe` existente)

**Interfaces:**
- Consumes: `RetroCardDTO` de `@legends/shared` — campos usados: `mine: boolean`, `masked?: boolean`, `author: RetroCardAuthor | null` (com `.name`).
- Produces: nenhum contrato novo. O badge passa a renderizar um elemento com `role="tooltip"` cujo texto é o `authorLabel`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar estes três casos dentro do `describe('PostIt (limpo)', ...)` em `apps/web/src/pages/retro/PostIt.test.tsx` (antes do `})` final, linha 120):

```tsx
  it('tooltip mostra o nome do autor num card de outro autor', () => {
    render(<PostIt {...props} card={{ ...base, mine: false }} />)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Dan')
  })

  it('card mascarado: tooltip mostra "Anônimo", não o nome real', () => {
    render(<PostIt {...props} card={{ ...base, mine: false, masked: true, text: '' }} />)
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Anônimo')
    expect(tip).not.toHaveTextContent('Dan')
  })

  it('card próprio: tooltip mostra "Você"', () => {
    render(<PostIt {...props} card={base} />)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Você')
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web test -- PostIt`
Expected: FAIL — os três novos casos quebram em `getByRole('tooltip')` com "Unable to find an accessible element with the role 'tooltip'" (hoje o nome só vai no atributo `title`/`aria-label`, não há elemento com role tooltip).

- [ ] **Step 3: Corrigir o `authorLabel` para respeitar `masked`**

Em `apps/web/src/pages/retro/PostIt.tsx`, substituir a linha 90:

```tsx
  const authorLabel = card.mine ? 'Você' : card.author?.name ?? 'Anônimo'
```

por:

```tsx
  const authorLabel = card.mine
    ? 'Você'
    : card.masked
      ? 'Anônimo'
      : card.author?.name ?? 'Anônimo'
```

- [ ] **Step 4: Trocar o badge do avatar por wrapper `group` + tooltip**

Em `apps/web/src/pages/retro/PostIt.tsx`, substituir o bloco das linhas 155-161:

```tsx
      <span
        title={authorLabel}
        aria-label={authorLabel}
        className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-zinc-700 shadow ring-1 ring-white/60"
      >
        <Avatar user={card.author ?? { name: authorLabel }} initialsClassName="text-[10px] font-bold text-white" />
      </span>
```

por:

```tsx
      <span className="group absolute -top-2 -right-2">
        <span
          aria-label={authorLabel}
          className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-zinc-700 shadow ring-1 ring-white/60"
        >
          <Avatar user={card.author ?? { name: authorLabel }} initialsClassName="text-[10px] font-bold text-white" />
        </span>
        <span
          role="tooltip"
          className="pointer-events-none invisible absolute bottom-full right-0 z-30 mb-1.5 w-max max-w-[10rem] whitespace-normal break-words rounded-md border border-outline-variant/40 bg-surface-container-highest px-2 py-1 text-right text-[11px] font-normal leading-snug text-on-surface opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        >
          {authorLabel}
        </span>
      </span>
```

Notas:
- O `overflow-hidden` fica **só no círculo interno** (recorta o avatar). O wrapper `group` externo **não** tem `overflow-hidden`, senão o tooltip (posicionado `bottom-full`, acima do badge) seria cortado.
- O wrapper externo é `absolute` → serve de contexto de posicionamento para o tooltip `absolute`.
- `title` nativo removido; `aria-label` preservado no círculo do avatar para leitores de tela.
- `right-0` alinha o tooltip pela borda direita (o badge fica no canto direito do card, então abrir para a esquerda evita estourar a borda).

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web test -- PostIt`
Expected: PASS — todos os casos do arquivo, incluindo os três novos, verdes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/retro/PostIt.tsx apps/web/src/pages/retro/PostIt.test.tsx
git commit -m "feat(web): tooltip de autor no card de retro respeitando modo anônimo"
```

---

## Self-Review

- **Spec coverage:** (1) tooltip estilizado no lugar do `title` nativo → Steps 4-5. (2) respeitar modo anônimo → Step 3 + teste masked. (3) testes dos três cenários → Step 1. Fora de escopo do spec permanece fora. ✔
- **Placeholder scan:** nenhum TBD/TODO; todo código está completo. ✔
- **Type consistency:** usa `card.mine`, `card.masked`, `card.author?.name` — todos presentes em `RetroCardDTO` (verificado em `packages/shared/src/retro.ts`). `authorLabel` continua `string`. ✔
