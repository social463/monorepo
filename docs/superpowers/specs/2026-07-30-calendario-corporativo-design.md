# Calendário corporativo — aniversários, tempo de casa, férias e reuniões

**Data:** 2026-07-30

## Problema

As datas do time estão espalhadas e incompletas. Aniversários e tempo de casa
vivem em `/aniversarios`, uma lista do mês corrente sem navegação, alcançável só
pelos cards da Home. Férias não existem em lugar nenhum — ninguém sabe quem está
fora na semana que vem. E marcar reunião só é possível de dentro do escritório
virtual, parado dentro da sala.

Falta uma tela única de "o que acontece com o time neste mês", com filtro por
tipo de evento e com a ação de marcar reunião a partir de um dia do calendário.

## Escopo

Uma rota nova, **`/calendario`**, no menu principal, mostrando quatro tipos de
evento com filtro independente:

1. **Aniversários** (já existe: `celebration-service`)
2. **Tempo de casa** (já existe: derivado de `joinedAt`)
3. **Férias** (novo: modelo, API e cadastro)
4. **Reuniões** (já existe: `office-meeting-service`, hoje só acessível na sala)

Mais o cadastro de férias no lugar onde o gestor já vê seus liderados, e a
possibilidade de marcar reunião a partir do calendário escolhendo a sala.

**Fora de escopo:** integração com calendário externo (Google/Outlook) — é a
feature da branch `feat/integracao-calendario`, independente desta; feriados;
aprovação/workflow de férias (o lançamento do gestor é a verdade); saldo de dias.

## Decisões

| Decisão | Escolha |
|---|---|
| Quem cadastra férias | Gestor direto (LEAD das squads que lidera, MANAGER da sua área) + ADMIN/SUBADMIN |
| Quem vê férias | Todos do setor — mesmo escopo dos aniversários |
| Salas da reunião | As salas do escritório virtual (mapa ativo), não um cadastro novo |
| Reuniões no calendário | As suas (organizador ou participante) por padrão, com toggle "todas as salas" |
| `/aniversarios` | Absorvida pelo `/calendario`; a rota antiga redireciona |

## Contexto do repo

- `apps/api/src/services/celebration-service.ts` — aniversários e tempo de casa
  do **setor** do viewer, dia/mês lidos em UTC de propósito (`birthDate` é
  `@db.Date` e `joinedAt` nasce de um input `type="date"`). Trata 29/02.
- `apps/api/src/services/squad-mood-service.ts:119` — `canSeeMoodHistory`, hoje
  privada, é a única definição de "quem eu gerencio": LEAD → membros das squads
  ativas que lidera; MANAGER → líderes/lendas ativos da sua área.
- `apps/web/src/pages/profile/SquadMoodPanel.tsx` — o painel "Humor do time",
  renderizado só no próprio perfil de quem lidera (`ProfilePage.tsx:577`). É
  *o* lugar onde o gestor vê sua equipe.
- `apps/api/src/services/office-meeting-service.ts` — reuniões por
  `(companyId, roomExternalKey)`, nunca por `OfficeRoom.id` (aquelas linhas são
  recriadas a cada publicação de mapa). Conflito de horário é 409 informativo
  com `force` para marcar mesmo assim. Já gera `.ics`, links de Google/Outlook,
  notificação e deep link da sala.
- `apps/api/src/services/office-map-service.ts:950` — `listActiveOfficeRooms`,
  exposta hoje só em `/admin/office-rooms`.
- `apps/web/src/pages/DevelopmentThursdayPage.tsx:285` — a grade de mês
  (`grid-cols-7` + painel lateral de 360px) que serve de base visual.
- `apps/api/src/routes/calendar.ts` **não existe nesta branch** — é da
  `feat/integracao-calendario` (OAuth externo). Prefixos e arquivos desta spec
  não colidem com os de lá.

## Modelo de dados

```prisma
model Vacation {
  id          String   @id @default(cuid())
  userId      String
  startDate   DateTime @db.Date
  endDate     DateTime @db.Date
  note        String?
  createdById String
  companyId   String   @default("company-emr")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user      User    @relation("Vacations", fields: [userId], references: [id], onDelete: Cascade)
  createdBy User    @relation("VacationsCreated", fields: [createdById], references: [id])
  company   Company @relation(fields: [companyId], references: [id])

  @@index([companyId, startDate])
  @@index([userId])
}
```

`@db.Date` pelo mesmo motivo de `birthDate`: férias são datas civis, sem hora e
sem fuso. A leitura usa componentes **UTC**, como `civilDayMonth` no
`celebration-service` — converter para America/São_Paulo jogaria toda data
vinda do formulário um dia para trás.

Regras de domínio, em `vacation-service.ts`, com erro tipado `VacationError`
(`status` HTTP, padrão `VoteError`):

- `endDate >= startDate` → 400.
- Períodos da mesma pessoa não se sobrepõem → 400 citando o período que colide
  (a checagem ignora o próprio registro ao editar).
- `note` opcional, `trim`, máximo 200 caracteres.
- Criar/editar exige permissão sobre o **alvo**, não sobre o registro.

