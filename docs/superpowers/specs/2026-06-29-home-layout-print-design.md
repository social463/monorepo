# Home "Pulso do time" — layout do print

- **Data:** 2026-06-29
- **Status:** Design aprovado
- **Evolui:** [`2026-06-26-home-pulso-do-time-design.md`](./2026-06-26-home-pulso-do-time-design.md)

## Objetivo

Reformular a `HomePage` (não-admin, rota `/`) para o layout do mockup de
referência: saudação no topo, **Mural como hero** proeminente e um corpo em
**duas colunas** — feed da Resenha à esquerda e um card **"Minhas Stats"**
(progresso de selos) à direita.

**Premissa central:** a mudança é **100% frontend**. Toda informação já existe
em endpoints atuais — não há schema, migration, rota ou service novos.

## Decisões (forks resolvidos com o usuário)

1. **Hero = Mural.** Não existe feature de comunicados/avisos no backend e não
   vamos criá-la. O `MuralBanner` existente passa a ocupar o lugar do hero do
   print (banner grande, proeminente), mantendo carrossel, auto-rotate e empty
   state.
2. **"Minhas Stats" = progresso de selos.** Não existe sistema de pontos. No
   lugar de "Pontos", o card mostra o **progresso rumo aos próximos selos**
   (mesma lógica da `BadgesPage`/`/selos`), além da contagem de selos
   conquistados e anos de casa.
3. **Hall da Fama:** fora de escopo por enquanto.
4. **"Points" do topo:** removido (sem backend).
5. **VotingBanner sem placeholder:** a faixa de votação **só renderiza quando há
   votação aberta** (`votingOpen === true`). Sem votação aberta ela retorna
   `null` — sem o placeholder neutro e sem a faixa de "próxima votação". A Home
   começa direto no Mural-hero nesse caso.

## Layout

```
┌ Olá, Lucca!   🔥 Streak: 12 ───────────────────────────────┐  saudação (nome + streak)
├ Votação aberta · faltam 5 dias            [ Votar agora ] ──┤  VotingBanner (só se votingOpen)
├──────────────────────── MURAL (hero) ──────────────────────┤  MuralBanner restilizado
│  carrossel: reconhecimentos / selos / moods / resenhas      │  (mantém auto-rotate + empty)
├─────────────────────────────┬──────────────────────────────┤
│  Resenha do time   Ver tudo→│   Minhas Stats               │
│  [ composer ]               │   ┌────────┐                 │  grid 2 colunas (lg+),
│  ReviewCard…                │   │SELOS 14│ 3 anos de casa  │  1 coluna no mobile
│  ReviewCard…  (feed ∞)      │   └────────┘                 │
│                             │   Próximos selos:            │
│                             │   ▸ Colaborador 4/5 ████░    │  top-3 selos por progresso
│                             │   ▸ Ofensiva   5/7 ███░░     │
│                             │   Ver Galeria Completa →      │
└─────────────────────────────┴──────────────────────────────┘
```

- Container: `mx-auto max-w-7xl`, padding `p-lg md:p-xl`, `flex flex-col gap-lg`.
- Corpo em duas colunas a partir de `lg`: `grid lg:grid-cols-[minmax(0,1fr)_320px] gap-lg`
  (sidebar ~320px). Abaixo de `lg`, empilha em coluna única (stats vai para o fim).
- O **header global do `AppLayout`** (busca, NotificationBell, avatar,
  StreakIndicator) permanece intacto em todas as telas. A saudação da Home é
  **conteúdo da página**, não do header global — não duplicamos bell/avatar.

## Componentes

### 1. Saudação (inline na `HomePage`)
- Renderiza `Olá, {primeiroNome}!` + pílula de streak.
- Dados: `useAuth()` (nome) e `useStreak()` (`GET /me/streak` →
  `StreakSummaryDTO.currentStreak`).
- Primeiro nome = `user.name.split(' ')[0]`.
- Enquanto `useStreak` carrega ou falha, a pílula simplesmente não aparece (a
  saudação sozinha já é válida).

### 2. `VotingBanner` (existente — ajuste)
- **Mudança:** renderiza `null` quando `!votingOpen`. Removem-se os ramos de
  "próxima votação" e o placeholder "Nenhuma votação aberta no momento".
- Mantém o estilo da faixa aberta (CTA "Votar agora" → `/votar`).
- Posicionada acima do Mural-hero.

