# Multi-tenancy — gaps de admin.ts (companyId em POST /admin/users + ADMIN nunca checado contra empresa do alvo) — Design

## Contexto

Audit de completude da linha de multi-tenancy (PR #10609, já mergeável com `main`) encontrou
dois gaps reais e confirmados em código, os mais graves entre os identificados:

1. **`POST /admin/users` nunca seta `companyId`** no `prisma.user.create` — todo usuário criado
   por qualquer admin, de qualquer empresa, cai em `company-emr` (o `@default` do schema),
   independente da empresa real de quem cria. Some a isso: quando `ADMIN` (não `SUBADMIN`) não
   informa `sectorId`, o fallback é `DEFAULT_SECTOR_ID = 'sector-dev-produto'` — o setor da EMR,
   hardcoded — e o `sectorId` informado nunca é validado como pertencente à empresa do ator.
2. **Padrão sistêmico em `admin.ts`**: só `SUBADMIN` é checado contra o setor do alvo; `ADMIN`
   nunca é checado contra a empresa do alvo. Squads (`PATCH`/membros), períodos de votação
   (`update`/`close`/as 4 sub-rotas de highlight: draft/texto/imagem/publish), votos (`DELETE`),
   revogação de selo de usuário, e revogação de convite terceirizado — todos derivam o escopo do
   `companyId` do **alvo** (`before.companyId`) em vez de validar contra o `companyId` do
   **ator**. `sector-service.ts` já faz certo (recebe `companyId` do ator, usa
   `scopedPrisma(companyId)`) — esse é o padrão a replicar.

Retro (retrospectivas) é um gap maior e nunca escopado — fica de fora, vira sua própria fatia
depois.

## Escopo

### `POST /admin/users` (`apps/api/src/routes/admin.ts`)

- `companyId: request.user.companyId` explícito no `data` do `prisma.user.create` (hoje ausente
  por completo).
- Validação de `sectorId` via `scopedPrisma(request.user.companyId).sector.findUnique(...)` em
  vez de `prisma.sector.findUnique` cru — um `sectorId` de outra empresa passa a dar 400 "Setor
  inválido" (mesma mensagem já usada pra setor inexistente), sem revelar que o setor existe em
  outra empresa.
- Quando `ADMIN` (não `SUBADMIN`, que já é forçado ao próprio setor) não informa `sectorId` no
  body: 400 pedindo pra especificar o setor, em vez de cair silenciosamente no
  `DEFAULT_SECTOR_ID` fixo da EMR.

### Padrão sistêmico — squads, períodos/highlight, votos, badges, convites

Para cada um dos handlers afetados: trocar a busca crua do alvo (`prisma.<model>.findUnique`)
por `scopedPrisma(request.user.companyId).<model>.findUnique(...)` — um alvo de outra empresa
vira 404 genuíno, pra **qualquer** papel de admin (não só `SUBADMIN`). A checagem de `sectorId`
já existente pra `SUBADMIN` continua por cima, como uma restrição adicional mais estreita
(`SUBADMIN` fica preso ao próprio setor dentro da própria empresa; `ADMIN` fica preso à empresa
inteira). Cada função de service correspondente ganha `companyId` como parâmetro (vindo de
`request.user.companyId`), usando `scopedPrisma(companyId)` em vez de derivar o escopo do alvo já
carregado.

Rotas/funções afetadas:
- `PATCH /admin/squads/:id`, `POST /admin/squads/:id/members`,
  `DELETE /admin/squads/:id/members/:userId` → `squad-service.ts` (`updateSquad`, `addMember`,
  `removeMember`).
- `PATCH /admin/periods/:id`, `POST /admin/periods/:id/close` → `admin-service.ts`
  (`updateVotingPeriod`, `closeVotingPeriod`).
- `PATCH /admin/periods/:id/highlight-draft`, `.../highlight-text`, `.../highlight-image`,
  `POST .../highlight-publish` (nomes exatos a confirmar lendo `admin.ts`/`highlight-service.ts`
  no plano) → `highlight-service.ts`.
- `DELETE /admin/votes/:id` → serviço de votos correspondente.
- `DELETE /admin/users/:userId/badges/:userBadgeId` → `badge-service.ts` (`revokeManualBadge`).
- Revogação de convite terceirizado (`third-party-invites.ts`) → `third-party-invite-service.ts`.

### Fora de escopo

- Retro (retrospectivas) — fatia própria, futura.
- `AdminAuditLog`/`DevelopmentThursdayEvent` globais — não fazem parte deste fix (mencionados no
  audit, mas não estão entre "os dois piores" escolhidos pra esta fatia).
- Qualquer UI de gestão de empresas no frontend.

## Testes

Para cada uma das 7 rotas/operações tocadas: um teste adversarial provando que um `ADMIN` de uma
empresa recebe 404 ao agir sobre o recurso de outra empresa (squad, período, voto, badge,
convite) — mesmo padrão já usado no teste de escopo por empresa existente pra `Sector`
(`admin.test.ts`, describe `'escopo por empresa (companyId real do token)'`). Mais os testes
específicos de `POST /admin/users`: `companyId` do usuário criado bate com o do ator (não
`company-emr` fixo); `sectorId` de outra empresa dá 400; `ADMIN` sem `sectorId` no body dá 400
(em vez de usar o default fixo).