## Permissões — `team-scope-service.ts`

A regra de "quem eu gerencio" ganha dono próprio em
`apps/api/src/services/team-scope-service.ts`:

```ts
managesUser(viewerId: string, targetId: string): Promise<boolean>
listManagedMembers(viewerId: string): Promise<ManagedGroup[]>  // [{ groupId, groupName, members }]
```

Semântica idêntica à de hoje: LEAD → membros das squads ativas que lidera;
MANAGER → líderes/lendas ativos da mesma área e empresa; demais → nada.
ADMIN/SUBADMIN não passam por aqui — têm passe livre dentro da própria empresa,
checado nas rotas.

`squad-mood-service` passa a consumir esse módulo em vez de manter sua cópia
privada. É a única mudança de comportamento zero desta spec: mesma regra, um
dono só, testada uma vez.

## API

### Rotas novas — `routes/vacations.ts`

| Método | Rota | Quem | Resposta |
|---|---|---|---|
| `GET` | `/vacations?from&to` | autenticado | `{ vacations: VacationDTO[] }` — ativos do **setor** do viewer, mesma empresa, que intersectam o intervalo |
| `POST` | `/vacations` | gestor do alvo, ADMIN | 201 `{ vacation }` |
| `PATCH` | `/vacations/:id` | idem | `{ vacation }` |
| `DELETE` | `/vacations/:id` | idem | 204 |
| `GET` | `/me/team/vacations` | LEAD/MANAGER | `{ groups: Array<{ groupId, groupName, members: Array<{ user, vacations }> }> }` |

`from`/`to` em `YYYY-MM-DD`, obrigatórios, intervalo máximo de 366 dias.
Sem permissão sobre o alvo → 403 `{ message: 'Sem permissão para lançar férias desta pessoa.' }`.

### Rota nova — em `routes/office-maps.ts`

`GET /office/rooms` (autenticado, 403 para `GUEST`) → `{ rooms: OfficeRoomOptionDTO[] }`,
reusando `listActiveOfficeRooms`. DTO enxuto — `externalKey`, `name`, `capacity`,
`status`, `voiceEnabled` — sem `allowedUsers`, que só interessa ao admin.

### Rotas alteradas

- **`GET /celebrations?month=YYYY-MM`** (opcional). Sem o parâmetro, resposta
  idêntica à de hoje. Com ele, `birthdays.month` / `workAnniversaries.month`
  passam a ser do mês pedido; `today` continua sendo o dia civil real. O formato
  de `CelebrationsResponse` não muda.
- **`GET /office/meetings`**: `room` vira **opcional**. Sem `room`, lista as
  reuniões não canceladas da empresa no intervalo, filtradas por "sou
  organizador ou participante" — salvo `mine=false`, que traz todas as salas.
  Com `room`, comportamento atual intacto. Intervalo máximo de 62 dias.
  `GUEST` continua barrado.

### Contrato compartilhado

`packages/shared/src/vacation.ts` (novo, exportado no barril):

```ts
export interface VacationDTO {
  id: string
  user: PublicUser
  startDate: string   // YYYY-MM-DD
  endDate: string     // YYYY-MM-DD
  note: string | null
}
export interface CreateVacationRequest { userId: string; startDate: string; endDate: string; note?: string }
export interface UpdateVacationRequest { startDate?: string; endDate?: string; note?: string | null }
export const VACATION_NOTE_MAX_LENGTH = 200
```

`packages/shared/src/office-map.ts` ganha `OfficeRoomOptionDTO`.
`packages/shared/src/third-party.ts` ganha a `FeatureKey` `'calendario'` com o
label `'Calendário'`.

## Frontend

### Menu e rotas

- `nav-items.ts`: `{ to: '/calendario', label: 'Calendário', icon: 'calendar_month', feature: 'calendario' }`,
  logo abaixo de "Time", nas listas de lenda **e** de admin (admin não tem
  `feature`, o item é fixo).
- `App.tsx`: rota `/calendario` → `CalendarPage`; `/aniversarios` →
  `<Navigate to="/calendario?filtros=aniversarios,tempo-de-casa" replace />`.
- `BirthdaysCard` e `WorkAnniversariesCard` (Home) passam a apontar para
  `/calendario` com o filtro correspondente já aplicado.
- `CelebrationsPage.tsx` e seu teste são removidos; `CelebrationTile` continua,
  usado pela Home.
- Seed: `'calendario'` entra em `enabledFeatures` do setor padrão.

### `pages/CalendarPage.tsx`

```
┌ Calendário ──────────────────────────  ‹  julho 2026  › ┐
│ [🎂 Aniversários] [🏅 Tempo de casa] [🌴 Férias] [📅 Reuniões]
├──────────────────────────────┬──────────────────────────┤
│  dom seg ter qua qui sex sáb │  Quinta, 30 de julho     │
│  grade do mês; cada dia com  │  🎂 Ana — aniversário    │
│  até 3 chips (+N mais)       │  🌴 Bruno — férias       │
│                              │  📅 14h Planning · Sala 2│
│                              │  [ Marcar reunião ]      │
└──────────────────────────────┴──────────────────────────┘
```

