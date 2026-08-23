# Design — Home "Pulso do time"

**Data:** 2026-06-26
**Status:** Aprovado (design); pendente plano de implementação

## Contexto e problema

Hoje a rota inicial `/` redireciona o usuário não-admin para o próprio perfil
(`/perfil/:id`) e o admin para `/admin` ([App.tsx:43-48](../../../apps/web/src/App.tsx#L43-L48)).
A primeira coisa que a pessoa vê é "eu", quando o Legends é um produto sobre "nós":
reconhecimento entre pares. Isso desperdiça a tela de entrada.

As peças de engajamento já existem, mas estão espalhadas:
- `MuralBanner` (carrossel de feedbacks/selos/moods/resenhas) só aparece no próprio perfil.
- Feed de Resenha vive em `/resenha`.
- Estado do período de votação e CTA de votar ficam só na nav.

## Objetivo

Criar uma **Home feed-first** que seja o "pulso do time hoje": mostra o
reconhecimento acontecendo (banner do mural), abre espaço pra conversa viva (feed
de resenha) e empurra a ação central do produto (votar) quando o período está aberto.

Responde em ~3 segundos: *"o que rolou de bom no time?"* e *"o que eu posso fazer agora?"*.

## Decisões tomadas (brainstorming)

1. **Caráter:** feed-first (pulso do time), não dashboard.
2. **Votação:** faixa de CTA contextual no topo (some/muda quando o período fecha).
3. **Roteamento:** `/` passa a renderizar a Home para usuários não-admin; admin
   continua indo para `/admin`. O redirect atual para o perfil é removido; perfil
   fica acessível só em `/perfil/:id`.

## Layout

Coluna única, mobile-first, dentro do `AppLayout`/`MobileNav` existentes. Três blocos
empilhados de cima pra baixo:

```
┌─────────────────────────────────────┐
│  [faixa] Votação aberta · 4 dias →   │  ← contextual, some/muda quando fechado
├─────────────────────────────────────┤
│  ███  MuralBanner (carrossel)  ███   │  ← o pulso: feedbacks/selos/moods/resenhas
├─────────────────────────────────────┤
│  ✍️  Compor resenha…                 │  ← ReviewComposer
│  ─────────────────────────────────   │
│  📝 Resenha de Fulano  💬 ❤️ 🔁       │  ← feed (scroll infinito)
│  📝 Resenha de Beltrano …             │
└─────────────────────────────────────┘
```

Ordem deliberada: a faixa puxa a ação, o banner dá a prova social rápida, o feed é
onde a pessoa permanece.

## Componentes

### Bloco 1 — `VotingBanner` (novo)
Faixa de votação contextual no topo da Home.

- **Dados:** `useCurrentPeriod` (`GET /periods/current`) e próximo período (`GET /periods/next`).
- **Período aberto:** faixa em cor de destaque — *"Votação aberta · faltam X dias · Votar agora"*,
  com link/botão para `/votar`.
- **Período fechado:** faixa neutra e discreta — *"Próxima votação começa em DD/MM"*, sem botão.
- **Sem período atual nem próximo:** a faixa não é renderizada.
- Cálculo de dias por data (`startsAt`/`endsAt`), coerente com a regra do produto de que
  períodos ativam/encerram por data, não por ação manual.

### Bloco 2 — `MuralBanner` (reuso, sem mudança de lógica)
O carrossel existente ([MuralBanner](../../../apps/web/src/components/MuralBanner.tsx))
é **movido** do próprio perfil para o topo da Home, abaixo da faixa.

- Lógica interna inalterada (rotação, navegação manual, tipos de item, links de deep-link
  para perfil).
- **Removido do perfil próprio** (`ProfilePage`) para não duplicar.

### Bloco 3 — `ResenhaFeed` (extração) + Home
O corpo do feed da `ResenhaPage` (composer + lista + scroll infinito) é **extraído**
para um componente compartilhado `ResenhaFeed`, consumido tanto pela Home quanto por
`/resenha`.

- Reusa: `ReviewComposer`, `ReviewCard`, `ReviewComments`, `useReviewFeed`,
  `useCreateReview`, reações, compartilhamento no mural, menções.
- `ResenhaPage` passa a renderizar `ResenhaFeed` (sem perda de comportamento).
- A nova `HomePage` compõe: `VotingBanner` + `MuralBanner` + `ResenhaFeed`.

## Roteamento (mudanças em App.tsx)

- `HomeRoute` (ou equivalente) para não-admin: renderiza `HomePage` em vez de
  redirecionar para o perfil.
- Admin: comportamento atual mantido (`/admin`).
- Não autenticado: comportamento atual mantido (`/time` / login).
- `/perfil/:id` continua igual; `/resenha` continua existindo (mesma `ResenhaFeed`).

## Fora de escopo (YAGNI)

Destaque do mês, lendas, catálogo de selos e ofensiva **não** entram na Home — já têm
páginas próprias e o banner já pincela o reconhecimento. Evita diluir o foco feed-first.
Ficam a um clique pela navegação.

`/resenha` é mantida por ora (custo zero ao reusar `ResenhaFeed`); reavaliar a sua
existência depois de ver a Home no ar.

## Testes

- **Web (Vitest + Testing Library):**
  - `VotingBanner`: estados aberto / fechado / sem período; cálculo de "faltam X dias".
  - `HomePage`: renderiza os três blocos; rota `/` para não-admin cai na Home (não
    redireciona pro perfil).
  - `ResenhaFeed`: garante que a extração preserva o comportamento do feed (composer +
    lista) usado por Home e `/resenha`.
- Não há mudança de contrato em `@legends/shared` nem no backend — todos os endpoints
  consumidos já existem.

## Riscos / pontos de atenção

- Mover o `MuralBanner` para fora do perfil pode quebrar testes/usos que assumem o
  banner no próprio perfil — revisar `ProfilePage` ao remover.
- A extração de `ResenhaFeed` precisa preservar exatamente o estado e os hooks atuais
  da `ResenhaPage` (scroll infinito, composer) para não regredir a página existente.
