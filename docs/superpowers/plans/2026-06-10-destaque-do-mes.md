# Destaque do Mês — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao encerrar um período de votação, eleger o colaborador mais votado, gerar um card PNG compartilhável (foto + selo + texto curto de parabéns escrito pelo Gemini a partir das justificativas anônimas dos colegas) e expor um histórico mensal de destaques publicados.

**Architecture:** O resultado mora no `VotingPeriod` (`winnerId`, `winnerVotes`, `highlightText`, `highlightImagePath`, `highlightStatus`). Máquina de estados `NONE → DRAFT → PUBLISHED`: o admin gera o rascunho (1 chamada ao Gemini), edita o texto livremente (re-render local, sem token), e publica (concede o selo e libera aos colaboradores). Card renderizado server-side via SVG → PNG (`@resvg/resvg-js`). Serviços pequenos e isolados (`highlight-service`, `gemini-client`, `card-renderer`, `highlight-storage`), testados com mocks nas fronteiras de IA/IO.

**Tech Stack:** Fastify + Prisma (Postgres) + Zod, Vitest, `@google/genai` (texto), `@resvg/resvg-js` (PNG), `@fastify/static` (servir cards/fotos), React + React Query + Tailwind no web. Monorepo pnpm; tipos compartilhados em `@legends/shared`.

**Convenções herdadas:** rotas admin usam `const adminOnly = { onRequest: [app.authenticate, app.requireAdmin] }`; validação com Zod `safeParse` → 400 `{ message }`; erros Prisma mapeados por `code` (`P2002`/`P2025`); DTOs em `apps/api/src/lib/serialize.ts`; testes de rota via `app.inject` (helper `adminToken`/`devToken`); reset de DB por `beforeEach` em `apps/api/test/setup.ts`; testes do DB rodam contra `legends_test` com `prisma migrate deploy` (`apps/api/test/global-setup.ts`). O front fala com a API sob prefixo `/api` (`apiFetch`).

> **Nota de escopo:** plano grande mas coeso (uma feature). Fases 0–6 são backend; Fase 7 é web. Cada task entrega algo testável isoladamente.

---

## Estrutura de arquivos

**Criar (API):**

- `apps/api/src/lib/month-label.ts` — `monthLabel('2026-06') → 'Junho de 2026'` (PT).
- `apps/api/src/lib/dev-photo.ts` — resolve a foto do dev em disco e devolve data URI ou null.
- `apps/api/src/services/highlight-service.ts` — apuração + orquestração (gerar/editar/publicar/listar).
- `apps/api/src/lib/gemini-client.ts` — `buildCongratsPrompt` (puro) + `buildCongratsText` (chama Gemini).
- `apps/api/src/lib/card-renderer.ts` — `wrapText`, `buildCardSvg` (puro) + `renderCard` (SVG→PNG).
- `apps/api/src/lib/highlight-storage.ts` — caminho público + gravação do PNG em disco.
- `apps/api/src/routes/highlights.ts` — `GET /highlights` (autenticado).
- Testes: `*.test.ts` ao lado de cada serviço/lib + `apps/api/src/routes/highlights.test.ts` + casos novos em `admin.test.ts`.

**Modificar (API):**

- `apps/api/prisma/schema.prisma` — enum `HighlightStatus`, campos no `VotingPeriod`, `HIGHLIGHT` em `BadgeKind`, unique de `UserBadge`.
- `apps/api/prisma/seed.ts` — selo `destaque-do-mes`.
- `apps/api/src/lib/serialize.ts` — `toHighlightDTO`.
- `apps/api/src/routes/admin.ts` — rotas de highlight do admin.
- `apps/api/src/app.ts` — registrar `@fastify/static` (cards) e `highlightRoutes`.
- `apps/api/.env.example` + `apps/api/.gitignore` (ou raiz) — vars do Gemini e ignore de `storage/`.

**Criar/Modificar (shared):**

- `packages/shared/src/enums.ts` — `HIGHLIGHT_STATUS`/`HighlightStatus`, `HIGHLIGHT` em `BADGE_KINDS`.
- `packages/shared/src/highlight.ts` — `HighlightDTO`.
- `packages/shared/src/index.ts` — export.

**Criar/Modificar (web):**

- `apps/web/src/lib/api.ts` já existe (sem mudança).
- `apps/web/src/pages/AdminPage.tsx` — seção "Destaque do mês" (gerar/preview/editar/publicar).
- `apps/web/src/pages/HighlightsPage.tsx` — histórico de cards.
- `apps/web/src/App.tsx` + `apps/web/src/components/AppLayout.tsx` — rota/nav `/destaques`.

---

## Fase 0 — Schema e tipos compartilhados

### Task 1: Migração do schema Prisma

**Files:**

- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Adicionar o enum `HighlightStatus`**

No `apps/api/prisma/schema.prisma`, logo após o enum `VotingPeriodStatus`, adicione:

```prisma
enum HighlightStatus {
  NONE
  DRAFT
  PUBLISHED
}
```

- [ ] **Step 2: Adicionar `HIGHLIGHT` ao `BadgeKind`**

Altere o enum `BadgeKind` para incluir o novo tipo:

```prisma
enum BadgeKind {
  CATEGORY
  RECURRENCE
  IMPACT
  HIGHLIGHT
}
```

- [ ] **Step 3: Adicionar campos do destaque ao `VotingPeriod`**

No `model VotingPeriod`, adicione os campos e a relação (mantenha os campos atuais):

```prisma
model VotingPeriod {
  id        String             @id @default(cuid())
  monthRef  String             @unique // formato "2026-06"
  startsAt  DateTime
  endsAt    DateTime
  status    VotingPeriodStatus @default(OPEN)
  createdAt DateTime           @default(now())

  winnerId           String?
  winnerVotes        Int?
  highlightText      String?
  highlightImagePath String?
  highlightStatus    HighlightStatus @default(NONE)

  votes  Vote[]
  winner User? @relation("PeriodWinner", fields: [winnerId], references: [id])
}
```

- [ ] **Step 4: Adicionar o lado inverso da relação no `User`**

No `model User`, na lista de relações (perto de `votesGiven`/`votesReceived`), adicione:

```prisma
  periodsWon    VotingPeriod[] @relation("PeriodWinner")
```

- [ ] **Step 5: Ajustar o unique do `UserBadge`**

No `model UserBadge`, troque a linha do índice único:

```prisma
  @@unique([userId, badgeId, periodId])
```

(Os selos atuais têm `periodId = null`; no Postgres dois `NULL` não colidem, então o comportamento deles é preservado.)

- [ ] **Step 6: Gerar a migration e o client**

Run:

```bash
pnpm --filter @legends/api exec prisma migrate dev --name destaque_do_mes
```

Expected: cria `apps/api/prisma/migrations/<timestamp>_destaque_do_mes/migration.sql`, aplica no banco de dev e roda `prisma generate` (tipos `@prisma/client` atualizados, incluindo `HighlightStatus`).

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): campos de destaque do mês no VotingPeriod + BadgeKind HIGHLIGHT"
```

---

### Task 2: Tipos compartilhados

**Files:**

- Modify: `packages/shared/src/enums.ts`
- Create: `packages/shared/src/highlight.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Adicionar enums no shared**

Em `packages/shared/src/enums.ts`, adicione ao final e ajuste `BADGE_KINDS`:

```typescript
export const BADGE_KINDS = [
  "CATEGORY",
  "RECURRENCE",
  "IMPACT",
  "HIGHLIGHT",
] as const;
export type BadgeKind = (typeof BADGE_KINDS)[number];

export const HIGHLIGHT_STATUS = ["NONE", "DRAFT", "PUBLISHED"] as const;
export type HighlightStatus = (typeof HIGHLIGHT_STATUS)[number];
```

(Substitua a definição antiga de `BADGE_KINDS`/`BadgeKind` por esta — não duplique.)

- [ ] **Step 2: Criar o DTO de highlight**

Crie `packages/shared/src/highlight.ts`:

```typescript
import type { PublicUser } from "./auth";
import type { HighlightStatus } from "./enums";

/** Um destaque do mês publicado, para o histórico (hall da fama). */
export interface HighlightDTO {
  periodId: string;
  monthRef: string;
  status: HighlightStatus;
  winner: PublicUser | null;
  winnerVotes: number | null;
  text: string | null;
  imageUrl: string | null; // caminho relativo servido sob /api (ex.: /api/highlights/2026-06.png)
}
```

