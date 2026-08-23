# Destaques — seletor de setor (mesmo padrão de Lendas)

## Contexto

Mesmo padrão do PR #10616 (`docs/superpowers/specs/2026-07-24-lendas-seletor-setor-design.md`),
aplicado à tela de Destaques (`/destaques`, histórico de Destaque do Mês). `GET /highlights`
(`apps/api/src/routes/highlights.ts:6-9`) sempre filtra pelo `sectorId` do JWT, sem query param
algum. `listPublishedHighlights` (`apps/api/src/services/highlight-service.ts:206-213`) **já
aceita `sectorId` opcional** — mesmo gargalo do showcase: falta só a rota expor e o frontend
oferecer a escolha.

Diferença conceitual (não muda a solução, só a expectativa): cada setor tem seu próprio
`VotingPeriod` por mês (`@@unique([sectorId, monthRef])`,
`apps/api/prisma/schema.prisma:372-396`), com `status`/`highlightStatus` independentes. "Setor sem
destaque publicado neste mês" é um estado vazio legítimo — já tratado hoje pela mensagem "Nenhum
destaque publicado ainda." (`HighlightsPage.tsx:106-110`), não precisa de tratamento novo.

**Fora de escopo, explicitamente:** qualquer banner/resumo de "Destaque do Mês" fora da tela
`/destaques` (ex.: Home) continua mostrando só o próprio setor, sem seletor.

## Arquitetura

Sem migration. Reaproveita a rota `GET /sectors` já criada no PR #10616 (branch base desta feature)
— **branch a partir de `feat/lendas-seletor-setor`, não de `origin/main`**, já que essa rota ainda
não está em `main`. Mesmo padrão de query param (`sectorId=<id>|all`) e mesmo enforcement de
`THIRD_PARTY` no backend.

## Componentes

### A. `GET /highlights` aceita `sectorId`

Modify `apps/api/src/routes/highlights.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { listPublishedHighlights } from '../services/highlight-service'
import { toHighlightDTO } from '../lib/serialize'

const highlightsQuerySchema = z.object({ sectorId: z.string().optional() })

export async function highlightRoutes(app: FastifyInstance) {
  app.get('/highlights', { onRequest: [app.authenticate, app.requireFeature('destaques')] }, async (request, reply) => {
    const parsed = highlightsQuerySchema.safeParse(request.query)
    const requestedSectorId = parsed.success ? parsed.data.sectorId : undefined
    const sectorId =
      request.user.role === 'THIRD_PARTY'
        ? request.user.sectorId
        : requestedSectorId === 'all'
          ? undefined
          : (requestedSectorId ?? request.user.sectorId)
    const entries = await listPublishedHighlights(sectorId)
    return reply.send({ highlights: entries.map(toHighlightDTO) })
  })
}
```

(Exatamente a mesma lógica de precedência de `GET /users/showcase`, ver
`apps/api/src/routes/users.ts` no branch base.)

`listPublishedHighlights` não muda — já aceita `sectorId?: string`.

### B. `HighlightsPage.tsx` — seletor de setor

Mesmo padrão de `LegendsPage.tsx` (branch base): `useQuery(['sectors'], ...)` habilitado só pra
papéis internos, `Select` com "Todos os setores" + setores ativos, valor inicial =
`user?.sectorId`, oculto pra `THIRD_PARTY`. `queryKey: ['highlights', sectorId]`, query string
`?sectorId=${sectorId}` (sempre presente pra papéis internos, omitida pra `THIRD_PARTY`).

## Erros e casos de borda

- Setor sem destaque publicado no período (independente de qual `sectorId` foi escolhido): já
  tratado — mensagem "Nenhum destaque publicado ainda." (comportamento inalterado, só passa a
  poder acontecer também pra um setor que não é o seu).
- `THIRD_PARTY` mandando `?sectorId=` manualmente: ignorado, igual ao showcase.

## Testes

- `apps/api/src/routes/highlights.test.ts`: `?sectorId=<outro>` mostra o destaque daquele setor;
  `?sectorId=all` mostra destaques de todos; sem parâmetro cai no próprio setor (não regride o
  teste existente de isolamento); `THIRD_PARTY` com `?sectorId=<outro>` continua só vendo o
  próprio.
- `apps/web/src/pages/HighlightsPage.test.tsx` (criar): seletor pré-selecionado no setor do
  usuário; trocar refaz a busca; "Todos os setores" remove o filtro; oculto pra `THIRD_PARTY`.

## Não-objetivos

- Banner/resumo de Destaque do Mês fora de `/destaques` (ex.: Home) — continua só o próprio setor.
- Qualquer mudança nas rotas administrativas de geração/publicação de destaque (`/admin/periods/...`).
