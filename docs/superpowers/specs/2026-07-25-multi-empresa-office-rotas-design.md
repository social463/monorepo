# Multi-tenancy no Escritório — sub-fatia 2: rotas HTTP — Design

## Contexto

Sub-fatia 2 de 3 do domínio Escritório na linha de trabalho de multi-tenancy. A sub-fatia 1
(dados + services — migration Prisma nos 11 models + `office-map-service.ts`/
`office-setting-service.ts`/`office-guest-service.ts` escopados por `companyId`) já foi
commitada e mergeada em `feat/multi-empresa-auth-jwt-clean` (PR #10609). Desde então,
`apps/api/src/routes/office-maps.ts`, `office-guests.ts`, `office-media.ts` e o trecho
`/admin/office-settings` de `admin.ts` estão com erro de compilação — chamam as funções de
serviço com as assinaturas antigas (sem `companyId`), handoff intencional documentado desde o
plano da sub-fatia 1.

## Escopo

- `apps/api/src/routes/office-maps.ts` — ~24 call-sites de `office-map-service.ts`, todos
  self-service (nenhuma rota aceita `:id` de terceiro que seja usuário).
- `apps/api/src/routes/office-guests.ts` — `createOfficeGuestInvite` (admin, self-service) +
  o fluxo de sessão de convidado (ver seção dedicada abaixo).
- `apps/api/src/routes/office-media.ts` — `getOfficeSettings` em `/office/config` e no branch
  de broadcast de `/office/media-token`.
- `apps/api/src/routes/admin.ts` — 2 call-sites de `/admin/office-settings`
  (`getOfficeSettings`/`setBroadcastEnabled`).

### Fora de escopo

`apps/api/src/routes/office-ws.ts` e `apps/api/src/lib/office-hub.ts` continuam intocados —
sub-fatia 3. `officeHub.configure(...)` chamado dentro dos services continua recebendo o
`ActiveOfficeMapDTO` de sempre, sem `companyId` embutido, sem mudança de forma nesta fatia.

## Convenção

Toda rota repassa `request.user.companyId` como novo argumento/campo pras funções de serviço —
mesmo padrão de todas as fatias anteriores. Nenhuma rota muda de assinatura de
request/response.

## Sessão de convidado — o único ponto não-mecânico desta fatia

Hoje `OfficeGuestJwtPayload.companyId` é fixo `''` (comentário no código: "não são lidos em
lugar nenhum"). Isso ficou obsoleto: depois da sub-fatia 1, `getActiveOfficeMap`/
`getOfficeSettings` exigem um `companyId` real, e são chamados a partir do fluxo de convidado
(`GET /office/guest-map`, e o branch de alto-falante de `POST /office/media-token`).

Decisão: `issueOfficeGuestSession` passa a gravar o `companyId` real (herdado de
`invite.companyId`, já correto desde a sub-fatia 1 — `createOfficeGuestInvite` herda do admin
que criou o convite) no payload do JWT de convidado. Isso muda o tipo
`OfficeGuestJwtPayload.companyId` de `''` (literal) pra `string`. As rotas que hoje verificam
esse JWT (`GET /office/guest-map`, o branch de convidado dentro de `resolveParticipant` em
`office-media.ts`) passam a ler `payload.companyId` direto do JWT já verificado — sem round-trip
extra ao banco, mesmo padrão já usado pro JWT de usuário real.

## Testes

Todos os 4 arquivos de teste de rota tocados (`office-maps.test.ts`, `office-guests.test.ts`,
`office-media.test.ts`, os testes de `/admin/office-settings`) já são 100% HTTP-level
(`app.inject`) — não devem precisar de reescrita de assinatura, só continuar passando (
`request.user.companyId` já vem do JWT em toda request autenticada). Acrescenta-se pelo menos 1
teste adversarial HTTP-level novo fechando o vazamento ponta a ponta (ex.: `GET
/admin/office-maps` não lista mapa de outra empresa), mesmo padrão da fatia de Review — e um
teste cobrindo a mudança de companyId real no JWT de convidado (`GET /office/guest-map` de um
convidado de uma empresa não vê o mapa de outra).
