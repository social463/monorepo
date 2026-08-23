# Card do escritório: colega de outro setor + nome do setor no card e no perfil

## Contexto

O mapa do escritório é global (todo mundo aparece, de qualquer setor — decisão já tomada). O card
que abre ao clicar num personagem (`apps/web/src/office/CharacterCard.tsx`) busca dado extra
(cargo, selos) via `GET /users/showcase` (`apps/web/src/office/useOfficeInteractions.ts:99-102`),
**sem** parâmetro de setor — e essa rota, desde a sectorização de Lendas, agora filtra por padrão
pelo setor de quem está logado. Resultado: clicar em alguém de outro setor não encontra o
`ShowcaseEntry` correspondente, e o card cai num fallback mínimo (só iniciais + nome), mesmo que a
pessoa tenha cargo e selos cadastrados normalmente — **não é dado vazio real, é efeito colateral da
sectorização aplicada de forma assimétrica** (mapa global vs. showcase por setor).

Achado um segundo bug, independente, nesse mesmo fallback: ele nunca usa os dados de avatar que já
vêm pelo socket do escritório (`OfficeOccupant.photoUrl`/`avatarStyle`/`avatarSeed`/`avatarOptions`)
— sempre cai em iniciais, mesmo quando a pessoa tem personagem customizado.

Pedido adicional: mostrar o **nome do setor** no card (Lendas/escritório) e no perfil — hoje só
existe `sectorId` cru em `PublicUser`, nenhuma tela de usuário comum mostra o nome.

## Arquitetura

Sem migration. Três mudanças independentes, cada uma isolada:

1. O card do escritório passa a pedir a galeria com `sectorId=all` (mesmo padrão de Lendas/
   Destaques) — consistente com o mapa já ser global.
2. O fallback mínimo do card passa a repassar os campos de avatar do `occupant` (já disponíveis).
3. `PublicUser` ganha `sectorName: string` (resolvido igual a `sectorFeatures`, com um novo helper
   de lookup em lote); exibido no `LegendCard` (então aparece tanto na galeria de Lendas quanto no
   card do escritório, que o reusa) e no `ProfilePage`.

## Componentes

### A. Card do escritório busca `sectorId=all`

Modify `apps/web/src/office/useOfficeInteractions.ts`:

```ts
  const { data: showcase } = useQuery({
    queryKey: ['showcase', 'ativas', 'all'],
    queryFn: () => apiFetch<{ entries: ShowcaseEntry[] }>('/users/showcase?sectorId=all'),
    staleTime: 60_000,
  })
```

`THIRD_PARTY` não precisa de tratamento especial aqui — o backend (`apps/api/src/routes/users.ts`)
já ignora `sectorId=all` pra esse papel e sempre devolve o próprio setor, então o card continua
funcionando igual pra terceirizado, sem branch novo no frontend.

### B. Fallback do card repassa avatar do occupant

Modify `apps/web/src/office/CharacterCard.tsx` — troca `<Avatar user={{ name: occupant.name }} .../>`
por `<Avatar user={occupant} .../>` (o tipo `OfficeOccupant` já tem todos os campos que `AvatarSource`
precisa: `name`, `photoUrl`, `avatarStyle`, `avatarSeed`, `avatarOptions`).

### C. `sectorName` em `PublicUser`

Novo helper em `apps/api/src/lib/sector-features.ts` (mesmo arquivo de `sectorFeaturesFor`), pra
resolver em lote (evita N+1 quando o showcase tem gente de vários setores com `sectorId=all`):

```ts
/** Nome de cada setor, em lote (evita N+1 ao resolver vários usuários de setores diferentes). */
export async function sectorNamesFor(sectorIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(sectorIds)]
  if (unique.length === 0) return new Map()
  const sectors = await prisma.sector.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
  return new Map(sectors.map((s) => [s.id, s.name]))
}
```

`packages/shared/src/auth.ts` — `PublicUser` ganha o campo:

```ts
export interface PublicUser {
  ...
  sectorId: string
  /** Nome do setor — resolvido só onde relevante (showcase, perfil); '' nos demais DTOs. */
  sectorName: string
  ...
}
```

`toPublicUser` (`apps/api/src/lib/serialize.ts`) ganha um 3º parâmetro opcional, default `''` —
**não muda nenhum call site existente** (mesmo padrão que `sectorFeatures` já usa):

```ts
export function toPublicUser(user: User, sectorFeatures: string[] = [], sectorName = ''): PublicUser {
  return {
    ...
    sectorFeatures: sectorFeatures as FeatureKey[],
    sectorName,
  }
}
```

Populado nos dois call sites relevantes:

- `GET /users/showcase` (`apps/api/src/routes/users.ts`): resolve `sectorNamesFor` em lote pros
  `sectorId` de todas as `rows` antes de mapear, passa o nome de cada um pro `toPublicUser` da
  entry correspondente.
- `GET /users/:id/profile` (`apps/api/src/routes/profile.ts`): já resolve `sectorFeaturesFor` pra
  `votingEnabled` — reaproveita a mesma chamada de setor (ou uma nova, enxuta) pra pegar o nome
  também, passa pro `toPublicUser(profile.user, ...)`.

Os demais call sites de `toPublicUser` (login, `/me`, `GET /users`, `/users/:id`, admin) continuam
passando só os 2 primeiros argumentos — `sectorName` fica `''` neles, sem quebrar nada (o
frontend só renderiza a badge de setor quando o valor não é vazio).

### D. Exibição no `LegendCard` e no `ProfilePage`

`apps/web/src/components/LegendCard.tsx` — logo abaixo do badge de cargo:

```tsx
{user.sectorName && (
  <span className="mt-xs font-label text-label-sm text-on-surface-variant">{user.sectorName}</span>
)}
```

`apps/web/src/pages/ProfilePage.tsx` — no grupo de chips ao lado de squad/"na equipe desde"
(mesmo padrão visual dos chips vizinhos):

```tsx
{user.sectorName && (
  <span className="rounded-full border border-outline-variant/50 bg-surface-container-high px-md py-xs font-label text-label-sm text-on-surface-variant">
    {user.sectorName}
  </span>
)}
```

## Erros e casos de borda

- `sectorNamesFor([])` (showcase vazio): retorna `Map` vazio, sem query ao banco.
- Setor deletado/inexistente (não deveria acontecer, `sectorId` é FK): `Map.get` retorna
  `undefined`, `sectorName` cai em `''` (`?? ''`), badge some — mesmo tratamento de "sem dado".

## Testes

- `apps/api/src/lib/sector-features.test.ts`: `sectorNamesFor` resolve múltiplos setores em uma
  query, `[]` de entrada retorna `Map` vazio sem tocar o banco.
- `apps/api/src/routes/users.test.ts`: `GET /users/showcase` inclui `sectorName` correto por
  entry (cobrir com `?sectorId=all` misturando 2 setores).
- `apps/api/src/routes/profile.test.ts`: `GET /users/:id/profile` inclui `user.sectorName`.
- `apps/web/src/office/useOfficeInteractions.test.ts` (se existir; senão pular — não criar teste
  novo só pra isso, é uma mudança de 2 linhas na query): confirmar a query string vira
  `/users/showcase?sectorId=all`.
- `apps/web/src/components/LegendCard.test.tsx` (se existir) / `ProfilePage.test.tsx`: badge de
  setor aparece quando `sectorName` não é vazio.

## Não-objetivos

- Mostrar setor em `GET /users` (lista de time) ou `GET /users/:id` simples — fora do pedido
  ("no card e no perfil").
- Qualquer outra sectorização do escritório (mapa continua global, por decisão já tomada).
