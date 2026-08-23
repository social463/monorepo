# Subadmin: conta de gestão restrita ao próprio setor

**Data:** 2026-07-23
**Status:** aprovado para plano

## Contexto

Hoje só existe um papel de gestão, `ADMIN`, com poder total sobre a empresa inteira — confirmado nesta mesma sessão (`requireAdmin` só checa `role === 'ADMIN'`, sem filtro de setor em nenhuma rota `/admin/*`). Com a empresa setorizada (setores independentes, cada um com seus colaboradores, squads, períodos de votação, categorias/selos próprios ou globais), faz sentido ter uma conta de gestão **restrita a um único setor** — um "gerente do setor" sem visibilidade nem poder de edição sobre os demais.

## Modelo de papel e autenticação

`SUBADMIN` entra em `USER_ROLES` (`packages/shared/src/enums.ts`), como um papel de **gestão pura** — mesmo tratamento que `ADMIN` já recebe hoje nos pontos que o excluem da vida normal de colaborador:

- `squad-service.ts`: "Administradores não entram em squads" → passa a excluir `SUBADMIN` também.
- `voting-service.ts`: "Administradores não votam" → idem.
- `retro-service.ts`: "Administradores não participam de retrospectivas" → idem.
- `review-service.ts`, `feedback-service.ts`, `development-thursday-service.ts`, `users.ts`, `admin.ts`: todo filtro `role: { not: 'ADMIN' }`/`role !== 'ADMIN'` usado para excluir administradores de listagens de colaboradores/apresentadores/autores passa a excluir `SUBADMIN` da mesma forma.

Um Subadmin **nunca** pode criar ou promover outra conta para `ADMIN` ou `SUBADMIN`, nem no próprio setor — isso continua exclusivo do `ADMIN` global (evita autoescalonamento de privilégio). Um Subadmin também não pode editar contas `ADMIN`/`SUBADMIN` de ninguém (nem do próprio setor).

Dois gates novos/ajustados no backend (`apps/api/src/app.ts`):

- `requireAdminOrSubadmin` — substitui `requireAdmin` nas rotas que o Subadmin acessa (listadas abaixo). Cada handler então filtra por `request.user.sectorId` quando `request.user.role === 'SUBADMIN'`; sem filtro quando `'ADMIN'`.
- `requireAdmin` (inalterado) continua exclusivo do ADMIN global nas rotas que ficam fora do alcance do Subadmin: Setores, Auditoria, Escritório, Mapas de escritório, e a listagem/gestão de outros administradores.
- `requireFeature` (hoje bypassado só por `ADMIN`) passa a bypassar por `ADMIN` **ou** `SUBADMIN`.

O JWT já carrega `sectorId` — nenhuma mudança de payload é necessária.

## Escopo por área (backend)

Convenção: "próprio setor" = `request.user.sectorId` de quem está autenticado como Subadmin.

- **Dashboard** (`GET /admin/dashboard`): a resposta já é uma lista de cards por setor; para Subadmin, filtra a lista pra conter só o card do próprio setor.
- **Lendas** (`/admin/users`): listagem filtra por `sectorId`. Criar/editar força `sectorId` = o do Subadmin (ignora o que vier no payload) e recusa `role` `ADMIN`/`SUBADMIN` no corpo (só `LEGEND`/`LEAD`/`MANAGER`/`HEAD`). Editar um usuário de outro setor, ou um `ADMIN`/`SUBADMIN` de qualquer setor, retorna 404 (não revela existência).
- **Squads**: listagem filtra por `sectorId`. Criar força `sectorId` do Subadmin (ignora o do payload). Editar/adicionar/remover membro só é permitido se a squad já pertencer ao setor do Subadmin (404 caso contrário); não é possível mover uma squad para outro setor via essa conta.
- **Períodos e Destaque do mês**: listagem/criação/edição/fechamento/geração e publicação do Destaque restritos a `period.sectorId === próprio setor`. O parâmetro de query `?sectorId=`, se enviado por um Subadmin, é ignorado e sobrescrito pelo dele.
- **Categorias e Selos**: Subadmin vê os **globais** (leitura, sem editar/ativar-desativar) mais os **específicos do próprio setor** (CRUD completo). Criar sempre força `global: false, sectorIds: [próprioSetor]`, ignorando `global`/`sectorIds` vindos do payload. Editar só é permitido quando o item já pertence **exclusivamente** ao próprio setor (`sectorIds` é exatamente `[próprioSetor]`) — um item compartilhado com outro setor (ou global) é bloqueado para edição por essa conta (403).
- **Terceirizados**: `ThirdPartyInvite` ganha `sectorId String @default("sector-dev-produto")` (migration, mesmo padrão já usado em `Squad`/`VotingPeriod`) — todo convite passa a carregar o setor de quem convidou. `acceptThirdPartyInvite` (`apps/api/src/services/third-party-invite-service.ts`) passa a gravar `sectorId: invite.sectorId` explicitamente ao criar a conta `THIRD_PARTY` (hoje cai no default da coluna, sem relação com o convite). Listagem/criação de convites restrita ao `sectorId` do Subadmin.
- **Moderação (votos)**: `GET/DELETE /admin/votes` filtra pelo `sectorId` do período do voto (`vote.period.sectorId`) — Subadmin só vê/remove votos do próprio setor.
- **Quinta de Dev / Retrospectivas / Resenha**: sem `sectorId` próprio nessas entidades hoje (e, na prática, só o setor Desenvolvimento de Produto usa essas features atualmente). Não é criado particionamento de dados por setor para elas nesta spec — a visibilidade do Subadmin nessas telas segue exatamente o mecanismo que já existe hoje (a feature aparece se o `sectorFeatures` do próprio setor do Subadmin a habilita), sem filtro adicional de registros. Se outro setor ativar essas features futuramente e precisar de dados segregados, é uma spec própria.
- **Setores, Auditoria, Escritório, Mapas de escritório**: continuam 100% exclusivos do `ADMIN` global — Subadmin não tem rota nem UI para essas áreas.