### 3. `MuralBanner` (existente — restilo)
- Vira o **hero**: card maior e mais proeminente (fundo/realce no tema verde do
  produto), seguindo o destaque do print. Mantém:
  - carrossel com auto-rotate (6s, pausa no hover), navegação prev/next, contador;
  - os quatro tipos de slide (feedback, badge, mood, review);
  - o empty state já existente (`data-testid="mural-banner-empty"`).
- Sem mudança de dados (`GET /mural`).

### 4. `MyStatsCard` (novo — `apps/web/src/components/MyStatsCard.tsx`)
Card da sidebar direita. Conteúdo:
- **SELOS**: contagem de selos conquistados = `GET /users/:id/badges` (length),
  com `id = user.id`.
- **Anos de casa**: derivado de `user.joinedAt` (`PublicUser`), em anos completos.
  Texto: `"{n} ano(s) de casa"` (singular/plural). Se `< 1 ano`, mostrar
  `"Menos de 1 ano de casa"`.
- **Próximos selos** (top-3): de `GET /badges` (`BadgeCatalogEntryDTO[]`),
  filtrar os **não conquistados** com `progress != null && progress.target > 0`,
  ordenar por `progress.current / progress.target` desc, pegar os 3 primeiros.
  Para cada: `BadgeEmblem` (tamanho reduzido) + nome + barra de progresso +
  `min(current,target)/target` — **mesma fórmula e UI da `BadgesPage`**
  (`pct = min(100, round(current/target*100))`).
- **Link** "Ver Galeria Completa" → `/selos`.
- "Conquistado" para detectar selos já ganhos: derivar `earnedSlugs` do
  `GET /users/:id/badges` (igual à `BadgesPage`) para excluí-los do top-3.
- **Estados:** loading ("Carregando…"), erro (mensagem curta). Quando não houver
  selos em progresso (todos conquistados ou nenhum com progresso mensurável), a
  seção "Próximos selos" some e o card mantém apenas SELOS + anos de casa.

### 5. Seção "Resenha do time" (reusa `ResenhaFeed`)
- Header com título "Resenha do time" + link **"Ver tudo" → `/resenha`** à direita.
- Corpo = `<ResenhaFeed />` existente (composer + feed infinito), sem mudanças.

## Dados (tudo já existe — sem backend novo)

| Peça | Fonte | DTO/campo |
| --- | --- | --- |
| Saudação | `useAuth()` | `user.name` |
| Streak | `GET /me/streak` (`useStreak`) | `StreakSummaryDTO.currentStreak` |
| Hero | `GET /mural` | `MuralResponse.items` |
| SELOS (contagem) | `GET /users/:id/badges` | `AwardedBadgeDTO[].length` |
| Próximos selos | `GET /badges` | `BadgeCatalogEntryDTO.progress {current,target}` |
| Anos de casa | `useAuth()` | `user.joinedAt` |
| Feed | `GET /reviews` (`useReviewFeed`) | `ReviewDTO` |
| Votação | `GET /periods/current` (`useCurrentPeriod`) | `votingOpen` |

## Testes (Vitest + Testing Library, jsdom)

- **`HomePage.test`** (atualizar): renderiza saudação, hero (Mural), grid de duas
  colunas, e "Minhas Stats". Mockar `/me/streak`, `/mural`, `/reviews`,
  `/periods/current`, `/badges`, `/users/:id/badges`.
- **`MyStatsCard.test`** (novo): contagem de selos; top-3 ordenado por progresso
  excluindo conquistados; anos de casa (0, 1, N); empty (sem selos em progresso).
- **`VotingBanner.test`** (atualizar): mantém o caso "aberta"; troca os casos
  "fechada/sem período" para asserir que **não renderiza nada** (`null`).
- **`MuralBanner.test`**: mantém (restilo não muda comportamento/test-ids).
- **`ResenhaFeed.test`**: inalterado. Adicionar checagem do link "Ver tudo" no
  header da seção (se ficar na HomePage, testar via `HomePage.test`).
- Rodar `pnpm --filter @legends/web test` antes de concluir.

## Fora de escopo

- Hall da Fama.
- Sistema de pontos.
- Feature de comunicados/avisos.
- Qualquer mudança em backend, schema, migrations ou contrato `@legends/shared`.