- [ ] **Step 3: Exportar no índice**

Em `packages/shared/src/index.ts`, adicione a linha:

```typescript
export * from "./highlight";
```

- [ ] **Step 4: Verificar typecheck do shared**

Run: `pnpm --filter @legends/shared build`
Expected: build sem erros (ou, se o pacote não tiver `build`, `pnpm --filter @legends/shared exec tsc --noEmit`).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): HighlightStatus, HIGHLIGHT em BADGE_KINDS e HighlightDTO"
```

---

### Task 3: Seed do selo "Destaque do Mês"

**Files:**

- Modify: `apps/api/prisma/seed.ts:26-35`

- [ ] **Step 1: Adicionar o selo HIGHLIGHT ao array de badges**

No array `const badges = [ ... ]` (em `apps/api/prisma/seed.ts`), adicione mais um item ao final da lista (antes do `]`):

```typescript
    { slug: 'destaque-do-mes', name: 'Destaque do Mês', description: 'Eleito o destaque do mês pela votação dos colegas', kind: 'HIGHLIGHT', iconKey: 'trophy', threshold: 0, categorySlug: null },
```

- [ ] **Step 2: Rodar o seed para validar**

Run: `pnpm db:seed`
Expected: executa sem erro; o upsert cria/atualiza o selo `destaque-do-mes`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "feat(seed): selo Destaque do Mês (kind HIGHLIGHT)"
```

---

## Fase 1 — Apuração do vencedor

### Task 4: `electWinner` (apuração + desempate)

**Files:**

- Create: `apps/api/src/services/highlight-service.ts`
- Test: `apps/api/src/services/highlight-service.test.ts`

- [ ] **Step 1: Escrever os testes de apuração**

Crie `apps/api/src/services/highlight-service.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { prisma } from "../lib/prisma";
import { electWinner } from "./highlight-service";

async function seedPeriod() {
  const category = await prisma.category.create({
    data: { name: "Colaboração", slug: "colaboracao" },
  });
  const period = await prisma.votingPeriod.create({
    data: {
      monthRef: "2026-06",
      startsAt: new Date("2026-06-01"),
      endsAt: new Date("2026-06-30"),
      status: "CLOSED",
    },
  });
  return { category, period };
}

async function mkUser(name: string) {
  return prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase()}@empresa.com`,
      passwordHash: "x",
    },
  });
}

// Cada votante dá 1 voto/período; criamos votantes distintos por voto.
async function castVote(opts: {
  votedId: string;
  categoryId: string;
  periodId: string;
  at: Date;
  voterName: string;
}) {
  const voter = await mkUser(opts.voterName);
  return prisma.vote.create({
    data: {
      voterId: voter.id,
      votedId: opts.votedId,
      categoryId: opts.categoryId,
      periodId: opts.periodId,
      justification: "reconhecimento de teste",
      createdAt: opts.at,
    },
  });
}

