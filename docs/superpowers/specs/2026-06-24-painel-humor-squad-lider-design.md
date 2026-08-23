# Design — Painel de humor da squad para o líder

**Data:** 2026-06-24
**Status:** aprovado (aguardando review do spec)

## Objetivo

Permitir que o **líder de uma squad** leia, no seu próprio perfil e de forma
privada, o **humor atual** e o **histórico de humor** das demais pessoas da(s)
squad(s) que lidera. A leitura é privada: aparece só para o líder, no próprio
perfil, e nunca para quem visita o perfil dele.

O pedido original: lista de pessoas em accordion; ao expandir, mostra os últimos
humores paginados (10 por vez), carregando mais conforme o scroll. A seção fica
**abaixo da "Galeria de selos"**, ocupando a largura de uma coluna, de forma que
o crescimento da coluna de feedbacks **não empurre** a seção para baixo.

Este design tem duas partes: **(A)** um pré-requisito de modelo de papéis e
liderança de squad, e **(B)** a feature de visibilidade de humor em si.

---

## Parte A — Modelo de papéis + liderança de squad (pré-requisito)

### A.1 Papéis (roles)

Hoje `UserRole` é `DEV | LEAD | ADMIN`. Passa a ser, **em inglês**:

```
LEGEND | LEAD | MANAGER | HEAD | ADMIN
```

Mapeamento e migração de dados:

- `DEV` → `LEGEND` (combina com o tema "Engineering Legends").
- `LEAD` permanece `LEAD` (o "líder" do produto já é o *lead*) — **sem rename**.
- `ADMIN` permanece `ADMIN` (papel técnico/superusuário, à parte da hierarquia).
- `MANAGER` (gestor) e `HEAD` passam a existir como valores do enum, **sem
  usuários atribuídos ainda** (atribuição manual depois).

Como `LEAD` e `ADMIN` não mudam, o impacto em código é menor do que um rename
total: a única troca de literal de papel é `DEV → LEGEND`.

**Migration (Postgres).** A migration automática do Prisma para alterar enum
tende a recriar o tipo e perder dados. A migration será **ajustada à mão** para:

```sql
ALTER TYPE "UserRole" RENAME VALUE 'DEV' TO 'LEGEND';
ALTER TYPE "UserRole" ADD VALUE 'MANAGER';
ALTER TYPE "UserRole" ADD VALUE 'HEAD';
-- default do campo User.role passa de 'DEV' para 'LEGEND'
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'LEGEND';
```

> Observação: `ALTER TYPE ... ADD VALUE` não pode rodar dentro de um bloco de
> transação em algumas versões do Postgres; validar ao gerar a migration e, se
> necessário, separar os statements. Nunca editar migration já aplicada — gerar
> nova com `pnpm db:migrate` e ajustar o SQL.

**Pontos de código a atualizar (via grep por `'DEV'` / `DEV` / `UserRole`):**

- `packages/shared/src/enums.ts` — `USER_ROLES` e tipo `UserRole`.
- `apps/api/prisma/schema.prisma` — enum `UserRole` + default de `User.role`.
- `apps/api/prisma/seed.ts` — `role: "DEV"` → `role: "LEGEND"` (leads seguem `LEAD`).
- Qualquer regra de negócio que trate `DEV` explicitamente (ex.: elegibilidade
  de voto/feedback). `requireAdmin` continua checando `ADMIN`. `isLead ===
  "LEAD"` no `ProfilePage` permanece igual.

### A.2 Liderança de squad

Não existe líder de squad no schema. Adicionar ao model `Squad`:

```prisma
leaderId String?
leader   User?   @relation("SquadLeader", fields: [leaderId], references: [id])
```

E no `User`: back-relation `ledSquads Squad[] @relation("SquadLeader")`.

Regras: **uma squad tem no máximo um líder**; **um líder pode liderar várias
squads** (`leaderId` pode se repetir entre squads). `leaderId` é opcional
(squad sem líder definido). O líder é uma pessoa qualquer; na prática espera-se
papel `LEAD`, mas a autorização da feature é por `leaderId`, não por papel.

**Admin UI** (`apps/web/src/pages/admin/SquadsSection.tsx`): adicionar um
**seletor de líder por squad**, gravando via `PATCH /admin/squads/:id`
(`UpdateSquadRequest` ganha `leaderId?: string | null`). O service `updateSquad`
passa a aceitar e validar `leaderId` (usuário existente e ativo).

**Contrato compartilhado** (`packages/shared/src/squad.ts`): `SquadDTO` ganha
`leaderId: string | null`; `SquadWithMembersDTO` (ou o DTO do admin) expõe o
nome do líder para a UI. `toSquadWithMembersDTO` serializa o novo campo.

---

## Parte B — Visibilidade de humor para o líder

### B.1 Reaproveitamento

Humor já existe: model `MoodEntry` (`userId`, `mood: MoodLevel`, `note?`,
`day: Date`, único por `(userId, day)`), enum `MoodLevel`
(`GREAT|GOOD|NEUTRAL|LOW|HARD`) e constantes em `packages/shared/src/mood.ts`
(`MOOD_OPTIONS`, etc.). Hoje só há `GET/PUT /me/mood/today`. Esta feature **lê**
humor de terceiros; não altera a escrita.

### B.2 Endpoints (route → service → Prisma)

**1) `GET /me/led-squads/moods`** — squads lideradas pelo usuário atual.

- Carrega squads onde `leaderId === request.user.sub` (ativas), com seus membros
  (`SquadMember`, **excluindo o próprio líder** caso ele também seja membro).
