# Eventos de calendário da empresa — design

Data: 2026-08-03
PBI: #22328 — "Calendário — eventos da empresa: cadastro no admin, filtro por tipo,
público por setor, lembrete e periodicidade".

## Problema

O calendário mostra só o que já existia em outra tabela: aniversário, tempo de casa,
férias e reunião. Nada é **cadastrado** — a empresa não tem como pôr uma data no
calendário de todo mundo. Prova B2B, prazo de campanha, treinamento e comunicado com
data vivem em Teams e planilha, e quem precisa se organizar descobre por sorte.

O pedido nasceu como "filtro de Provas B2B", e generalizou na conversa: o que falta é
**evento genérico com lembrete**, sendo prova B2B o primeiro caso de uso.

## Estado atual do Legends

Levantado no código antes de desenhar:

- **Não há entidade de evento de calendário.** Os quatro tipos são derivados
  (`apps/web/src/pages/calendar/calendar-events.ts`, `buildEvents`). O molde mais
  próximo de "evento datado cadastrado" é `DevelopmentThursdayEvent`
  (`schema.prisma:351`).
- **Não há rota agregadora.** `routes/calendar.ts` é só OAuth de integração externa;
  a agregação é client-side em `useCalendarData.ts`, com uma query por fonte.
- **`CALENDAR_FILTERS` mora no web**, não em `@legends/shared`, e é uma tupla fixa —
  `parseFilters` valida contra ela.
- **Lembrete tem molde pronto**: `scheduler/meeting-reminders.ts` (tick de 60s,
  reivindicação atômica por `updateMany` em `remindedAt`) e `scheduler/nudges.ts`
  (tick horário, disparo em hora fixa de São Paulo).
- **Bloco de setor tem molde pronto**: `produtoAdmin` em `routes/admin.ts:176` +
  `AdminSectorFeatureOnly` em `App.tsx:122`.
- Nenhum PR ativo, branch remota ou spec tocando calendário.

## Decisões

### Tipo de evento é dado, não enum

O pedido original queria um chip "Provas B2B". Cravar isso como valor de enum resolve
hoje e cobra amanhã: "Comunicados" e "Treinamentos" viram migration + deploy.

Fica um catálogo pequeno — `CalendarEventType` (nome, slug, ícone) por empresa —
gerenciado na mesma tela admin. O calendário renderiza **um chip por tipo cadastrado**,
ao lado dos quatro derivados. "Provas B2B" nasce como registro, não como código.

Custo aceito: os filtros do calendário deixam de ser uma tupla fixa. A chave do filtro
de tipo é `tipo:<slug>`, namespaced para nunca colidir com um filtro derivado — se
amanhã alguém cadastrar um tipo com slug `ferias`, o chip dele continua sendo
`tipo:ferias` e o filtro de férias segue intacto.

### Público-alvo: tabela de junção vazia = empresa inteira

`CalendarEventSector` com zero linhas significa "toda a empresa". A alternativa
(marcar todos os setores no cadastro) congela o público no instante do cadastro:
setor criado depois não receberia um evento que era, por definição, de todo mundo.

Sobre esse recorte vale o de sempre: dentro do público-alvo, só vê e só recebe quem
tem a feature de colaborador `calendario`. É a mesma regra que já governa o acesso à
tela — evento não é porta dos fundos para quem não tem o calendário liberado.

### Quem cadastra: admin, subadmin do bloco e **liderança**

Decidido depois da primeira rodada, a pedido: LEAD, MANAGER e HEAD também
cadastram, com o **mesmo alcance de público do admin** — inclusive empresa
inteira. A regra única mora em `canManageCalendarEvents` (`@legends/shared`), e a
contenção não é a permissão, é o **rastro**: todo evento carrega quem criou e
quando, visível na tela de gestão *e* no painel do dia do calendário, além do
`AdminAuditLog` que já registrava.

Duas consequências de desenho:

- **As rotas de evento saíram de `/admin/*`.** Líder não é admin e não entra no
  `/admin` (o `AdminOnly` do `App.tsx` barra), então CRUD de evento vive em
  `/calendar/events` com guarda própria. A porta dele é um modal no próprio
  `/calendario`; a tela de gestão completa segue sendo do admin.
- **O catálogo de TIPOS continua no bloco de admin.** Tipo é taxonomia da empresa
  e vira chip fixo na barra de filtros de todo mundo — liberar para cada líder
  faria a barra crescer sem dono.

Editar e excluir são mais estreitos que criar: líder só mexe no que ele mesmo
criou (`canEditCalendarEvent`), senão um líder apagaria o comunicado da empresa
inteira publicado por outra pessoa.

### Recorrência: regra guardada, ocorrência expandida na leitura

Nada de materializar ocorrências no banco. `recurrence` (`NONE|WEEKLY|MONTHLY|YEARLY`)
mais fim opcional (`recurrenceUntil` **ou** `recurrenceCount`), e a expansão por
intervalo acontece na leitura — igual ao que o calendário já faz com férias.

