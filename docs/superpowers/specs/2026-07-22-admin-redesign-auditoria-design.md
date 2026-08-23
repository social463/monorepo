# Redesign do painel admin: rotas próprias, dashboard e auditoria

**Data:** 2026-07-22
**Status:** aprovado para plano

## Contexto

O painel `/admin` hoje é uma única página (`AdminPage.tsx`) com um `TabBar` de 12 abas trocadas via estado local (`useState<AdminTabId>`) — nenhuma delas tem URL própria. Todo o conteúdo de todas as seções vive dentro da mesma `<section>` com scroll único, o que já ficou longo. Duas funcionalidades relacionadas já escaparam desse modelo e vivem como rotas próprias fora do `TabBar`: `/admin/resenha` (moderação da Resenha, `AdminResenhaPage`) e `/admin/mapas/:mapId/editar` (editor de mapa do escritório, `OfficeMapEditorPage`).

Com a setorização (spec `2026-07-22-setorizacao-empresa-design.md`) já é possível ter mais de uma conta `ADMIN` — mas hoje `ADMIN` é um papel **global**: `requireAdmin` só checa `role === 'ADMIN'`, sem nenhum filtro por setor em nenhuma rota `/admin/*` (confirmado durante essa mesma investigação — criar um "admin do Comercial" não restringe nada). Com múltiplas contas admin de verdade compartilhando o mesmo poder total, **não existe hoje nenhum registro de quem fez o quê** — esta spec cobre os dois problemas juntos: reorganizar a navegação do admin (rotas próprias + sidebar + dashboard) e introduzir um log de auditoria (quem criou/editou/excluiu o quê, com o antes/depois).

## Não-objetivos

- Não introduz o conceito de "admin escopado a um setor" nem um "superadmin" separado — isso foi descartado nesta mesma conversa (`ADMIN` continua um papel único e global; ver Contexto). Fica para uma spec futura, se a necessidade aparecer.
- Não muda a lógica interna de nenhuma das 12 seções existentes — cada `XSection.tsx` continua com seu comportamento atual, só passa a ser roteada na própria URL em vez de renderizada condicionalmente.
- Não audita **leituras** (visualização de tela, listagens) — só criação/edição/exclusão, conforme pedido.
- Não audita ações de altíssima frequência que não são "eventos administrativos" de fato: autosave de rascunho do editor de mapa (`PUT /admin/office-maps/:id/draft`) e heartbeat de lock (`POST /admin/office-maps/:id/lock/heartbeat`) ficam de fora — são detalhes de implementação de um editor colaborativo (salvos a cada poucos segundos), não decisões administrativas. Publicar um mapa (`POST /admin/office-maps/:id/publications`), criar/excluir mapa e criar/excluir asset continuam auditados.
- Não constrói uma tela de "reverter para versão anterior" a partir do log — o log é só leitura/histórico nesta spec.

## Modelo de dados

### `AdminAuditLog` (novo model)

```prisma
enum AdminAuditAction {
  CREATE
  UPDATE
  DELETE
}

model AdminAuditLog {
  id         String            @id @default(cuid())
  actorId    String
  entityType String            // ex.: "Sector", "User", "VotingPeriod", "Badge", "Category", "Squad", ...
  entityId   String
  action     AdminAuditAction
  before     Json?             // null em CREATE
  after      Json?             // null em DELETE
  createdAt  DateTime          @default(now())

  actor User @relation("AdminAuditActor", fields: [actorId], references: [id])

  @@index([entityType, entityId])
  @@index([actorId])
  @@index([createdAt])
}
```

`before`/`after` guardam o registro Prisma relevante serializado (não precisa ser um diff campo-a-campo calculado — grava o "antes" lido antes do `update`/`delete` e o "depois" retornado pelo `create`/`update`; a UI calcula e destaca as diferenças na hora de exibir, evitando lógica de diff duplicada no backend).

### Escopo de instrumentação (rotas cobertas)

Toda rota hoje protegida por `requireAdmin` que muta dado, exceto as duas explicitamente excluídas acima:

- **`admin.ts`**: categorias (create/update), configurações de quinta-dev e do escritório, squads (create/update/add-membro/remove-membro), setores (create/update), usuários (create/update), períodos (create/update/close, geração/edição/publicação de destaque), exclusão de voto, selos (create/update/delete), concessão/revogação manual de selo, edição/exclusão de sala de retro.
- **`office-maps.ts`**: criação/edição/exclusão de mapa, publicação, criação/exclusão de asset, validação, ativação de mapa (`office-map-active`), edição de sala do escritório (`office-rooms/:id`), exclusão de claim de mesa.
- **`office-guests.ts`**: criação de convite de convidado.
- **`third-party-invites.ts`**: criação/revogação/exclusão de convite de terceirizado.
- **`retro.ts`**: exclusão de sala de retro pelo admin (`DELETE /retro/rooms/:id`, quando `requireAdmin` está no `onRequest`).

### Como a gravação é feita

Um helper único, `recordAuditLog`, em `apps/api/src/services/audit-log-service.ts`:

```ts
interface RecordAuditLogInput {
  actorId: string
  entityType: string
  entityId: string
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  before?: unknown
  after?: unknown
  tx?: Prisma.TransactionClient
}
export function recordAuditLog(input: RecordAuditLogInput): Promise<void>
```

Cada função de serviço que já muta dado passa a chamar `recordAuditLog` explicitamente ao final (dentro do mesmo `$transaction` quando já existir um, como em `sector-service.updateSector`). Fica na camada de serviço, não na rota — respeita a convenção do repo — e não exige um mecanismo genérico de interceptação que teria que adivinhar o formato de cada entidade.

