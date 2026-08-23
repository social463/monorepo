# Humor do Dia — Design Spec (fase 1)

**Data:** 2026-06-22
**Status:** aprovado para implementação
**Slug:** humor-do-dia

## Contexto

Plataforma interna de reconhecimento entre pares (Legends). Queremos um sinal leve
de bem-estar do time: cada pessoa registra, uma vez por dia, como está se sentindo.

Esta é a **fase 1**. Faseamento acordado:

- **Fase 1 (esta entrega):** capturar e salvar o humor diário no Meu Perfil. Privado.
- **Fase futura:** leads leem o humor da equipe.
- **Fase futura:** nova role de gestor que também lê o humor dos leads.
- **Fase futura:** selo de "acessos diários" (ofensiva), derivado do histórico de check-ins.

O modelo de dados desta fase já é desenhado para suportar as fases futuras (histórico
diário permite tanto leitura por leads quanto cálculo de streak), sem precisar editar
migrations depois.

## Escopo da fase 1

Área no **Meu Perfil**, exibida **somente no próprio perfil** do usuário logado, onde
a pessoa registra **uma vez por dia** como está se sentindo, numa escala de 5 humores.

Decisões de produto (acordadas no brainstorming):

- O humor é **salvo** num histórico diário (1 registro por usuário por dia).
- O humor é **privado**: **não altera o avatar** e não aparece publicamente. Respeita
  privacidade — só o próprio usuário vê o seu humor de hoje nesta fase.
- A pessoa **pode trocar** o humor de hoje (atualiza o registro do dia — upsert).
- "Dia" = data civil no fuso **America/Sao_Paulo** (padrão do produto pt-BR).
- **Fora de escopo nesta fase:** mudança de feição do avatar, leitura por leads,
  role de gestor, contador/exibição de ofensiva (streak) e o selo de acessos diários.

### Escala de humores

Escala de bem-estar de 5 pontos, exibida como uma fileira **do pior (esquerda) ao
melhor (direita)** — a ordem de `MOOD_OPTIONS`. Cada opção é renderizada como o
**avatar da própria pessoa** com uma **feição (`face`) do open-peeps** refletindo o
humor (usando `customAvatarDataUri` da lib de avatar). Isso é só o seletor — **o
avatar salvo não é alterado** (privacidade preservada). Não há rótulo visível nem
contorno/fundo no botão; a seleção é indicada por um anel (`ring`) na carinha
escolhida. O `label` de cada humor vira o `aria-label` do botão (acessibilidade).

| Ordem | Valor (enum) | Feição open-peeps | Rótulo (aria-label) |
|-------|--------------|-------------------|---------------------|
| 1 (esquerda) | `HARD`    | `solemn`   | Difícil   |
| 2            | `LOW`     | `concerned`| Pra baixo |
| 3            | `NEUTRAL` | `calm`     | Neutro    |
| 4            | `GOOD`    | `smile`    | Bem       |
| 5 (direita)  | `GREAT`   | `smileBig` | Ótimo     |

O componente recebe o usuário (avatar) por prop a partir do `ProfilePage` (perfil
próprio), evitando dependência de contexto e mantendo-o testável isoladamente.

### Nota opcional

Abaixo das carinhas há uma **caixa de texto opcional**, com placeholder "O que te
faz sentir assim?", limitada a `MOOD_NOTE_MAX_LENGTH` (280) caracteres. Pode ficar vazia —
nesse caso o humor é registrado sem nota (`note: null`). A nota é persistida junto
do humor do dia (`MoodEntry.note`).

## Arquitetura

Segue o padrão do repo: **route → service → Prisma**, contrato em `@legends/shared`,
DTO em `serialize.ts`, rotas finas com validação Zod, frontend com React Query.

### Modelo de dados (`apps/api/prisma/schema.prisma`)

Novo enum e novo model (nova migration via `pnpm db:migrate`, sem editar existentes):

```prisma
enum MoodLevel {
  GREAT
  GOOD
  NEUTRAL
  LOW
  HARD
}

model MoodEntry {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  mood      MoodLevel
  day       DateTime  @db.Date // data civil em America/Sao_Paulo
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@unique([userId, day])
  @@index([userId, day])
}
```

Adicionar a relação inversa em `User`:

```prisma
moodEntries MoodEntry[]
```

O par único `(userId, day)` garante no máximo 1 registro por dia por usuário; trocar
o humor de hoje é um **upsert** nesse par. O campo `day` é `@db.Date` (sem hora) para
representar o dia civil. O cálculo do "dia de hoje" em `America/Sao_Paulo` fica num
helper do service (não depende do fuso do servidor).

### Contrato compartilhado (`packages/shared`)

Novo arquivo `packages/shared/src/mood.ts`, exportado no barril `index.ts`:

- `enum MoodLevel { GREAT, GOOD, NEUTRAL, LOW, HARD }` (espelha o Prisma).
- `MOOD_LEVELS`: lista ordenada com `{ value: MoodLevel; emoji: string; label: string }`
  para o front renderizar os 5 emojis + rótulos sem hardcode duplicado.
- `interface TodayMoodDTO { day: string; mood: MoodLevel | null }` — `day` em
  `YYYY-MM-DD`; `mood` é `null` quando o usuário ainda não registrou hoje.

### API (`apps/api`)

Rotas em `src/routes/mood.ts`, registradas em `buildApp` (`src/app.ts`). Ambas
protegidas por `onRequest: [app.authenticate]` e operam **somente sobre o próprio
usuário** (`request.user.sub`) — não há rota para ler humor de terceiros nesta fase.

- **`GET /me/mood/today`** → `200 TodayMoodDTO`. Retorna o humor de hoje do usuário
  logado, ou `mood: null` se ainda não registrou.
- **`PUT /me/mood/today`** — body `{ mood: MoodLevel }`. Valida com Zod
  (`z.nativeEnum(MoodLevel)` ou `z.enum([...])`); em falha responde
  `400 { message, issues }`. Faz **upsert** em `(userId, day=hoje)` e retorna
  `200 TodayMoodDTO` com o humor gravado.

Service `src/services/mood-service.ts`:

- `getTodayMood(userId: string): Promise<MoodLevel | null>`
- `setTodayMood(userId: string, mood: MoodLevel): Promise<MoodLevel>` (upsert)
- helper interno `todayInSaoPaulo(): Date` (data civil, hora zerada, no fuso de SP)

Serialização em `src/lib/serialize.ts`: `toTodayMoodDTO(day, mood)` → `TodayMoodDTO`.

Sem regra de negócio nas rotas; erros inesperados sobem. (Não há erro de domínio
específico previsto além da validação Zod.)

### Frontend (`apps/web`)

Novo componente `src/pages/profile/MoodOfDay.tsx` (ou `src/components/`, seguindo a
vizinhança do perfil), renderizado em `ProfilePage.tsx` **apenas quando o perfil é o
do usuário logado** (`id === currentUser.id`). No perfil de outras pessoas o
componente não aparece nesta fase.

Comportamento:

- React Query `useQuery({ queryKey: ["mood-today"], queryFn: GET /me/mood/today })`.
- **Sem humor hoje (`mood === null`):** card "Como você está se sentindo hoje?" com os
  5 emojis clicáveis (a partir de `MOOD_OPTIONS`).
- **Com humor hoje:** a seção **não aparece** (o componente renderiza `null`). Assim que
  a pessoa escolhe o humor, a seção some; reaparece apenas no dia seguinte, quando não há
  registro para o novo dia. Não há ação de "alterar" nesta fase (1 escolha por dia).
- Selecionar um emoji dispara `useMutation` → `PUT /me/mood/today` e, no sucesso,
  atualiza o cache `["mood-today"]` (o que faz a seção sumir).
- Estilo Tailwind seguindo os cards vizinhos do perfil. **O avatar não é alterado.**

Chamadas via `apiFetch` (`src/lib/api.ts`), enviando `Content-Type: application/json`
só quando há corpo (padrão do projeto).

## Tratamento de erros

- Validação de entrada inválida (`mood` fora do enum) → `400 { message, issues }`.
- Requisição sem autenticação → `401` (via `app.authenticate`).
- O front trata erro da mutation exibindo mensagem em português e mantendo o estado
  de seleção para nova tentativa (sem otimismo que mascare falha).

## Testes

**API (Vitest + Postgres real, banco `legends_test`):**

- `GET /me/mood/today` sem registro → `mood: null`.
- `PUT /me/mood/today` cria o registro do dia e retorna o humor.
- Segundo `PUT` no mesmo dia **atualiza** (upsert) e não duplica — respeita
  `@@unique([userId, day])`.
- `PUT` com `mood` inválido → `400`.
- Requisição sem auth → `401`.

**Web (jsdom + Testing Library):**

- Estado "perguntar" (sem humor) renderiza os 5 emojis.
- Estado "já registrado" mostra o humor de hoje + ação "alterar".
- Clicar num emoji dispara a mutation e exibe a confirmação.

## Notas para fases futuras (fora de escopo agora)

- **Leitura por leads:** uma rota tipo `GET /teams/.../moods` (ou similar) lendo
  `MoodEntry` do dia/período por squad, protegida por role `LEAD`.
- **Role de gestor:** novo valor no enum `UserRole` (ex. `MANAGER`) com permissão de
  ler o humor dos leads.
- **Ofensiva / selo de acessos diários:** streak de dias consecutivos derivada das
  datas em `MoodEntry`, alimentando um novo `Badge`.
