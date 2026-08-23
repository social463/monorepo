# Contas de liderança (papel `LEAD`)

Data: 2026-06-11

## Problema

Hoje o sistema tem dois comportamentos de conta:

- `ADMIN`: gerencia a plataforma. Não vota, não tem perfil, não é votável, não
  aparece em nenhuma listagem.
- todo o resto (`role != ADMIN`, na prática todos `DEV`): vota, é votável,
  aparece em Time/Lendas/Galeria, acumula selos e pode virar lenda.

Falta um terceiro comportamento. Lideranças — Head de Engenharia, GPM e Tech
Leads — fazem parte do time como qualquer pessoa: **aparecem na seção Time,
têm perfil completo (inclusive criação de avatar) e podem votar e navegar pelo
app**. A **única** diferença em relação a um colaborador é que **não recebem
votos**: não são candidatas na votação, não viram lendas e não acumulam selos.
São, em resumo, "membros do time que não são candidatos a reconhecimento".

Pessoas que recebem conta de liderança:

- Waghner Reis — Head de Engenharia
- Patricia Diletieri — GPM
- Lucca Secco — Tech Lead
- Arthur Pedro — Tech Lead
- Paulo Sarraff — Tech Lead

## Conceito central

O código atual trata `role != ADMIN` como sinônimo de "participa do
reconhecimento". O design separa explicitamente dois conceitos:

- **É candidato a reconhecimento** — pode ser votado, aparece na galeria de
  Lendas, acumula selos e pode virar lenda → **somente `DEV`**.
- **Faz parte do time / pode votar e navegar** — aparece na seção Time, tem
  perfil e vota → `DEV` + `LEAD` (todos menos `ADMIN`).

Resumo por papel:

| Papel   | Vota | É candidato (recebe voto) | Aparece no Time | Aparece em Lendas | Perfil                | Gerencia |
|---------|------|---------------------------|-----------------|-------------------|-----------------------|----------|
| `DEV`   | sim  | sim                       | sim             | sim               | completo              | não      |
| `LEAD`  | sim  | não                       | sim             | não               | completo (edita avatar)| não      |
| `ADMIN` | não  | não                       | não             | não               | nenhum                | sim      |

## Modelo de dados

- Enum `UserRole` passa a ser `DEV | LEAD | ADMIN`.
  - Remover o valor `TECH_LEAD` (está no enum mas não é referenciado em nenhum
    lugar do código nem usado no seed — valor morto). O cargo real (Head de
    Engenharia, GPM, Tech Lead) é descritivo e vive em `User.position`.
  - `packages/shared/src/enums.ts`: `USER_ROLES = ['DEV', 'LEAD', 'ADMIN']`.
  - `apps/api/prisma/schema.prisma`: ajustar o `enum UserRole` e gerar migration.
- `PublicUser.role` já expõe o papel ao front — nenhuma mudança no tipo além do
  enum.

### Migration

Trocar valores de um enum no Postgres exige recriar o tipo. Como nenhuma linha
usa `TECH_LEAD` (seed cria todos como `DEV` ou `ADMIN`), a migration é segura.
Deixar o Prisma gerar a migration a partir do schema atualizado.

A observação central: `/users` é a **mesma** fonte consumida pelo grid do Time
(`TeamPage`) **e** pela lista de candidatos do `VotePage` (ambos usam
`queryKey: ['users']`). Como liderança deve aparecer no Time mas **não** na
votação, mantemos `/users` trazendo todos (DEV + LEAD) e filtramos os
candidatos no `VotePage`. A regra de quem pode receber voto é garantida de
verdade no backend (`createVote`).

- `apps/api/src/routes/users.ts` — `/users` (diretório do Time):
  **sem mudança**. Continua `role: { not: 'ADMIN' }`, ou seja, DEV + LEAD.