- Grade e navegação de mês seguem `DevelopmentThursdayPage` (`grid-cols-7`,
  painel lateral de 360px). Diferente de lá, **fim de semana não é desabilitado**
  — aniversário e férias caem em sábado.
- Uma cor por tipo, igual no chip do dia, no filtro e no painel lateral.
- Férias rendem um chip em **cada** dia do intervalo, recortado ao mês visível.
- Estado dos filtros na querystring (`?filtros=ferias,reunioes`), para os links
  da Home e o compartilhamento funcionarem. Ausente = todos ligados. Slugs:
  `aniversarios`, `tempo-de-casa`, `ferias`, `reunioes` — valor desconhecido é
  ignorado; nenhum válido = todos ligados.
- Três queries React Query independentes, uma por fonte
  (`/celebrations?month=`, `/vacations?from&to`, `/office/meetings?from&to`),
  cada uma com `enabled` atrelado ao seu filtro — filtro desligado não busca.
- Com "Reuniões" ligado aparece o sub-toggle **"todas as salas"** (`mine=false`).
- Clicar num evento leva ao destino natural: perfil da pessoa (aniversário,
  tempo de casa, férias) ou detalhe da reunião no painel.

### Marcar reunião a partir do calendário

O fluxo existente é reaproveitado inteiro. `MeetingForm` ganha um campo **Sala**
— um `Select` alimentado por `GET /office/rooms`, mostrando nome e capacidade —
renderizado **apenas** quando o formulário não recebe uma sala fixa. Dentro do
escritório nada muda: a sala continua vindo pronta e o campo não aparece.

`ScheduleMeetingModal` passa a aceitar `roomExternalKey: string | null` e uma
data inicial. Do calendário ele abre sem sala e com o dia selecionado
pré-preenchido; a agenda do topo do modal só carrega depois que uma sala é
escolhida. Conflito 409 com "marcar mesmo assim", `.ics`, convidados,
notificação e deep link vêm de graça.

### Cadastro de férias

**`pages/profile/TeamVacationsPanel.tsx`** — irmão do `SquadMoodPanel`, no
próprio perfil de quem lidera, sob a mesma condição de exibição. Alimentado por
`GET /me/team/vacations`: por grupo (squad ou área), cada liderado com seus
períodos futuros, um botão "Lançar férias" por pessoa e editar/remover em cada
período. Sem liderados, não renderiza nada — como o painel de humor.

**`components/VacationDialog.tsx`** — o formulário em si (pessoa, início, fim,
observação), isolado para ter dois consumidores: o painel do gestor e a ação
**"Férias"** na linha do colaborador em `pages/admin/CollaboratorsSection.tsx`,
por onde o ADMIN corrige qualquer um. Erros de sobreposição e de permissão vêm
da API e são exibidos no próprio diálogo.

## Testes

**API** (Vitest contra Postgres real):

- `vacations.test.ts` — CRUD; 403 de quem não gerencia o alvo; LEAD lança para
  membro da squad que lidera e falha para outra squad; MANAGER lança na sua
  área; ADMIN lança para qualquer um; sobreposição rejeitada (inclusive
  encostando nas bordas); edição que ignora o próprio registro; `GET` traz só o
  setor do viewer e só o que intersecta o intervalo; intervalo > 366 dias → 400.
- `team-scope-service.test.ts` — a matriz de papéis, migrada dos casos que hoje
  vivem no teste do squad-mood.
- `office-maps.test.ts` — `/office/rooms` devolve as salas do mapa ativo, sem
  `allowedUsers`; 403 para guest; lista vazia sem mapa publicado.
- `office-meetings.test.ts` — sem `room`, traz só as minhas; `mine=false` traz
  todas; `room` mantém o comportamento atual; intervalo > 62 dias → 400.
- `celebrations.test.ts` — `?month=` de outro mês; `today` continua sendo hoje;
  mês inválido → 400.

**Web** (jsdom + Testing Library):

- `CalendarPage.test.tsx` — renderiza os quatro tipos; chip desliga o tipo e
  reflete na querystring; querystring inicial liga os filtros certos; navegação
  de mês refaz as queries; toggle "todas as salas".
- `MeetingForm.test.tsx` — campo de sala aparece sem sala fixa e some com sala
  fixa; envio inclui a `roomExternalKey` escolhida.
- `TeamVacationsPanel.test.tsx` — lista grupos e períodos; sem liderados não
  renderiza; abre o diálogo e cria.
- `App.routing.test.tsx` — `/aniversarios` redireciona com os filtros.

## Riscos

- **Mudar `room` para opcional em `GET /office/meetings`** afrouxa uma rota
  existente. Mitigado por: filtro por participação como padrão, teto de 62 dias
  e `GUEST` barrado como hoje.
- **Remover `CelebrationsPage`** quebra qualquer link salvo para
  `/aniversarios` — daí o redirect, e não a exclusão da rota.
- **Extrair a regra de gestão** mexe num serviço vivo (humor do time). Mitigado
  por migrar os testes de papel junto com a regra.
