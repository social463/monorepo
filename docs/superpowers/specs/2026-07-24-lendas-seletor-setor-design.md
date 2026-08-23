# Lendas — seletor de setor (ver outros setores, padrão o próprio)

## Contexto

A galeria "Lendas" (`GET /users/showcase`) já é sectorizada desde a spec de setorização
(`docs/superpowers/specs/2026-07-22-setorizacao-empresa-design.md`): a rota sempre filtra pelo
`sectorId` do JWT de quem está logado (`apps/api/src/routes/users.ts:34`), sem forma de ver outro
setor. O service por trás, `listShowcase` (`apps/api/src/services/profile-service.ts:26`), já
aceita `sectorId` **opcional** — se vier `undefined`, lista todo mundo sem filtro — então o
mecanismo já suporta tanto "um setor específico" quanto "sem filtro"; só falta a rota expor isso e
o frontend oferecer a escolha.

Pedido: o padrão continua sendo o próprio setor do usuário, mas ele passa a poder trocar pra ver
Lendas de outros setores (ou de todos, ao mesmo tempo).

## Arquitetura

Três mudanças, nenhuma migration:

1. Nova rota `GET /sectors`, autenticada (qualquer papel interno), devolvendo só `{ id, name }` dos
   setores ativos — não reaproveita `/admin/sectors`/`listSectors`, que trazem `enabledFeatures` e
   `roles` (dado de configuração, não deveria vazar pra usuário comum).
2. `GET /users/showcase` ganha `?sectorId=` opcional. `THIRD_PARTY` tem esse parâmetro **ignorado
   no backend** (sempre usa o setor do próprio JWT) — não é só uma questão de esconder o seletor na
   UI, a rota em si não confia no que o terceirizado mandar.
3. `LegendsPage.tsx` ganha um `Select` (componente já existente, reaproveitado das telas de admin)
   com "Todos os setores" + cada setor ativo; valor inicial = setor do próprio usuário; some
   inteiramente pra `THIRD_PARTY`.

## Componentes

### A. `GET /sectors` — lista enxuta pra popular o seletor

Novo arquivo `apps/api/src/routes/sectors.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'

export async function sectorRoutes(app: FastifyInstance) {
  app.get('/sectors', { onRequest: [app.authenticate] }, async (_request, reply) => {
    const sectors = await prisma.sector.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    return reply.send({ sectors })
  })
}
```

Registrado em `apps/api/src/app.ts` junto com as demais rotas (`app.register(sectorRoutes)`).

Novo tipo em `packages/shared/src/sector.ts`:

```ts
export interface SectorOptionDTO {
  id: string
  name: string
}
```

Sem `enabledFeatures`/`roles`/`slug` — únicos campos necessários pro dropdown. Qualquer usuário
autenticado pode chamar (não é admin-only); não há dado sensível no payload.

### B. `GET /users/showcase` aceita `sectorId` (com enforcement de THIRD_PARTY)

Modify `apps/api/src/routes/users.ts`:

```ts
const showcaseQuerySchema = z.object({ former: z.string().optional(), sectorId: z.string().optional() })
```

```ts
  app.get('/users/showcase', { onRequest: [app.authenticate, app.requireFeature('lendas')] }, async (request, reply) => {
    const parsed = showcaseQuerySchema.safeParse(request.query)
    const former = parsed.success ? parsed.data.former : undefined
    const requestedSectorId = parsed.success ? parsed.data.sectorId : undefined
    // THIRD_PARTY nunca escolhe setor — mesmo que mande ?sectorId= na mão, o backend ignora.
    const sectorId =
      request.user.role === 'THIRD_PARTY'
        ? request.user.sectorId
        : requestedSectorId === 'all'
          ? undefined
          : (requestedSectorId ?? request.user.sectorId)
    const rows = await listShowcase({
      former: former === '1' || former === 'true',
      sectorId,
    })
    return reply.send({
      entries: rows.map((row) => ({
        user: toPublicUser(row.user),
        recognitions: row.recognitions,
        badges: row.badges.map(toAwardedBadgeDTO),
      })),
    })
  })
```

`listShowcase` (`profile-service.ts:26`) não muda — já aceita `sectorId?: string` opcional.

### C. `LegendsPage.tsx` — seletor de setor

- `useQuery(['sectors'], () => apiFetch<{ sectors: SectorOptionDTO[] }>('/sectors'))`, habilitada só
  quando `user?.role !== 'THIRD_PARTY'` (pra não bater numa rota que o terceirizado nem vai usar).
- Estado `selectedSectorId`, inicializado com `user?.sectorId` (setor do próprio usuário) — usa
  `useAuth()` já existente na página (via contexto, mesmo padrão de outras páginas).
- `Select` (`apps/web/src/components/Select.tsx`) com
  `options={[{ value: 'all', label: 'Todos os setores' }, ...sectors.map(s => ({ value: s.id, label: s.name }))]}`,
  renderizado só quando `user?.role !== 'THIRD_PARTY'`.
- `queryKey: ['showcase', tab, selectedSectorId]`; `queryFn` monta a query string com
  `sectorId=${selectedSectorId}` junto com `former=1` quando aplicável.
- Para `THIRD_PARTY`: sem seletor, sem query de setores; `selectedSectorId` nunca é usado (a rota já
  ignora o parâmetro de qualquer forma, então nem precisa mandar).

## Erros e casos de borda

- `sectorId` inexistente na query (id inválido/de outra empresa): `listShowcase` filtra por
  `sectorId` igual a esse valor — Prisma não lança erro, só retorna lista vazia. Não precisa de
  validação extra; UX equivalente a "setor sem ninguém ainda".
- `THIRD_PARTY` mandando `?sectorId=` manualmente (via curl/devtools): ignorado, sempre vê o próprio
  setor — comportamento idêntico ao que já existe hoje pra esse papel.
- `GET /sectors` não tem paginação — número de setores é pequeno (dezenas, não milhares); mesmo
  padrão de `listSectors` (`/admin/sectors`), que também não pagina.

## Testes

- `apps/api/src/routes/users.test.ts`: `GET /users/showcase?sectorId=<outro>` retorna a galeria
  daquele setor; `?sectorId=all` retorna todos; sem parâmetro cai no setor do próprio usuário
  (comportamento já coberto, não regride); `THIRD_PARTY` com `?sectorId=<outro>` continua só vendo o
  próprio setor.
- Novo teste de rota para `GET /sectors`: lista só setores ativos, com `{id, name}` (sem
  `enabledFeatures`/`roles` no payload).
- `apps/web/src/pages/LegendsPage.test.tsx` (criar, hoje não existe): seletor aparece com o setor do
  usuário pré-selecionado pra papéis internos; some pra `THIRD_PARTY`; trocar o valor refaz a query
  com o `sectorId` novo; opção "Todos os setores" refaz sem filtro.

## Não-objetivos

- Multi-empresa (`companyId`/`scopedPrisma`) — fora de escopo aqui; `GET /sectors` lista todos os
  setores ativos da empresa única atual, sem filtro de `companyId` (mesmo estado do resto do repo
  hoje; quando multi-empresa entrar em `main`, essa rota precisa do mesmo tratamento que as demais).
- Combinar múltiplos setores específicos de uma vez (ex.: multi-select) — só "um setor" ou "todos".
