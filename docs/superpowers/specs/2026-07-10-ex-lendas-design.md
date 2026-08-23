# Ex-Lendas — Hall da Fama para quem sai do time

**Data:** 2026-07-10
**Status:** design aprovado (aguardando review do spec)

## Problema

Quando alguém sai do time, precisamos **revogar o acesso** ao Legends sem
**apagar os registros** da pessoa (votos dados/recebidos, feedbacks, selos,
Destaques do Mês vencidos). Hoje um usuário desativado simplesmente some de
tudo e vira um perfil órfão — não há um lugar que reconheça essas "ex-lendas".

Objetivo: dar a essas pessoas um **Hall da Fama** ("Ex-Lendas") preservando todo
o histórico, mantendo o perfil acessível e marcado, e bloqueando o acesso.

## O que já existe (não precisa mudar)

O campo `User.active` (boolean) já cobre três dos quatro comportamentos:

1. **Bloqueio de login** — `authenticateUser` rejeita `!user.active`; o
   `/auth/refresh` também revalida e derruba a sessão no próximo refresh
   (`apps/api/src/services/auth-service.ts`, `apps/api/src/routes/auth.ts`).
2. **Saída das votações** — `voting-service` exige alvo/votante `active`; mural,
   `GET /users` e o showcase filtram `active:true`.
3. **Histórico intacto** — nada é deletado; não há `onDelete: Cascade` em
   Vote/Feedback/UserBadge, então os registros permanecem.

O que falta: um **lugar** para as ex-lendas, uma **marca** semântica/visual, e
**proteger o e-mail** de quem saiu.

## Decisões de design

- **`active` e `leftAt` são independentes.**
  - `active` = pode logar / participa das votações (cabeamento atual, intocado).
  - `leftAt != null` = **é ex-lenda** → entra no Hall da Fama.
  - Um `active=false` sem `leftAt` continua significando "desativado
    temporário" e **não** aparece nas Ex-Lendas. Essa separação é o motivo de
    existir o `leftAt` em vez de reusar só o boolean.
- **Ação "Desligar" (admin)** grava `active:false` + `leftAt:<data>` de uma vez;
  "Reativar" limpa os dois (`active:true`, `leftAt:null`).
- **E-mail oculto para ex-lenda.** `PublicUser.email` passa a `string | null`;
  em `toPublicUser`, `leftAt != null` ⇒ `email:null`. `toAdminUser` sobrescreve
  com o e-mail real (admin continua enxergando).

## Mudanças

### 1. Dado & contrato

- **Schema** (`apps/api/prisma/schema.prisma`): adicionar `leftAt DateTime?` ao
  model `User`. Migration nova via `pnpm db:migrate` (nunca editar aplicada).
- **Contrato** (`packages/shared/src/auth.ts`):
  - `PublicUser.email: string | null` (era `string`).
  - `PublicUser.leftAt: string | null` (novo, ISO).
- **Serialize** (`apps/api/src/lib/serialize.ts`):
  - `toPublicUser`: inclui `leftAt` (ISO ou null); quando `leftAt != null`,
    retorna `email: null`.
  - `toAdminUser`: sobrescreve `email` com o valor real do usuário.

### 2. Backend — desligar & vitrine

- **Admin** (`apps/api/src/routes/admin.ts`): `updateUserSchema` aceita
  `leftAt` opcional (ISO datetime **ou** `null`). O service de update grava o
  campo; sem regra de negócio extra além do que já valida `active`/role.
- **Vitrine** (`apps/api/src/services/profile-service.ts`): `listShowcase`
  recebe `{ former?: boolean }`. Sem `former` → `where:{ active:true }` (atual).
  Com `former` → `where:{ leftAt:{ not:null } }`. A agregação de reconhecimentos
  e selos é idêntica, então a ex-lenda mantém votos recebidos e selos.
- **Rota** (`apps/api/src/routes/users.ts`): `GET /users/showcase` aceita
  `?former=1` (Zod no query) e repassa a flag ao service.
- **Perfil**: `GET /users/:id/profile` já retorna independente de `active` —
  o perfil da ex-lenda continua acessível por link direto; agora expõe `leftAt`.

### 3. Frontend

- **`apps/web/src/pages/LegendsPage.tsx`**: aba **"Ex-Lendas"** (Hall da Fama).
  Ao selecionar, busca `showcase?former=1` e reusa o card existente. Card e
  perfil exibem selo **"Ex-Lenda · saiu em mmm/aaaa"** (derivado de `leftAt`).
  Tratar `email` possivelmente nulo na UI.
- **Admin (tela de usuários)**: botão **"Desligar"** (campo de data, default
  hoje) que faz o PATCH `{ active:false, leftAt }`; botão **"Reativar"**
  (`{ active:true, leftAt:null }`).

## Testes

- **API**:
  - `listShowcase({ former:true })` retorna só quem tem `leftAt` setado; sem a
    flag, só `active:true`.
  - `PATCH /admin/users/:id` grava e limpa `leftAt`.
  - `toPublicUser` oculta e-mail quando `leftAt != null`; `toAdminUser` mantém.
  - Perfil de usuário inativo/ex-lenda ainda acessível via `GET /users/:id`.
  - (Bloqueio de login por `active` já é coberto pelos testes existentes.)
- **Web**: aba Ex-Lendas renderiza a lista `former`; selo de ex-lenda aparece.

## Fora de escopo

- Exportar/baixar os dados da pessoa.
- Anonimizar histórico (LGPD "esquecimento") — aqui o objetivo é o oposto:
  preservar e homenagear.
- Notificar a pessoa por e-mail ao desligar.