describe("electWinner", () => {
  it("returns the most-voted user", async () => {
    const { category, period } = await seedPeriod();
    const ana = await mkUser("Ana");
    const bruno = await mkUser("Bruno");
    await castVote({
      votedId: ana.id,
      categoryId: category.id,
      periodId: period.id,
      at: new Date("2026-06-02"),
      voterName: "V1",
    });
    await castVote({
      votedId: ana.id,
      categoryId: category.id,
      periodId: period.id,
      at: new Date("2026-06-03"),
      voterName: "V2",
    });
    await castVote({
      votedId: bruno.id,
      categoryId: category.id,
      periodId: period.id,
      at: new Date("2026-06-04"),
      voterName: "V3",
    });

    const result = await electWinner(period.id);
    expect(result).toEqual({ winnerId: ana.id, winnerVotes: 2 });
  });

  it("breaks a tie by who reached the winning score first", async () => {
    const { category, period } = await seedPeriod();
    const ana = await mkUser("Ana");
    const bruno = await mkUser("Bruno");
    // Ambos chegam a 2 votos; Bruno atinge 2 (voto às 03) antes de Ana atingir 2 (voto às 05).
    await castVote({
      votedId: bruno.id,
      categoryId: category.id,
      periodId: period.id,
      at: new Date("2026-06-01"),
      voterName: "V1",
    });
    await castVote({
      votedId: ana.id,
      categoryId: category.id,
      periodId: period.id,
      at: new Date("2026-06-02"),
      voterName: "V2",
    });
    await castVote({
      votedId: bruno.id,
      categoryId: category.id,
      periodId: period.id,
      at: new Date("2026-06-03"),
      voterName: "V3",
    });
    await castVote({
      votedId: ana.id,
      categoryId: category.id,
      periodId: period.id,
      at: new Date("2026-06-05"),
      voterName: "V4",
    });

    const result = await electWinner(period.id);
    expect(result).toEqual({ winnerId: bruno.id, winnerVotes: 2 });
  });

  it("returns null when there are no votes", async () => {
    const { period } = await seedPeriod();
    expect(await electWinner(period.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/services/highlight-service.test.ts`
Expected: FAIL — `electWinner is not exported` / módulo não encontrado.

- [ ] **Step 3: Implementar `electWinner`**

Crie `apps/api/src/services/highlight-service.ts`:

```typescript
import { prisma } from "../lib/prisma";

export interface ElectionResult {
  winnerId: string;
  winnerVotes: number;
}

/**
 * Apura o vencedor de um período: o mais votado. Desempate: entre os empatados
 * no maior número de votos, vence quem ATINGIU esse total primeiro — isto é, o
 * `createdAt` do voto que o levou ao total vencedor (o seu último voto) mais
 * antigo. Retorna null se o período não tiver votos.
 */
export async function electWinner(
  periodId: string,
): Promise<ElectionResult | null> {
  const votes = await prisma.vote.findMany({
    where: { periodId },
    select: { votedId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (votes.length === 0) return null;

  const count = new Map<string, number>();
  const reachedAt = new Map<string, Date>(); // createdAt do último voto de cada candidato
  for (const v of votes) {
    count.set(v.votedId, (count.get(v.votedId) ?? 0) + 1);
    reachedAt.set(v.votedId, v.createdAt);
  }

  const maxVotes = Math.max(...count.values());
  let winnerId = "";
  let winnerReachedAt = Infinity;
  for (const [userId, n] of count) {
    if (n !== maxVotes) continue;
    const t = reachedAt.get(userId)!.getTime();
    if (t < winnerReachedAt) {
      winnerReachedAt = t;
      winnerId = userId;
    }
  }

  return { winnerId, winnerVotes: maxVotes };
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/highlight-service.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/highlight-service.ts apps/api/src/services/highlight-service.test.ts
git commit -m "feat(api): electWinner — apuração do destaque com desempate determinístico"
```

---

## Fase 2 — Texto do Gemini

### Task 5: `gemini-client` (prompt anônimo + chamada)

**Files:**

- Create: `apps/api/src/lib/gemini-client.ts`
- Test: `apps/api/src/lib/gemini-client.test.ts`
- Modify: `apps/api/package.json` (dependência `@google/genai`)

- [ ] **Step 1: Instalar o SDK do Gemini**

Run: `pnpm --filter @legends/api add @google/genai`
Expected: adiciona `@google/genai` em `apps/api/package.json`.

- [ ] **Step 2: Escrever os testes do builder de prompt (puro)**

Crie `apps/api/src/lib/gemini-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildCongratsPrompt } from "./gemini-client";

describe("buildCongratsPrompt", () => {
  const justifications = [
    "Salvou o incidente de produção",
    "Sempre ajuda nos code reviews",
  ];

  it("includes the winner name, month and all justifications", () => {
    const prompt = buildCongratsPrompt({
      winnerName: "Ana",
      monthLabel: "Junho de 2026",
      justifications,
    });
    expect(prompt).toContain("Ana");
    expect(prompt).toContain("Junho de 2026");
    expect(prompt).toContain("Salvou o incidente de produção");
    expect(prompt).toContain("Sempre ajuda nos code reviews");
  });

  it("does not leak voter identities (anonymous justifications only)", () => {
    const prompt = buildCongratsPrompt({
      winnerName: "Ana",
      monthLabel: "Junho de 2026",
      justifications: ["texto do colega"],
      // Mesmo se quem chamar passar nomes por engano, o builder só usa os textos:
    });
    // O prompt instrui explicitamente a não citar autores.
    expect(prompt.toLowerCase()).toContain("anôn");
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/gemini-client.test.ts`
Expected: FAIL — `buildCongratsPrompt` não existe.

- [ ] **Step 4: Implementar `gemini-client`**

Crie `apps/api/src/lib/gemini-client.ts`:

```typescript
import { GoogleGenAI } from "@google/genai";

export interface CongratsInput {
  winnerName: string;
  monthLabel: string;
  justifications: string[]; // SOMENTE os textos, sem identificar autores
}

/**
 * Monta o prompt para o Gemini. As justificativas entram ANÔNIMAS — nenhum
 * nome/email de quem votou é incluído. Função pura (testável sem rede).
 */
export function buildCongratsPrompt(input: CongratsInput): string {
  const bullets = input.justifications.map((j) => `- ${j.trim()}`).join("\n");
  return [
    `Você é o narrador do programa "Legends" de uma equipe de desenvolvimento de produto.`,
    `Escreva um parabéns curto e impactante (2 a 3 frases, no máximo ~60 palavras, em português do Brasil)`,
    `para ${input.winnerName}, eleito(a) o Destaque do Mês de ${input.monthLabel} pela votação dos colegas.`,
    `Explique o PORQUÊ do destaque com base no que os colegas escreveram (justificativas anônimas abaixo).`,
    `Tom caloroso e profissional. Não invente fatos. Não cite nomes de quem votou (são anônimas).`,
    `Não use markdown, aspas ou emojis. Responda apenas com o texto final.`,
    ``,
    `Justificativas dos colegas:`,
    bullets,
  ].join("\n");
}

/** Chama o Gemini e devolve o texto. Lança erro claro se a chave faltar. */
export async function buildCongratsText(
  input: CongratsInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY não configurada — defina em apps/api/.env para gerar o texto do destaque.",
    );
  }
  const model = env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model,
    contents: buildCongratsPrompt(input),
  });
  const text = (res.text ?? "").trim();
  if (!text) throw new Error("O Gemini não retornou texto para o destaque.");
  return text;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/gemini-client.test.ts`
Expected: PASS (2 testes). (Só o builder puro é testado; `buildCongratsText` é exercitado via mock nas Tasks 9 e 11.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/gemini-client.ts apps/api/src/lib/gemini-client.test.ts apps/api/package.json
git commit -m "feat(api): gemini-client com prompt anônimo para o texto do destaque"
```

---

## Fase 3 — Render do card

### Task 6: Helpers `month-label`, `wrapText` e `buildCardSvg`

**Files:**

- Create: `apps/api/src/lib/month-label.ts`
- Create: `apps/api/src/lib/card-renderer.ts`
- Test: `apps/api/src/lib/month-label.test.ts`
- Test: `apps/api/src/lib/card-renderer.test.ts`

- [ ] **Step 1: Teste de `monthLabel`**

Crie `apps/api/src/lib/month-label.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { monthLabel } from "./month-label";

describe("monthLabel", () => {
  it("formats a YYYY-MM into a Brazilian month label", () => {
    expect(monthLabel("2026-06")).toBe("Junho de 2026");
    expect(monthLabel("2026-01")).toBe("Janeiro de 2026");
    expect(monthLabel("2026-12")).toBe("Dezembro de 2026");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/month-label.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `monthLabel`**

Crie `apps/api/src/lib/month-label.ts`:

```typescript
const MONTHS_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** "2026-06" -> "Junho de 2026". Espera formato YYYY-MM válido. */
export function monthLabel(monthRef: string): string {
  const [year, month] = monthRef.split("-");
  const name = MONTHS_PT[Number(month) - 1] ?? month;
  return `${name} de ${year}`;
}
```

- [ ] **Step 4: Teste de `wrapText` e `buildCardSvg`**

Crie `apps/api/src/lib/card-renderer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { wrapText, buildCardSvg } from "./card-renderer";

describe("wrapText", () => {
  it("wraps words into lines under the max length", () => {
    const lines = wrapText(
      "uma frase bem comprida que precisa quebrar em varias linhas aqui",
      20,
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20);
  });

  it("keeps a short text in a single line", () => {
    expect(wrapText("curto", 20)).toEqual(["curto"]);
  });
});

describe("buildCardSvg", () => {
  it("embeds the name, month, votes and escaped text", () => {
    const svg = buildCardSvg({
      name: "Ana & Cia",
      monthLabel: "Junho de 2026",
      votes: 7,
      text: 'Parabéns <Ana> "destaque"',
      photoDataUri: null,
      initials: "AC",
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("Junho de 2026");
    expect(svg).toContain("7");
    // XML-escapado:
    expect(svg).toContain("Ana &amp; Cia");
    expect(svg).toContain("&lt;Ana&gt;");
    expect(svg).toContain("&quot;destaque&quot;");
    // Sem foto -> mostra iniciais:
    expect(svg).toContain("AC");
  });

  it("embeds the photo when a data URI is given", () => {
    const svg = buildCardSvg({
      name: "Ana",
      monthLabel: "Junho de 2026",
      votes: 3,
      text: "oi",
      photoDataUri: "data:image/png;base64,AAAA",
      initials: "A",
    });
    expect(svg).toContain("data:image/png;base64,AAAA");
  });
});
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/card-renderer.test.ts`
Expected: FAIL — `wrapText`/`buildCardSvg` não existem.

- [ ] **Step 6: Implementar `wrapText`, `escapeXml` e `buildCardSvg`**

Crie `apps/api/src/lib/card-renderer.ts`:

```typescript
import { Resvg } from "@resvg/resvg-js";

export interface CardData {
  name: string;
  monthLabel: string;
  votes: number;
  text: string;
  photoDataUri: string | null; // foto do dev embutida (ou null -> iniciais)
  initials: string;
}

const WIDTH = 1200;
const HEIGHT = 630;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Quebra `text` em linhas com no máximo `maxChars` caracteres, por palavras. */
export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/** Monta o SVG do card (1200x630). Função pura — sem IO. */
export function buildCardSvg(data: CardData): string {
  const lines = wrapText(data.text, 46).slice(0, 5);
  const textTspans = lines
    .map(
      (line, i) =>
        `<tspan x="80" dy="${i === 0 ? 0 : 40}">${escapeXml(line)}</tspan>`,
    )
    .join("");

  const avatar = data.photoDataUri
    ? `<clipPath id="circ"><circle cx="1000" cy="170" r="110"/></clipPath>
       <image href="${data.photoDataUri}" x="890" y="60" width="220" height="220" clip-path="url(#circ)" preserveAspectRatio="xMidYMid slice"/>
       <circle cx="1000" cy="170" r="110" fill="none" stroke="#f5b301" stroke-width="6"/>`
    : `<circle cx="1000" cy="170" r="110" fill="#1f2a37" stroke="#f5b301" stroke-width="6"/>
       <text x="1000" y="170" font-size="84" font-weight="700" fill="#f5b301" text-anchor="middle" dominant-baseline="central">${escapeXml(data.initials)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0b1220"/>
  <rect x="0" y="0" width="${WIDTH}" height="10" fill="#f5b301"/>
  <text x="80" y="110" font-size="34" font-weight="700" letter-spacing="6" fill="#f5b301">DESTAQUE DO MÊS</text>
  <text x="80" y="160" font-size="28" fill="#9aa7b8">${escapeXml(data.monthLabel)}</text>
  <text x="80" y="250" font-size="64" font-weight="700" fill="#ffffff">${escapeXml(data.name)}</text>
  <text x="80" y="300" font-size="26" fill="#9aa7b8">${data.votes} ${data.votes === 1 ? "reconhecimento" : "reconhecimentos"} neste mês</text>
  <text x="80" y="380" font-size="30" fill="#e6edf5" font-style="italic">${textTspans}</text>
  ${avatar}
</svg>`;
}

/** Renderiza o SVG do card em PNG. Usa fontes do sistema (hardening futuro: TTF embutida). */
export async function renderCard(data: CardData): Promise<Buffer> {
  const svg = buildCardSvg(data);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
    font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" },
  });
  return resvg.render().asPng();
}
```

- [ ] **Step 7: Instalar `@resvg/resvg-js`**

Run: `pnpm --filter @legends/api add @resvg/resvg-js`
Expected: adiciona a dependência.

- [ ] **Step 8: Rodar os testes (month-label + card-renderer puro)**

Run: `pnpm --filter @legends/api exec vitest run src/lib/month-label.test.ts src/lib/card-renderer.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/month-label.ts apps/api/src/lib/month-label.test.ts apps/api/src/lib/card-renderer.ts apps/api/src/lib/card-renderer.test.ts apps/api/package.json
git commit -m "feat(api): card-renderer (SVG do destaque) e month-label PT"
```

---

### Task 7: Render real → PNG (teste de integração leve)

**Files:**

- Test: `apps/api/src/lib/card-renderer.render.test.ts`

- [ ] **Step 1: Escrever o teste de render PNG**

Crie `apps/api/src/lib/card-renderer.render.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderCard } from "./card-renderer";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // \x89PNG

describe("renderCard", () => {
  it("produces a non-empty PNG (with initials fallback)", async () => {
    const png = await renderCard({
      name: "Ana Souza",
      monthLabel: "Junho de 2026",
      votes: 5,
      text: "Parabéns pelo destaque do mês!",
      photoDataUri: null,
      initials: "AS",
    });
    expect(png.length).toBeGreaterThan(1000);
    expect(png.subarray(0, 4)).toEqual(PNG_SIGNATURE);
  });
});
```

- [ ] **Step 2: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/card-renderer.render.test.ts`
Expected: PASS. (Se falhar por fontes ausentes no ambiente, o PNG ainda terá o fundo/retângulos; o assert de assinatura/tamanho deve passar mesmo sem texto.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/card-renderer.render.test.ts
git commit -m "test(api): renderCard gera PNG válido"
```

---

### Task 8: `dev-photo` (foto do vencedor → data URI)

**Files:**

- Create: `apps/api/src/lib/dev-photo.ts`
- Test: `apps/api/src/lib/dev-photo.test.ts`
- Create (pasta): `apps/api/assets/avatars/.gitkeep`

- [ ] **Step 1: Garantir a pasta de fotos**

Run: `mkdir -p apps/api/assets/avatars && touch apps/api/assets/avatars/.gitkeep`
Expected: pasta criada (as fotos `<handle>.jpg` serão adicionadas pelo usuário/seed; alinhado ao spec de fotos).

- [ ] **Step 2: Escrever os testes**

Crie `apps/api/src/lib/dev-photo.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { devPhotoHandle, photoDataUriFor, AVATARS_DIR } from "./dev-photo";

describe("devPhotoHandle", () => {
  it("derives the handle from the email local part (lowercased)", () => {
    expect(devPhotoHandle("Lucca.Secco@eumedicoresidente.com.br")).toBe(
      "lucca.secco",
    );
  });
});

describe("photoDataUriFor", () => {
  const handle = "teste.foto";
  const file = join(AVATARS_DIR, `${handle}.png`);

  beforeAll(() => {
    mkdirSync(AVATARS_DIR, { recursive: true });
    // PNG 1x1 mínimo
    writeFileSync(file, Buffer.from("89504e470d0a1a0a", "hex"));
  });
  afterAll(() => rmSync(file, { force: true }));

  it("returns a data URI when a file exists", () => {
    const uri = photoDataUriFor("teste.foto@empresa.com");
    expect(uri).toMatch(/^data:image\/png;base64,/);
  });

  it("returns null when no file exists", () => {
    expect(photoDataUriFor("ninguem@empresa.com")).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/dev-photo.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar `dev-photo`**

Crie `apps/api/src/lib/dev-photo.ts`:

```typescript
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Pasta versionada das fotos dos devs (convenção do spec de fotos). */
export const AVATARS_DIR = join(process.cwd(), "assets", "avatars");

const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/** Parte local do email, minúscula — chave do arquivo da foto. */
export function devPhotoHandle(email: string): string {
  return email.split("@")[0].toLowerCase();
}

/** Lê a foto do dev em disco e devolve um data URI, ou null se não existir. */
export function photoDataUriFor(email: string): string | null {
  const handle = devPhotoHandle(email);
  for (const ext of Object.keys(EXT_MIME)) {
    const file = join(AVATARS_DIR, `${handle}${ext}`);
    if (existsSync(file)) {
      const base64 = readFileSync(file).toString("base64");
      return `data:${EXT_MIME[ext]};base64,${base64}`;
    }
  }
  return null;
}
```

> Nota: `process.cwd()` é a raiz de `apps/api` em dev (`tsx`), nos testes (vitest) e no build (`node dist/server.js` rodado a partir de `apps/api`). As fotos vivem em `apps/api/assets/avatars`.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/dev-photo.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/dev-photo.ts apps/api/src/lib/dev-photo.test.ts apps/api/assets/avatars/.gitkeep
git commit -m "feat(api): dev-photo resolve foto do vencedor para o card"
```

---

## Fase 4 — Armazenamento e orquestração

### Task 9: `highlight-storage` (gravar o PNG)

**Files:**

- Create: `apps/api/src/lib/highlight-storage.ts`
- Test: `apps/api/src/lib/highlight-storage.test.ts`
- Modify: `.gitignore` (raiz do repo)

- [ ] **Step 1: Ignorar a pasta de cards gerados**

No `.gitignore` da raiz do repositório, adicione:

```
apps/api/storage/
```

- [ ] **Step 2: Escrever os testes**

Crie `apps/api/src/lib/highlight-storage.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  publicCardPath,
  saveCardPng,
  HIGHLIGHTS_DIR,
} from "./highlight-storage";

describe("publicCardPath", () => {
  it("builds the public path under /highlights", () => {
    expect(publicCardPath("2026-06")).toBe("/highlights/2026-06.png");
  });
});

describe("saveCardPng", () => {
  const monthRef = "2099-12";
  afterAll(() =>
    rmSync(join(HIGHLIGHTS_DIR, `${monthRef}.png`), { force: true }),
  );

  it("writes the PNG to disk and returns its public path", async () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const path = await saveCardPng(monthRef, png);
    expect(path).toBe("/highlights/2099-12.png");
    expect(existsSync(join(HIGHLIGHTS_DIR, `${monthRef}.png`))).toBe(true);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/highlight-storage.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar `highlight-storage`**

Crie `apps/api/src/lib/highlight-storage.ts`:

```typescript
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Pasta dos cards gerados (não versionada). */
export const HIGHLIGHTS_DIR = join(process.cwd(), "storage", "highlights");

/** Caminho público (servido sob /highlights/) do card de um mês. */
export function publicCardPath(monthRef: string): string {
  return `/highlights/${monthRef}.png`;
}

/** Grava o PNG do card em disco e devolve o caminho público. */
export async function saveCardPng(
  monthRef: string,
  png: Buffer,
): Promise<string> {
  await mkdir(HIGHLIGHTS_DIR, { recursive: true });
  await writeFile(join(HIGHLIGHTS_DIR, `${monthRef}.png`), png);
  return publicCardPath(monthRef);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/highlight-storage.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/highlight-storage.ts apps/api/src/lib/highlight-storage.test.ts .gitignore
git commit -m "feat(api): highlight-storage grava o PNG do card"
```

---

### Task 10: Orquestração — gerar/editar/publicar/listar

**Files:**

- Modify: `apps/api/src/services/highlight-service.ts`
- Test: `apps/api/src/services/highlight-service.orchestration.test.ts`

- [ ] **Step 1: Escrever os testes de orquestração (com mocks de IA/render)**

Crie `apps/api/src/services/highlight-service.orchestration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../lib/prisma";

// Mocka as fronteiras caras: Gemini, render e gravação de arquivo.
vi.mock("../lib/gemini-client", () => ({
  buildCongratsText: vi.fn(async () => "Parabéns, Ana, pelo destaque!"),
}));
vi.mock("../lib/card-renderer", () => ({
  renderCard: vi.fn(async () => Buffer.from("89504e470d0a1a0a", "hex")),
}));
vi.mock("../lib/highlight-storage", () => ({
  saveCardPng: vi.fn(async (monthRef: string) => `/highlights/${monthRef}.png`),
  publicCardPath: (monthRef: string) => `/highlights/${monthRef}.png`,
}));

import { buildCongratsText } from "../lib/gemini-client";
import {
  generateHighlightDraft,
  updateHighlightText,
  publishHighlight,
  listPublishedHighlights,
  HighlightError,
} from "./highlight-service";

async function seed() {
  const category = await prisma.category.create({
    data: { name: "Colaboração", slug: "colaboracao" },
  });
  const ana = await prisma.user.create({
    data: { name: "Ana", email: "ana@empresa.com", passwordHash: "x" },
  });
  const period = await prisma.votingPeriod.create({
    data: {
      monthRef: "2026-06",
      startsAt: new Date("2026-06-01"),
      endsAt: new Date("2026-06-30"),
      status: "CLOSED",
    },
  });
  const v1 = await prisma.user.create({
    data: { name: "V1", email: "v1@e.com", passwordHash: "x" },
  });
  await prisma.vote.create({
    data: {
      voterId: v1.id,
      votedId: ana.id,
      categoryId: category.id,
      periodId: period.id,
      justification: "ótimo trabalho",
    },
  });
  await prisma.badge.create({
    data: {
      slug: "destaque-do-mes",
      name: "Destaque do Mês",
      description: "x",
      kind: "HIGHLIGHT",
      iconKey: "trophy",
      threshold: 0,
    },
  });
  return { period, ana };
}

beforeEach(() => vi.clearAllMocks());

describe("generateHighlightDraft", () => {
  it("elects the winner, generates text/card and stores a DRAFT", async () => {
    const { period, ana } = await seed();
    const result = await generateHighlightDraft(period.id);
    expect(result.highlightStatus).toBe("DRAFT");
    expect(result.winnerId).toBe(ana.id);
    expect(result.winnerVotes).toBe(1);
    expect(result.highlightText).toBe("Parabéns, Ana, pelo destaque!");
    expect(result.highlightImagePath).toBe("/highlights/2026-06.png");
    expect(buildCongratsText).toHaveBeenCalledOnce();
  });

  it("refuses to generate twice (no extra Gemini call)", async () => {
    const { period } = await seed();
    await generateHighlightDraft(period.id);
    await expect(generateHighlightDraft(period.id)).rejects.toBeInstanceOf(
      HighlightError,
    );
    expect(buildCongratsText).toHaveBeenCalledOnce();
  });

  it("refuses when there are no votes", async () => {
    const category = await prisma.category.create({
      data: { name: "C", slug: "c" },
    });
    void category;
    const period = await prisma.votingPeriod.create({
      data: {
        monthRef: "2026-07",
        startsAt: new Date("2026-07-01"),
        endsAt: new Date("2026-07-31"),
        status: "CLOSED",
      },
    });
    await expect(generateHighlightDraft(period.id)).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe("updateHighlightText", () => {
  it("edits the text and re-renders without calling Gemini", async () => {
    const { period } = await seed();
    await generateHighlightDraft(period.id);
    vi.clearAllMocks();
    const updated = await updateHighlightText(
      period.id,
      "Texto editado pelo admin",
    );
    expect(updated.highlightText).toBe("Texto editado pelo admin");
    expect(buildCongratsText).not.toHaveBeenCalled();
  });

  it("refuses to edit when not in DRAFT", async () => {
    const { period } = await seed();
    await expect(updateHighlightText(period.id, "x")).rejects.toBeInstanceOf(
      HighlightError,
    );
  });
});

describe("publishHighlight", () => {
  it("publishes and awards the HIGHLIGHT badge to the winner", async () => {
    const { period, ana } = await seed();
    await generateHighlightDraft(period.id);
    const published = await publishHighlight(period.id);
    expect(published.highlightStatus).toBe("PUBLISHED");

    const awarded = await prisma.userBadge.findFirst({
      where: {
        userId: ana.id,
        periodId: period.id,
        badge: { slug: "destaque-do-mes" },
      },
    });
    expect(awarded).not.toBeNull();

    const list = await listPublishedHighlights();
    expect(list).toHaveLength(1);
    expect(list[0].winner?.id).toBe(ana.id);
  });

  it("refuses to publish a period that is not in DRAFT", async () => {
    const { period } = await seed();
    await expect(publishHighlight(period.id)).rejects.toBeInstanceOf(
      HighlightError,
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/services/highlight-service.orchestration.test.ts`
Expected: FAIL — funções/`HighlightError` não existem.

- [ ] **Step 3: Implementar a orquestração**

Adicione ao final de `apps/api/src/services/highlight-service.ts` (mantenha `electWinner`):

```typescript
import type { User, VotingPeriod } from "@prisma/client";
import { buildCongratsText } from "../lib/gemini-client";
import { renderCard } from "../lib/card-renderer";
import { saveCardPng } from "../lib/highlight-storage";
import { photoDataUriFor } from "../lib/dev-photo";
import { monthLabel } from "../lib/month-label";

export class HighlightError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "HighlightError";
  }
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Gera o rascunho do destaque (1 chamada ao Gemini): apura o vencedor, monta o
 * texto a partir das justificativas ANÔNIMAS do mês, renderiza o card e grava o
 * período em DRAFT. Recusa se já houver geração (status ≠ NONE) ou sem votos.
 */
export async function generateHighlightDraft(
  periodId: string,
): Promise<VotingPeriod> {
  const period = await prisma.votingPeriod.findUnique({
    where: { id: periodId },
  });
  if (!period) throw new HighlightError("Período não encontrado.", 404);
  if (period.highlightStatus !== "NONE") {
    throw new HighlightError("O destaque deste período já foi gerado.", 409);
  }

  const election = await electWinner(periodId);
  if (!election)
    throw new HighlightError(
      "Não há votos neste período para apurar o destaque.",
      422,
    );

  const winner = await prisma.user.findUniqueOrThrow({
    where: { id: election.winnerId },
  });

  // Justificativas SEM identificar autores — só os textos.
  const votes = await prisma.vote.findMany({
    where: { periodId, votedId: winner.id },
    select: { justification: true },
    orderBy: { createdAt: "asc" },
  });
  const justifications = votes.map((v) => v.justification);

  const text = await buildCongratsText({
    winnerName: winner.name,
    monthLabel: monthLabel(period.monthRef),
    justifications,
  });

  const png = await renderCard({
    name: winner.name,
    monthLabel: monthLabel(period.monthRef),
    votes: election.winnerVotes,
    text,
    photoDataUri: photoDataUriFor(winner.email),
    initials: initialsOf(winner.name),
  });
  const imagePath = await saveCardPng(period.monthRef, png);

  return prisma.votingPeriod.update({
    where: { id: periodId },
    data: {
      winnerId: winner.id,
      winnerVotes: election.winnerVotes,
      highlightText: text,
      highlightImagePath: imagePath,
      highlightStatus: "DRAFT",
    },
  });
}

/** Edita o texto do destaque em DRAFT e re-renderiza o card (sem Gemini). */
export async function updateHighlightText(
  periodId: string,
  text: string,
): Promise<VotingPeriod> {
  const period = await prisma.votingPeriod.findUnique({
    where: { id: periodId },
  });
  if (!period) throw new HighlightError("Período não encontrado.", 404);
  if (period.highlightStatus !== "DRAFT") {
    throw new HighlightError(
      "Só é possível editar um destaque em rascunho.",
      409,
    );
  }
  const winner = await prisma.user.findUniqueOrThrow({
    where: { id: period.winnerId! },
  });

  const png = await renderCard({
    name: winner.name,
    monthLabel: monthLabel(period.monthRef),
    votes: period.winnerVotes ?? 0,
    text,
    photoDataUri: photoDataUriFor(winner.email),
    initials: initialsOf(winner.name),
  });
  const imagePath = await saveCardPng(period.monthRef, png);

  return prisma.votingPeriod.update({
    where: { id: periodId },
    data: { highlightText: text, highlightImagePath: imagePath },
  });
}

/** Publica o destaque (DRAFT → PUBLISHED) e concede o selo ao vencedor. */
export async function publishHighlight(
  periodId: string,
): Promise<VotingPeriod> {
  const period = await prisma.votingPeriod.findUnique({
    where: { id: periodId },
  });
  if (!period) throw new HighlightError("Período não encontrado.", 404);
  if (period.highlightStatus !== "DRAFT") {
    throw new HighlightError(
      "Só é possível publicar um destaque em rascunho.",
      409,
    );
  }
  const badge = await prisma.badge.findUnique({
    where: { slug: "destaque-do-mes" },
  });
  if (!badge)
    throw new HighlightError(
      'Selo "destaque-do-mes" não encontrado (rode o seed).',
      500,
    );

  const [updated] = await prisma.$transaction([
    prisma.votingPeriod.update({
      where: { id: periodId },
      data: { highlightStatus: "PUBLISHED" },
    }),
    prisma.userBadge.upsert({
      where: {
        userId_badgeId_periodId: {
          userId: period.winnerId!,
          badgeId: badge.id,
          periodId,
        },
      },
      create: { userId: period.winnerId!, badgeId: badge.id, periodId },
      update: {},
    }),
  ]);
  return updated;
}

export interface PublishedHighlight {
  period: VotingPeriod;
  winner: User | null;
}

/** Lista os destaques publicados (mais recente primeiro) para o histórico. */
export async function listPublishedHighlights() {
  const periods = await prisma.votingPeriod.findMany({
    where: { highlightStatus: "PUBLISHED" },
    include: { winner: true },
    orderBy: { monthRef: "desc" },
  });
  return periods.map((p) => ({ period: p, winner: p.winner }));
}
```

> Nota: o nome do índice composto gerado pelo Prisma para `@@unique([userId, badgeId, periodId])` é `userId_badgeId_periodId`. Se o `prisma generate` da Task 1 gerar outro nome, ajuste o `where` do upsert para o nome reportado pelo client.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/highlight-service.orchestration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/highlight-service.ts apps/api/src/services/highlight-service.orchestration.test.ts
git commit -m "feat(api): orquestração do destaque (gerar/editar/publicar/listar)"
```

---

## Fase 5 — Serialização e rotas

### Task 11: `toHighlightDTO`

**Files:**

- Modify: `apps/api/src/lib/serialize.ts`

- [ ] **Step 1: Implementar o DTO**

Em `apps/api/src/lib/serialize.ts`, adicione o import do tipo e a função. No bloco de imports de `@legends/shared` adicione `HighlightDTO`, e adicione ao final do arquivo:

```typescript
import type { PublishedHighlight } from "../services/highlight-service";

export function toHighlightDTO(entry: PublishedHighlight): HighlightDTO {
  const { period, winner } = entry;
  return {
    periodId: period.id,
    monthRef: period.monthRef,
    status: period.highlightStatus,
    winner: winner ? toPublicUser(winner) : null,
    winnerVotes: period.winnerVotes,
    text: period.highlightText,
    imageUrl: period.highlightImagePath
      ? `/api${period.highlightImagePath}`
      : null,
  };
}
```

> `imageUrl` recebe o prefixo `/api` para o front consumir direto em `<img src>` (o gateway roteia `/api` → API, que serve `/highlights/*`).

- [ ] **Step 2: Verificar typecheck**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/serialize.ts
git commit -m "feat(api): toHighlightDTO"
```

---

### Task 12: Rotas de admin do destaque

**Files:**

- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/src/routes/admin.highlight.test.ts`

- [ ] **Step 1: Escrever os testes das rotas (mockando IA/render/storage)**

Crie `apps/api/src/routes/admin.highlight.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../lib/prisma";

vi.mock("../lib/gemini-client", () => ({
  buildCongratsText: vi.fn(async () => "Parabéns pelo destaque!"),
}));
vi.mock("../lib/card-renderer", () => ({
  renderCard: vi.fn(async () => Buffer.from("89504e470d0a1a0a", "hex")),
}));
vi.mock("../lib/highlight-storage", () => ({
  saveCardPng: vi.fn(async (m: string) => `/highlights/${m}.png`),
  publicCardPath: (m: string) => `/highlights/${m}.png`,
}));

async function adminToken(app: ReturnType<typeof buildApp>) {
  await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      name: "Admin",
      email: "admin@empresa.com",
      password: "changeme123",
    },
  });
  await prisma.user.update({
    where: { email: "admin@empresa.com" },
    data: { role: "ADMIN" },
  });
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: "admin@empresa.com", password: "changeme123" },
  });
  return res.json().token as string;
}

async function seedClosedPeriodWithVotes() {
  const category = await prisma.category.create({
    data: { name: "Colab", slug: "colab" },
  });
  const ana = await prisma.user.create({
    data: { name: "Ana", email: "ana@empresa.com", passwordHash: "x" },
  });
  const v1 = await prisma.user.create({
    data: { name: "V1", email: "v1@empresa.com", passwordHash: "x" },
  });
  const period = await prisma.votingPeriod.create({
    data: {
      monthRef: "2026-06",
      startsAt: new Date("2026-06-01"),
      endsAt: new Date("2026-06-30"),
      status: "CLOSED",
    },
  });
  await prisma.vote.create({
    data: {
      voterId: v1.id,
      votedId: ana.id,
      categoryId: category.id,
      periodId: period.id,
      justification: "ótimo",
    },
  });
  await prisma.badge.create({
    data: {
      slug: "destaque-do-mes",
      name: "Destaque do Mês",
      description: "x",
      kind: "HIGHLIGHT",
      iconKey: "trophy",
      threshold: 0,
    },
  });
  return { period, ana };
}

describe("admin highlight routes", () => {
  it("generates a draft (201) and refuses a second generation (409)", async () => {
    const app = buildApp();
    await app.ready();
    const token = await adminToken(app);
    const { period } = await seedClosedPeriodWithVotes();

    const first = await app.inject({
      method: "POST",
      url: `/admin/periods/${period.id}/highlight`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().highlight.status).toBe("DRAFT");
    expect(first.json().highlight.winner.name).toBe("Ana");

    const second = await app.inject({
      method: "POST",
      url: `/admin/periods/${period.id}/highlight`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.statusCode).toBe(409);
    await app.close();
  });

  it("returns 422 when there are no votes", async () => {
    const app = buildApp();
    await app.ready();
    const token = await adminToken(app);
    const period = await prisma.votingPeriod.create({
      data: {
        monthRef: "2026-08",
        startsAt: new Date("2026-08-01"),
        endsAt: new Date("2026-08-31"),
        status: "CLOSED",
      },
    });
    const res = await app.inject({
      method: "POST",
      url: `/admin/periods/${period.id}/highlight`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it("edits the text (200) then publishes (200) awarding the badge", async () => {
    const app = buildApp();
    await app.ready();
    const token = await adminToken(app);
    const { period, ana } = await seedClosedPeriodWithVotes();
    await app.inject({
      method: "POST",
      url: `/admin/periods/${period.id}/highlight`,
      headers: { authorization: `Bearer ${token}` },
    });

    const edit = await app.inject({
      method: "PATCH",
      url: `/admin/periods/${period.id}/highlight`,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "Texto revisado" },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().highlight.text).toBe("Texto revisado");

    const pub = await app.inject({
      method: "POST",
      url: `/admin/periods/${period.id}/highlight/publish`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().highlight.status).toBe("PUBLISHED");

    const awarded = await prisma.userBadge.findFirst({
      where: { userId: ana.id, periodId: period.id },
    });
    expect(awarded).not.toBeNull();
    await app.close();
  });

  it("forbids a non-admin (403)", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: `/admin/periods/whatever/highlight`,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.highlight.test.ts`
Expected: FAIL — rotas inexistentes (404).

- [ ] **Step 3: Implementar as rotas no admin**

Em `apps/api/src/routes/admin.ts`:

(a) Ajuste os imports do topo, adicionando:

```typescript
import { z } from "zod"; // (já importado — não duplicar)
import {
  generateHighlightDraft,
  updateHighlightText,
  publishHighlight,
  HighlightError,
} from "../services/highlight-service";
import { listPublishedHighlights } from "../services/highlight-service";
import { toHighlightDTO } from "../lib/serialize";
```

(b) Adicione o schema perto dos outros schemas Zod:

```typescript
const highlightTextSchema = z.object({ text: z.string().min(1).max(600) });
```

(c) No topo de `apps/api/src/routes/admin.ts`, adicione ao import de tipos do Fastify: `import type { FastifyInstance, FastifyReply } from 'fastify'` (hoje é só `FastifyInstance`).

(d) Dentro de `adminRoutes`, adicione as rotas (após o bloco de `/admin/periods/:id/close`). Helper para mapear `HighlightError` → resposta:

```typescript
function sendHighlightError(reply: FastifyReply, err: unknown) {
  if (err instanceof HighlightError)
    return reply.code(err.status).send({ message: err.message });
  throw err;
}

app.post("/admin/periods/:id/highlight", adminOnly, async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const period = await generateHighlightDraft(id);
    return reply.code(201).send({
      highlight: toHighlightDTO({
        period,
        winner: period.winnerId
          ? await prisma.user.findUnique({ where: { id: period.winnerId } })
          : null,
      }),
    });
  } catch (err) {
    return sendHighlightError(reply, err);
  }
});

app.patch("/admin/periods/:id/highlight", adminOnly, async (request, reply) => {
  const { id } = request.params as { id: string };
  const parsed = highlightTextSchema.safeParse(request.body);
  if (!parsed.success)
    return reply
      .code(400)
      .send({ message: "Texto inválido (1 a 600 caracteres)." });
  try {
    const period = await updateHighlightText(id, parsed.data.text);
    return reply.send({
      highlight: toHighlightDTO({
        period,
        winner: period.winnerId
          ? await prisma.user.findUnique({ where: { id: period.winnerId } })
          : null,
      }),
    });
  } catch (err) {
    return sendHighlightError(reply, err);
  }
});

app.post(
  "/admin/periods/:id/highlight/publish",
  adminOnly,
  async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const period = await publishHighlight(id);
      return reply.send({
        highlight: toHighlightDTO({
          period,
          winner: period.winnerId
            ? await prisma.user.findUnique({ where: { id: period.winnerId } })
            : null,
        }),
      });
    } catch (err) {
      return sendHighlightError(reply, err);
    }
  },
);

app.get("/admin/highlights", adminOnly, async (_request, reply) => {
  const entries = await listPublishedHighlights();
  return reply.send({ highlights: entries.map(toHighlightDTO) });
});
```

> Simplificação opcional (DRY): se preferir, faça `toHighlightDTO` aceitar diretamente o `VotingPeriod` com `winner` incluído. Como `generate/update/publish` retornam `VotingPeriod` sem o `winner` carregado, o código acima recarrega o `winner` por `winnerId`. Mantenha como está para não alterar a assinatura testada na Task 11.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.highlight.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.highlight.test.ts
git commit -m "feat(api): rotas admin de destaque (gerar/editar/publicar)"
```

---

### Task 13: Rota pública `GET /highlights` + `@fastify/static`

**Files:**

- Create: `apps/api/src/routes/highlights.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/routes/highlights.test.ts`
- Modify: `apps/api/package.json` (`@fastify/static`)

- [ ] **Step 1: Instalar `@fastify/static`**

Run: `pnpm --filter @legends/api add @fastify/static`
Expected: dependência adicionada.

- [ ] **Step 2: Escrever o teste da rota pública**

Crie `apps/api/src/routes/highlights.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildApp } from "../app";
import { prisma } from "../lib/prisma";

async function devToken(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { name: "Dev", email: "dev@empresa.com", password: "changeme123" },
  });
  return res.json().token as string;
}

describe("GET /highlights", () => {
  it("lists only PUBLISHED highlights, most recent first", async () => {
    const app = buildApp();
    await app.ready();
    const token = await devToken(app);
    const ana = await prisma.user.create({
      data: { name: "Ana", email: "ana@empresa.com", passwordHash: "x" },
    });

    await prisma.votingPeriod.create({
      data: {
        monthRef: "2026-05",
        startsAt: new Date("2026-05-01"),
        endsAt: new Date("2026-05-31"),
        status: "CLOSED",
        winnerId: ana.id,
        winnerVotes: 4,
        highlightText: "oi",
        highlightImagePath: "/highlights/2026-05.png",
        highlightStatus: "PUBLISHED",
      },
    });
    await prisma.votingPeriod.create({
      data: {
        monthRef: "2026-06",
        startsAt: new Date("2026-06-01"),
        endsAt: new Date("2026-06-30"),
        status: "CLOSED",
        winnerId: ana.id,
        winnerVotes: 6,
        highlightText: "olá",
        highlightImagePath: "/highlights/2026-06.png",
        highlightStatus: "PUBLISHED",
      },
    });
    // DRAFT não deve aparecer:
    await prisma.votingPeriod.create({
      data: {
        monthRef: "2026-07",
        startsAt: new Date("2026-07-01"),
        endsAt: new Date("2026-07-31"),
        status: "CLOSED",
        winnerId: ana.id,
        winnerVotes: 2,
        highlightText: "rascunho",
        highlightImagePath: "/highlights/2026-07.png",
        highlightStatus: "DRAFT",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/highlights",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json().highlights;
    expect(list.map((h: { monthRef: string }) => h.monthRef)).toEqual([
      "2026-06",
      "2026-05",
    ]);
    expect(list[0].imageUrl).toBe("/api/highlights/2026-06.png");
    expect(list[0].winner.name).toBe("Ana");
    await app.close();
  });

  it("requires authentication (401)", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/highlights" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/highlights.test.ts`
Expected: FAIL — rota inexistente.

- [ ] **Step 4: Implementar a rota**

Crie `apps/api/src/routes/highlights.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import { listPublishedHighlights } from "../services/highlight-service";
import { toHighlightDTO } from "../lib/serialize";

export async function highlightRoutes(app: FastifyInstance) {
  app.get(
    "/highlights",
    { onRequest: [app.authenticate] },
    async (_request, reply) => {
      const entries = await listPublishedHighlights();
      return reply.send({ highlights: entries.map(toHighlightDTO) });
    },
  );
}
```

- [ ] **Step 5: Registrar static + rota no app**

Em `apps/api/src/app.ts`:

(a) Adicione os imports:

```typescript
import fastifyStatic from "@fastify/static";
import { join } from "node:path";
import { highlightRoutes } from "./routes/highlights";
```

(b) Dentro de `buildApp`, antes dos `app.register(...Routes)`, registre o static dos cards:

```typescript
app.register(fastifyStatic, {
  root: join(process.cwd(), "storage", "highlights"),
  prefix: "/highlights/",
  decorateReply: false,
});
```

(c) Registre a rota:

```typescript
app.register(highlightRoutes);
```

> Nota: a pasta `storage/highlights` pode não existir no boot. `@fastify/static` tolera root inexistente (responde 404). Se preferir, garanta a pasta com `mkdirSync(join(process.cwd(),'storage','highlights'),{recursive:true})` antes do register.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/highlights.test.ts`
Expected: PASS.

- [ ] **Step 7: Rodar a suíte inteira da API**

Run: `pnpm --filter @legends/api test`
Expected: todos os testes passam (inclui os pré-existentes).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/highlights.ts apps/api/src/routes/highlights.test.ts apps/api/src/app.ts apps/api/package.json
git commit -m "feat(api): GET /highlights e static dos cards (@fastify/static)"
```

---

## Fase 6 — Configuração

### Task 14: Variáveis de ambiente

**Files:**

- Modify: `apps/api/.env.example`
- Modify: `apps/api/.env` (local, não versionado — só para rodar de verdade)

- [ ] **Step 1: Documentar as vars no exemplo**

Em `apps/api/.env.example`, adicione ao final:

```
# Geração do texto do Destaque do Mês (opcional em dev; obrigatório para gerar de verdade)
GEMINI_API_KEY=""
GEMINI_MODEL="gemini-2.5-flash"
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/.env.example
git commit -m "chore(api): documentar GEMINI_API_KEY/GEMINI_MODEL no .env.example"
```

---

## Fase 7 — Web

### Task 15: Tipos e chamadas no front + seção de admin

**Files:**

- Modify: `apps/web/src/pages/AdminPage.tsx`

- [ ] **Step 1: Ler a estrutura atual do AdminPage**

Run: `sed -n '1,80p' apps/web/src/pages/AdminPage.tsx`
Expected: ver imports, uso de `useQuery`/`useMutation` (React Query) e `apiFetch`, e como as seções de períodos são montadas. Siga esses padrões.

- [ ] **Step 2: Adicionar a seção "Destaque do mês" para períodos encerrados**

No `AdminPage.tsx`, adicione um componente `HighlightAdmin` e renderize-o na área de períodos. Use `HighlightDTO` de `@legends/shared`. Código:

```tsx
import type { HighlightDTO, VotingPeriodDTO } from "@legends/shared";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../lib/api";

function HighlightAdmin({ period }: { period: VotingPeriodDTO }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Carrega o estado atual do destaque do período (via lista de admin).
  const { data } = useQuery({
    queryKey: ["admin-highlights"],
    queryFn: () =>
      apiFetch<{ highlights: HighlightDTO[] }>("/admin/highlights"),
  });
  const published = data?.highlights.find((h) => h.periodId === period.id);

  const generate = useMutation({
    mutationFn: () =>
      apiFetch<{ highlight: HighlightDTO }>(
        `/admin/periods/${period.id}/highlight`,
        { method: "POST" },
      ),
    onSuccess: (res) => {
      setText(res.highlight.text ?? "");
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-highlights"] });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Erro ao gerar"),
  });
  const saveText = useMutation({
    mutationFn: () =>
      apiFetch<{ highlight: HighlightDTO }>(
        `/admin/periods/${period.id}/highlight`,
        { method: "PATCH", body: JSON.stringify({ text }) },
      ),
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Erro ao salvar"),
  });
  const publish = useMutation({
    mutationFn: () =>
      apiFetch<{ highlight: HighlightDTO }>(
        `/admin/periods/${period.id}/highlight/publish`,
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-highlights"] }),
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Erro ao publicar"),
  });

  // Só faz sentido para períodos encerrados.
  if (period.state !== "ENDED") return null;

  const draftState =
    generate.data?.highlight ??
    (published?.status === "DRAFT" ? published : null);
  const isPublished = published?.status === "PUBLISHED";

  return (
    <div className="mt-sm rounded-lg border border-outline-variant/30 bg-surface-container p-md">
      <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
        Destaque do mês
      </p>
      {error && <p className="mt-xs text-body-sm text-error">{error}</p>}

      {isPublished ? (
        <p className="mt-xs text-body-sm text-on-surface">Publicado ✓</p>
      ) : draftState ? (
        <div className="mt-sm space-y-sm">
          <textarea
            className="w-full rounded-md border border-outline-variant/40 bg-surface-container-low p-sm text-body-sm"
            rows={4}
            defaultValue={draftState.text ?? ""}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-sm">
            <button
              className="rounded-md bg-surface-container-highest px-md py-xs text-body-sm"
              onClick={() => saveText.mutate()}
              disabled={saveText.isPending}
            >
              Salvar texto
            </button>
            <button
              className="rounded-md bg-primary px-md py-xs text-body-sm text-on-primary"
              onClick={() => publish.mutate()}
              disabled={publish.isPending}
            >
              Publicar
            </button>
          </div>
        </div>
      ) : (
        <button
          className="mt-sm rounded-md bg-primary px-md py-xs text-body-sm text-on-primary disabled:opacity-50"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
        >
          {generate.isPending ? "Gerando…" : "Gerar destaque"}
        </button>
      )}
    </div>
  );
}
```

Renderize `<HighlightAdmin period={period} />` dentro do `.map` que lista os períodos (no card de cada período).

- [ ] **Step 3: Typecheck/build do web**

Run: `pnpm --filter @legends/web build`
Expected: `tsc --noEmit` + build do Vite sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/AdminPage.tsx
git commit -m "feat(web): admin gera, edita e publica o destaque do mês"
```

---

### Task 16: Página de histórico de destaques

**Files:**

- Create: `apps/web/src/pages/HighlightsPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`

- [ ] **Step 1: Criar a página**

Crie `apps/web/src/pages/HighlightsPage.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import type { HighlightDTO } from "@legends/shared";
import { apiFetch } from "../lib/api";
import { Icon } from "../components/Icon";

const MONTHS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];
function monthLabel(monthRef: string) {
  const [y, m] = monthRef.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

export function HighlightsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["highlights"],
    queryFn: () => apiFetch<{ highlights: HighlightDTO[] }>("/highlights"),
  });
  const highlights = data?.highlights ?? [];

  return (
    <section className="mx-auto max-w-7xl p-xl">
      <header className="mb-xl">
        <div className="flex items-center gap-sm text-primary">
          <Icon name="trophy" className="text-[20px]" />
          <span className="font-label text-label-md uppercase tracking-[0.18em]">
            Hall da fama
          </span>
        </div>
        <h2 className="mt-2 font-headline text-headline-xl text-on-surface">
          Destaques do mês
        </h2>
      </header>

      {isLoading && <p className="text-on-surface-variant">Carregando…</p>}
      {isError && <p className="text-error">Erro ao carregar os destaques.</p>}
      {!isLoading && !isError && highlights.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">
          Nenhum destaque publicado ainda.
        </p>
      )}

      <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-3">
        {highlights.map((h) => (
          <article
            key={h.periodId}
            className="rounded-xl border border-outline-variant/30 bg-surface-container p-lg"
          >
            <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              {monthLabel(h.monthRef)}
            </p>
            <h3 className="mt-xs font-headline text-headline-md text-on-surface">
              {h.winner?.name}
            </h3>
            {h.imageUrl && (
              <a
                href={h.imageUrl}
                download={`destaque-${h.monthRef}.png`}
                className="mt-md block"
              >
                <img
                  src={h.imageUrl}
                  alt={`Destaque ${monthLabel(h.monthRef)} — ${h.winner?.name}`}
                  className="w-full rounded-lg"
                />
              </a>
            )}
            {h.text && (
              <p className="mt-md text-body-sm italic text-on-surface-variant">
                {h.text}
              </p>
            )}
            {h.imageUrl && (
              <a
                href={h.imageUrl}
                download={`destaque-${h.monthRef}.png`}
                className="mt-md inline-flex items-center gap-xs text-body-sm text-primary"
              >
                <Icon name="download" className="text-[18px]" /> Salvar /
                compartilhar
              </a>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
```

> Nota: confirme que `Icon` tem chaves `trophy` e `download` em `apps/web/src/lib/icons.ts`; se faltarem, adicione (ou use ícones existentes equivalentes).

- [ ] **Step 2: Registrar a rota**

Em `apps/web/src/App.tsx`, importe e adicione a rota (seguindo o padrão das demais rotas autenticadas):

```tsx
import { HighlightsPage } from "./pages/HighlightsPage";
// ...dentro das <Route> autenticadas:
<Route path="/destaques" element={<HighlightsPage />} />;
```

- [ ] **Step 3: Adicionar ao menu**

Em `apps/web/src/components/AppLayout.tsx`, adicione um link de navegação para `/destaques` (rótulo "Destaques"), seguindo o padrão dos itens existentes.

- [ ] **Step 4: Build do web**

Run: `pnpm --filter @legends/web build`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/HighlightsPage.tsx apps/web/src/App.tsx apps/web/src/components/AppLayout.tsx
git commit -m "feat(web): página de histórico de destaques do mês"
```

---

## Verificação final

- [ ] **Step 1: Suíte da API**

Run: `pnpm --filter @legends/api test`
Expected: todos verdes.

- [ ] **Step 2: Build do monorepo**

Run: `pnpm build`
Expected: shared + api + web compilam sem erro.

- [ ] **Step 3: Smoke manual (opcional, requer GEMINI_API_KEY)**

Com `GEMINI_API_KEY` setada e DB com um período encerrado + votos: subir `pnpm dev`, no admin clicar "Gerar destaque", editar o texto, publicar, e conferir o card em `/destaques`. (Sem a chave, a geração responde erro claro — o resto do app segue funcionando.)

---

## Notas de design refletidas

- **Geração única:** a guarda `highlightStatus !== 'NONE'` em `generateHighlightDraft` garante exatamente 1 chamada ao Gemini por período (controle de tokens). Edição/re-render são locais.
- **Privacidade:** só os textos das justificativas vão ao prompt; nenhum identificador de votante. O `buildCongratsPrompt` instrui o modelo a não citar autores.
- **Liberação:** colaboradores só veem o resultado após `PUBLISHED` (`GET /highlights` filtra por status).
- **Fallback de foto:** sem arquivo em `assets/avatars`, o card usa as iniciais — nunca quebra.
- **Idempotência da publicação:** upsert na unique `(userId, badgeId, periodId)` evita selo duplicado.