A expansão vive em `@legends/shared` (`expandOccurrences`), pura e testada lá, porque
tem **dois** consumidores que não podem divergir: a rota que desenha o calendário e o
scheduler que dispara o lembrete.

**Fim de mês, decidido explicitamente:** regra mensal em dia que não existe no mês
(31 em mês de 30, 29/30/31 em fevereiro) **cai no último dia do mês**, não pula a
ocorrência nem vaza para o dia 1º do mês seguinte. Vale o mesmo para 29/02 na regra
anual em ano comum → 28/02. Pular seria pior: um evento mensal "todo dia 31" some de
metade dos meses sem ninguém entender por quê.

### Idempotência do lembrete: unique por ocorrência, não flag no evento

`remindedAt` no evento — o padrão de `OfficeMeeting` — não serve aqui: o evento é
recorrente e pode ter **várias** antecedências. Uma flag só responde "já avisei deste
evento?", quando a pergunta é "já avisei desta ocorrência, nesta antecedência?".

Fica `CalendarEventReminderSent` com `@@unique([eventId, occurrenceDate, daysBefore])`.
A reivindicação é o próprio INSERT: violação de unique (P2002) significa que outro tick
ou outro processo já pegou aquela combinação, e o tick atual pula. Mesma garantia
atômica do `updateMany` condicional, na granularidade certa.

Trade-off herdado do molde e aceito igual: reivindicado antes de notificar, então
falha na entrega perde aquele lembrete — não há nova tentativa. O evento continua
visível no calendário.

### Disparo em hora fixa, não em contagem de horas

Antecedência é em **dias**, então "3 dias antes" não é um instante: é um dia. O tick é
horário (molde do `nudges.ts`) e dispara às 9h de São Paulo do dia
`ocorrência − daysBefore`. Antecedência `0` é o lembrete no próprio dia, de manhã.

### O que fica de fora

- **Não** se move `CALENDAR_FILTERS` e `buildMonthDays` para `@legends/shared`. O PBI
  sugeria mover o contrato inteiro; o que a api precisa conhecer são os DTOs e a
  expansão — e esses vão. Grade e chips continuam sendo assunto de tela, e mover
  arrastaria `CalendarGrid`/`CalendarDayPanel` e seus testes sem ganho.
- **Não** há edição de ocorrência isolada ("essa semana é dia 12, não 10"). Recorrência
  aqui é regra simples; exceção por ocorrência é outro produto.
- Notificação continua sendo criada em laço por `createNotification`, como todo o resto
  do repo, para não perder o espelho no Teams. Vale reavaliar se aparecer evento para
  empresa inteira com milhares de usuários — hoje não é o caso.

## Modelo

```prisma
enum CalendarRecurrence { NONE WEEKLY MONTHLY YEARLY }

model CalendarEventType {          // catálogo por empresa
  slug  @@unique([companyId, slug])
  name, icon
}

model CalendarEvent {
  title, description, date @db.Date, startTime String?
  typeId, recurrence, recurrenceUntil, recurrenceCount
  reminderDaysBefore Int[]         // vazio = sem lembrete
  createdById, companyId
}

model CalendarEventSector { eventId, sectorId }         // vazio = empresa inteira
model CalendarEventReminderSent {                        // idempotência do disparo
  eventId, occurrenceDate @db.Date, daysBefore
  @@unique([eventId, occurrenceDate, daysBefore])
}
```

`NotificationType` ganha `CALENDAR_EVENT_REMINDER` (emoji ⏰ no card do Teams).

## Superfície

| Camada | Endpoint / arquivo | Guarda |
|---|---|---|
| Evento | `GET /calendar/managed-events`, `POST/PATCH/DELETE /calendar/events` | `canManageCalendarEvents` (admin, subadmin do bloco, liderança) |
| Tipos | `GET POST PATCH DELETE /admin/calendar-event-types` | `produtoAdmin` |
| App | `GET /calendar/events?from&to` → ocorrências + tipos | `requireFeature('calendario')` |
| Web | `/admin/eventos` (`CalendarEventsSection`) | `AdminSectorFeatureOnly` |
| Web | modal "Novo evento" em `/calendario` | `canManageCalendarEvents` |
| Web | chips dinâmicos em `CalendarPage` | feature `calendario` (já existente) |

## Riscos

- **Expansão de recorrência é onde mora o bug.** Fim de mês, virada de ano e o corte
  por `recurrenceCount` são teste de unidade em `@legends/shared`, não teste manual.
- **Fuso.** `date` é data civil (`@db.Date`), sem hora; o scheduler compara em São
  Paulo. Misturar com `new Date().toISOString()` erra o dia entre 21h e meia-noite —
  o mesmo tropeço que o `localIsoOf` do calendário já documenta.
- **Vazamento entre setores.** O filtro de público-alvo é do backend. O front nunca
  recebe evento que não é do usuário, para não depender de esconder na tela.