- Para cada membro, o **humor atual** = `MoodEntry` mais recente por `day` desc
  (pode ser `null` se nunca registrou).
- Resposta: `LedSquadMoodsDTO[]` (uma entrada por squad).
- Sem squads lideradas → array vazio (a UI não renderiza a seção).

**2) `GET /users/:userId/mood-history?cursor=&limit=10`** — histórico paginado.

- **Autorização no service:** o requisitante precisa ser líder (`leaderId`) de
  **alguma** squad da qual `:userId` é membro; senão `403` (erro de domínio
  tipado, ex.: `MoodAccessError` com `status` HTTP, tratado na route por
  `instanceof`). O líder não pode ler o histórico do próprio perfil por este
  endpoint (irrelevante) nem de quem não está sob sua liderança.
- Paginação **cursor-based** por `day` desc; `limit` default 10 (com teto).
  `cursor` = `day` da última entrada da página anterior; retorna `nextCursor`
  (ou `null` quando acabou).
- Cada entrada: `{ day, mood, note }` (a **nota é incluída** — o líder vê o
  texto para dar contexto e apoiar a pessoa).

### B.3 Contrato compartilhado

Novo arquivo `packages/shared/src/squad-mood.ts` (exportado no barril):

```ts
export interface MoodSnapshotDTO {
  day: string            // ISO date (YYYY-MM-DD)
  mood: MoodLevel
  note: string | null
}

export interface SquadMemberMoodDTO {
  id: string
  name: string
  avatarStyle?: string
  avatarSeed?: string
  currentMood: MoodSnapshotDTO | null
}

export interface LedSquadMoodsDTO {
  squadId: string
  squadName: string
  members: SquadMemberMoodDTO[]
}

export interface MoodHistoryEntryDTO {
  day: string
  mood: MoodLevel
  note: string | null
}

export interface MoodHistoryPageDTO {
  entries: MoodHistoryEntryDTO[]
  nextCursor: string | null
}
```

(Os campos de avatar seguem o que `toPublicUser`/DiceBear já usam no projeto;
ajustar nomes aos existentes ao serializar.)

### B.4 Frontend

Novo componente `apps/web/src/pages/profile/SquadMoodPanel.tsx`:

- **Renderiza só quando** `isOwnProfile && user.role === "LEAD"`. Quem visita o
  perfil do líder nunca vê o painel; o backend é a barreira real (por `leaderId`).
- Carrega `GET /me/led-squads/moods` (React Query). **Agrupado por squad**: um
  bloco por squad com o nome como cabeçalho; dentro, um **accordion** de membros.
- Cada linha de membro (fechada): avatar + nome + humor atual (emoji/label +
  data) ou "Sem registro".
- Ao expandir uma linha: busca o histórico do membro
  (`GET /users/:id/mood-history`) com **`useInfiniteQuery`** (10 por página) e
  **scroll infinito** via `IntersectionObserver` num sentinela ao fim da lista.
  Cada entrada mostra humor (emoji/label) + data + **nota**. Estados de loading,
  vazio ("Sem histórico") e erro.

**Ajuste de layout (requisito central).** Hoje `BadgeGallery` é filho direto do
grid (`col-span-12 lg:col-span-5`), ao lado da coluna de feedbacks
(`lg:col-span-7`). Um irmão abaixo dele cairia, no grid, **abaixo da coluna de
feedbacks** (que cresce). Solução: envolver a coluna esquerda em **uma única
célula de grid**:

```tsx
<div className="col-span-12 lg:col-span-5 flex flex-col gap-lg">
  <BadgeGallery ... />            {/* sem mais col-span próprio */}
  {showSquadMood && <SquadMoodPanel ... />}
</div>
```

Assim o painel fica **diretamente abaixo da "Galeria de selos"**, na largura de
uma coluna, independente da altura dos feedbacks. `BadgeGallery` perde as
classes `col-span-*` próprias (passam ao wrapper).

### B.5 Privacidade

- Painel só no próprio perfil do líder e só para papel `LEAD`.
- Toda leitura de humor de terceiro passa por autorização por `leaderId` no
  backend; a UI nunca é a única barreira.
- O humor de um membro é exposto **apenas** ao(s) líder(es) da(s) squad(s) dele.

---

## Testes

**API (Vitest + Postgres real):**

- `GET /me/led-squads/moods`: líder recebe suas squads e membros (excluindo a si
  mesmo); humor atual = entrada mais recente; membro sem humor → `null`; usuário
  sem squads lideradas → array vazio.
- `GET /users/:id/mood-history`: líder da squad do alvo recebe página + cursor;
  paginação avança e termina com `nextCursor: null`; **não-líder → 403**; líder
  da squad A **não** lê membro exclusivo da squad B → 403; nota incluída.
- `PATCH /admin/squads/:id` com `leaderId`: define/troca/limpa líder; rejeita
  usuário inexistente/inativo; só admin.
- Migração de papéis: smoke do seed com `LEGEND`/`LEAD` (sem `DEV`).

**Web (jsdom + Testing Library):**

- `SquadMoodPanel` renderiza só para `LEAD` no próprio perfil; não renderiza
  para outros papéis nem em perfil alheio.
- Expandir uma linha busca e lista o histórico; nota visível.
- Scroll infinito dispara a próxima página (mock do `IntersectionObserver`).

---

## Fora de escopo (YAGNI)

- Atribuir usuários a `MANAGER`/`HEAD` e definir alçada de gestor/head (depois).
- Visibilidade de humor para gestor/head (decidido: só o líder).
- Notificações/alertas de humor baixo.
- Sincronizar o campo denormalizado `User.squad` com `SquadMember`.