## Rotas e admin UI

### Rotas novas (backend)

- `GET /admin/audit-log` — lista paginada, com filtros opcionais `?actorId=&entityType=&from=&to=`, ordenado por `createdAt desc`. Inclui `actor: { id, name }` no DTO.
- `GET /admin/dashboard` — agrega, por setor: estado do período ativo/próximo (`state`, datas), quantos votos já foram registrados no período ativo, status do destaque do último período encerrado (`NONE`/`DRAFT`/`PUBLISHED`), contagem de usuários ativos do setor.

### Reestruturação de rotas (frontend)

`App.tsx` ganha um layout route `AdminLayout` (sidebar + `<Outlet/>`) envolvendo as rotas abaixo, substituindo a atual rota única `/admin` + `TabBar`:

```
/admin                      → AdminDashboardPage (novo)
/admin/setores               → SectorsSection
/admin/lendas                 → CollaboratorsSection
/admin/terceirizados           → ThirdPartySection
/admin/squads                  → SquadsSection
/admin/periodos                → PeriodsSection
/admin/categorias              → CategoriesSection
/admin/selos                    → BadgesSection
/admin/quinta-dev                → DevelopmentThursdaySection
/admin/retrospectivas             → RetrospectivesSection
/admin/moderacao                   → ModerationSection
/admin/resenha                       → AdminResenhaPage (já existe, passa a entrar no menu)
/admin/escritorio                     → OfficeSection
/admin/mapas                            → MapsSection
/admin/auditoria                          → AdminAuditLogPage (novo)
```

`/admin/mapas/:mapId/editar` continua existindo como está (tela cheia, sem sidebar) — só o item de menu "Mapas" (`/admin/mapas`) que leva até a lista de onde se abre o editor.

### Sidebar do admin (`AdminSidebar.tsx`, novo)

Menu dedicado (não reaproveita a sidebar principal do app), agrupado:

- **Visão geral** — Dashboard
- **Organização** — Setores · Lendas · Terceirizados · Squads
- **Reconhecimento** — Períodos · Categorias · Selos
- **Comunidade** — Quinta de Dev · Retrospectivas · Moderação · Resenha
- **Escritório** — Escritório · Mapas
- **Sistema** — Auditoria

Cada item usa `NavLink` do React Router para destacar a rota ativa (mesmo padrão de destaque que a sidebar principal já usa).

### `AdminDashboardPage` (novo)

Um card por setor (busca `GET /admin/dashboard`), mostrando: nome do setor, badge de estado do período (Agendado/Ativo/Encerrado, cores já usadas em `PeriodsSection`), "X de Y votaram" quando há período ativo, alerta se o destaque do último período encerrado ainda não foi gerado/publicado, contagem de usuários ativos. Sem interação além de um link "Ver períodos" que leva pra `/admin/periodos`.

### `AdminAuditLogPage` (novo)

Lista paginada (`GET /admin/audit-log`), uma linha por evento: avatar/nome do autor, ação (badge Criou/Editou/Excluiu), tipo + id da entidade, timestamp relativo. Cada linha expande para mostrar `before`/`after` lado a lado (chaves que mudaram destacadas). Filtros no topo: autor (select dos admins), tipo de entidade (select), intervalo de datas.

## Testes

Seguindo a convenção do repo (Vitest colocado ao lado do código; Postgres real para a API):

- `apps/api/src/services/audit-log-service.test.ts` — `recordAuditLog` grava corretamente CREATE (before null)/UPDATE (before+after)/DELETE (after null); funciona dentro de uma transação existente.
- Para cada função de serviço instrumentada: extensão do teste já existente confirmando que uma `AdminAuditLog` foi criada com os campos certos (não um arquivo novo por entidade — só mais uma asserção nos testes que já existem).
- `apps/api/src/routes/admin.test.ts` (ou arquivo próprio) — `GET /admin/audit-log` pagina e filtra corretamente; `GET /admin/dashboard` calcula estado/contagens certos com dois setores.
- `apps/web/src/pages/admin/AdminDashboardPage.test.tsx`, `AdminAuditLogPage.test.tsx` (novos).
- `apps/web/src/pages/admin/AdminSidebar.test.tsx` (novo) — cobre agrupamento e destaque da rota ativa.
- Ajuste dos testes existentes de `AdminPage`/`TabBar` (removidos) e de cada `XSection` que hoje talvez monte via `AdminPage` em algum teste de integração — conferir durante o plano.

## Riscos / pontos de atenção

- **Volume de instrumentação:** ~25-30 funções de serviço mutam dado hoje sob `requireAdmin`. Cada uma precisa de uma chamada a `recordAuditLog` com o `entityType`/`before`/`after` corretos — trabalho mecânico, mas espalhado por muitos arquivos; o plano deve quebrar isso em tasks pequenas e testáveis independentemente (ex.: por área — setores/usuários, períodos/destaques, selos/categorias, squads/terceirizados, escritório/mapas).
- **`before` em `CREATE` e `after` em `DELETE`:** ficam `null` — a UI precisa tratar esses casos ao renderizar o diff (não é "campo que virou null", é "não existia antes"/"não existe mais").
- **Sem `actorId` disponível:** toda rota já protegida por `requireAdmin` tem `request.user.sub` (o autor é sempre um admin autenticado) — não há caminho de mutação admin sem ator conhecido.
- **Redirecionamentos:** o menu do admin muda de abas para rotas; qualquer link direto hardcoded para `/admin` esperando uma aba específica (se existir) precisa ser conferido durante o plano.