- `apps/api/src/services/profile-service.ts` — `listShowcase` (galeria de
  Lendas): `where: { active, role: { not: 'ADMIN' } }` → `role: 'DEV'`.
  Lendas é ranking de reconhecimento; liderança nunca recebe voto, então fica
  de fora.
- `apps/api/src/services/voting-service.ts` — `createVote`:
  - Votante: mantém o bloqueio só para `ADMIN` (`voter.role === 'ADMIN'`
    continua proibido). LEAD vota normalmente.
  - Alvo: **adicionar guard** — se `voted.role !== 'DEV'`, lançar
    `VoteError('Colega inválido para votação.', 400)`. Impede votar em liderança
    ou admin mesmo via chamada direta à API. Esta é a barreira real
    (defense-in-depth); o filtro no front é só UX.
- `getUserProfile` (profile-service): **sem mudança**. Continua retornando
  qualquer usuário por id; um LEAD vem com zero votos/selos.

## Web

- `apps/web/src/App.tsx` e `apps/web/src/components/AppLayout.tsx`: LEAD é
  tratado como não-admin. Cai em `/time` no login, navega por
  Time / Lendas / Votar / Destaques + Meu perfil. O roteamento atual já libera
  (o guard `DevOnly` só barra `ADMIN`; `HomeRoute` só desvia `ADMIN` para
  `/admin`). **Sem mudança de roteamento.**
- `apps/web/src/pages/VotePage.tsx`: a lista de candidatos deriva de `/users`.
  Filtrar a base para `role === 'DEV'` antes da busca/listagem
  (ex.: `const votableUsers = users.filter((u) => u.role === 'DEV')`), para que
  liderança não apareça como alvo de voto.
- `apps/web/src/pages/TeamPage.tsx`: **sem mudança**. Mostra todos de `/users`
  (DEV + LEAD); o cargo (`position`) — "Head de Engenharia", "Tech Lead" etc. —
  já distingue a liderança nos cards.
- `apps/web/src/pages/ProfilePage.tsx`: **sem mudança**. O perfil é completo; a
  edição de avatar é liberada por `isOwnProfile` (independe do papel) e as
  seções de votos/selos já têm estados vazios graciosos quando não há
  reconhecimento.

## Seed

`apps/api/prisma/seed.ts` — adicionar os 5 usuários de liderança com
`role: 'LEAD'`, seguindo o padrão existente (e-mail
`nome.sobrenome@eumedicoresidente.com.br`, `passwordHash` compartilhado
`bcrypt.hash('emr2026@', 10)`):

- waghner.reis@eumedicoresidente.com.br — Waghner Reis — Head de Engenharia
- patricia.diletieri@eumedicoresidente.com.br — Patricia Diletieri — GPM
- lucca.secco@eumedicoresidente.com.br — Lucca Secco — Tech Lead
- arthur.pedro@eumedicoresidente.com.br — Arthur Pedro — Tech Lead
- paulo.sarraff@eumedicoresidente.com.br — Paulo Sarraff — Tech Lead

Como liderança agora aparece nos cards do Time, definir `squad: 'Liderança'`
para que o card não exiba o fallback "Sem squad". O loop de atribuição de selos
do seed já filtra `role === 'DEV'`, então lideranças naturalmente ficam de fora.

## Testes

- `voting-service`: (a) LEAD consegue votar em DEV; (b) votar em alvo `LEAD`
  é rejeitado com 400; (c) admin continua bloqueado como votante.
- `listShowcase` (Lendas): não inclui usuários `LEAD`.
- `/users`: **inclui** usuários `LEAD` (fazem parte do Time).
- `VotePage`: liderança não aparece na lista de candidatos (filtro `role === 'DEV'`).
- App routing: um usuário `LEAD` acessa `/time` e `/votar` sem ser redirecionado.

## Fora de escopo

- Criação de lideranças pela UI de admin (por ora, só via seed).
- Permissões/visões de gestão para lideranças (relatórios, dashboards). Esta
  entrega só dá a elas a capacidade de votar e navegar.