## UI do painel (frontend)

- **`isAdmin`** (hoje usado em `AppLayout.tsx`/`nav-items.ts`/redirecionamentos de login) passa a significar `role === 'ADMIN' || role === 'SUBADMIN'` — Subadmin recebe o mesmo tratamento de conta-de-gestão já construído para ADMIN (sidebar principal do app some dentro de `/admin`, sem indicador de ofensiva, redireciona para `/admin` no login).
- **`AdminSidebar`**: os grupos/itens exclusivos do ADMIN global (Setores, Auditoria, Escritório, Mapas) não aparecem para o Subadmin. Sidebar mostra Dashboard, Lendas, Terceirizados, Squads, Períodos, Categorias, Selos, e o grupo Comunidade (Quinta de Dev/Retrospectivas/Moderação/Resenha, condicionado a `sectorFeatures` do próprio setor, igual já funciona hoje para qualquer usuário).
- **Guarda de rota**: as páginas exclusivas do ADMIN (`/admin/setores`, `/admin/auditoria`, `/admin/escritorio`, `/admin/mapas`, `/admin/mapas/:id/editar`) passam a exigir `role === 'ADMIN'` estritamente — um Subadmin que tente acessar por URL direta é redirecionado para o Dashboard do admin, não só fica sem o link no menu.
- **Formulários de criar/editar** (Lendas, Squads, Períodos, Terceirizados): quando quem está logado é Subadmin, o seletor de setor não é renderizado (o setor é implícito e fixo; o backend força de qualquer forma, então mostrar um seletor travado com uma única opção seria ruído).
- **Categorias/Selos**: para o Subadmin, itens globais aparecem na lista sem os botões de editar/ativar-desativar (só leitura); o checkbox "Global" e a lista de setores não aparecem no formulário de criação (sempre específico do próprio setor); um item específico de mais de um setor (não exclusivamente o dele) também aparece sem controles de edição.
- **Lendas**: o seletor de papel no formulário de criar/editar não oferece `ADMIN`/`SUBADMIN` como opção quando quem está logado é Subadmin.

## Testes

Seguindo a convenção do repo (Vitest colocado ao lado do código; API testa contra Postgres real): para cada uma das 7 áreas de escopo backend, um teste provando isolamento entre dois setores (Subadmin do setor A não vê/lista/edita nada do setor B, recebe 404/403 ao tentar) e um teste de recusa de escalonamento de papel (não consegue criar/promover para `ADMIN`/`SUBADMIN`, não consegue editar uma conta `ADMIN`/`SUBADMIN`). No frontend, testes garantindo que a `AdminSidebar` e os formulários escondem o que não deveria aparecer para o papel `SUBADMIN`, e que a guarda de rota redireciona corretamente para as páginas exclusivas do ADMIN.

## Fora de escopo

- Particionamento de dados por setor em Quinta de Dev, Retrospectivas e Resenha (ver nota acima).
- Um Subadmin promover outro Subadmin (mesmo do próprio setor) — descartado, fica exclusivo do ADMIN global.
- Acesso do Subadmin a Setores, Auditoria, Escritório ou Mapas de escritório, sob qualquer forma.
- Filtro de setor na tela de Auditoria (permanece exclusiva do ADMIN global nesta versão).
