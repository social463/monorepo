# Integração de calendário — Fase 3: publicação de eventos do Legends

**Data:** 2026-07-29
**Depende de:** `2026-07-29-calendario-conexao-design.md` (fase 1).
**Irmã:** `2026-07-29-calendario-leitura-design.md` (fase 2) — independente desta;
as duas podem ser implementadas em qualquer ordem depois da fase 1.

## Problema

O Development Thursday existe no Legends e no Teams (via webhook por empresa), mas
não na agenda de ninguém. Quem não abre o Legends naquele dia simplesmente perde.
O mesmo vale para a janela de votação: abre e fecha por data, e quem não entra não
lembra de votar.

Esta fase publica esses eventos **na agenda de quem conectou o calendário** na fase
1, usando o escopo de escrita já concedido lá (`calendar.events` /
`Calendars.ReadWrite`) — nenhum consentimento novo é pedido.

## O que é publicado

| Origem | Formato do evento | Para quem |
| --- | --- | --- |
| `DevelopmentThursdayEvent` | evento com horário, no fuso de São Paulo | todos os conectados da empresa |
| `VotingPeriod` — abertura | evento de dia inteiro "Votação de <mês> aberta" no dia de `startsAt` | conectados **do setor** do período |
| `VotingPeriod` — fechamento | evento de dia inteiro "Última chance de votar em <mês>" no dia de `endsAt` | idem |

Detalhes que vêm do schema, não de suposição:

- `DevelopmentThursdayEvent` (`schema.prisma:225`) tem `eventDate` (`@db.Date`) e
  `startTime`/`endTime` **opcionais** em formato `"HH:MM"`. Sem horário definido, o
  evento é publicado como dia inteiro; com horário, como evento cronometrado. O
  fuso é São Paulo, resolvido pelo `lib/sao-paulo-date.ts` que o resto do app já
  usa — data e hora locais nunca são tratadas como UTC.
- O DT é da empresa inteira; a descrição do evento leva título, descrição e nome de
  quem apresenta (`presenter`), e o `joinUrl` quando houver.
- `VotingPeriod` (`schema.prisma:428`) é **por setor** (`sectorId`). Publicar para a
  empresa toda seria ruído para quem não vota naquele período — a publicação
  respeita o setor, como o resto das features setorizadas.

**Retro fica de fora.** `RetroRoom` (`schema.prisma:633`) não tem horário agendado:
é criada e já abre (`status` + `createdAt`, sem `startsAt`). Não há o que publicar
numa agenda. Se um dia a retro ganhar agendamento, entra aqui como quarta origem.

## Modelo de dados

```prisma
enum CalendarPublishedSource {
  DEVELOPMENT_THURSDAY
  VOTING_PERIOD_OPEN
  VOTING_PERIOD_CLOSING
}

model CalendarPublishedEvent {
  id              String                  @id @default(cuid())
  connectionId    String
  userId          String
  companyId       String
  sourceType      CalendarPublishedSource
  sourceId        String
  providerEventId String
  /** Hash do conteúdo publicado; diferente = precisa atualizar no provedor. */
  contentHash     String
  createdAt       DateTime                @default(now())
  updatedAt       DateTime                @updatedAt

  connection CalendarConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([connectionId, sourceType, sourceId])
  @@index([companyId])
}
```

A unique composta é o que dá idempotência: uma linha por (conexão, origem), então
não existe caminho para publicar o mesmo evento duas vezes na mesma agenda.

## Reconciliação, não hooks

`apps/api/src/scheduler/calendar-publish.ts`:

```ts
export async function runCalendarPublishTick(now: Date): Promise<void>
```

Tick de **15 min** que, por empresa com pelo menos uma conexão ativa:

1. Calcula o **estado desejado**: para cada conexão com `publishEnabled`, quais
   eventos deveriam existir na janela `[now - 1d, now + 60d]` — DT da empresa e
   períodos de votação do setor daquela pessoa.
2. Compara com `CalendarPublishedEvent`:
   - desejado e não publicado → `createEvent`, grava linha;
   - publicado com `contentHash` diferente → `updateEvent`, atualiza hash;
   - publicado e não mais desejado (evento apagado no Legends, pessoa mudou de
     setor, `publishEnabled` desligado, evento saiu da janela) → `deleteEvent`,
     apaga linha.

**Por que reconciliação em tick, e não publicar no momento em que o admin cria o
DT.** Hook na mutação parece mais direto e é pior: cada caminho que mexe no DT
(criar, editar, apagar) precisaria lembrar de publicar; quem conecta a agenda
depois não receberia os eventos já existentes; e uma falha de rede no meio deixa
divergência permanente entre Legends e provedor, sem nada que a conserte. O tick
tem um lugar só, é idempotente, faz backfill de graça para quem conecta depois e
se cura sozinho. É o mesmo raciocínio dos ticks de `scheduler/nudges.ts`.

`contentHash` é SHA-256 sobre os campos que o provedor vê (título, descrição,
início, fim, all-day, `joinUrl`). Assim editar o tema do DT no Legends atualiza o
evento na agenda de todos, e um tick sem mudança não faz **nenhuma** chamada HTTP.

Robustez, no padrão dos ticks existentes: `try/catch` por conexão; `now` injetado;
`404` do provedor ao atualizar/apagar (pessoa apagou o evento na mão) é tratado
como sucesso — a linha local é removida e o evento volta no próximo tick apenas se
continuar desejado.

## Adapters

Entram na `CalendarProviderAdapter` da fase 1:

```ts
  createEvent(input: { creds; tokens; event: CalendarEventDraft }): Promise<{ providerEventId: string }>
  updateEvent(input: { creds; tokens; providerEventId: string; event: CalendarEventDraft }): Promise<void>
  deleteEvent(input: { creds; tokens; providerEventId: string }): Promise<void>
```

`CalendarEventDraft` é neutro (título, descrição, `startsAt`/`endsAt` ou data de
dia inteiro, fuso, `joinUrl`, marcador de origem). A tradução para o corpo do
Google Calendar / Graph mora dentro de cada adapter — como o `teams-client.ts` faz
com o Adaptive Card, e como a fase 2 faz na leitura.

Os eventos são criados **sem convidados**: cada agenda recebe o próprio evento. Um
evento com lista de convidados dispararia convite e RSVP para todo mundo a partir da
conta de uma pessoa, o que é intrusivo e frágil. O custo é não ter RSVP nativo —
aceitável, porque presença no DT não é controlada pelo calendário.

## Opt-out

`CalendarConnection.publishEnabled` (já criado na fase 1, default `true`) é
exposto no perfil, na seção Integrações: um toggle "Adicionar eventos do Legends à
minha agenda". Desligar dispara, no próximo tick, a remoção de tudo que já foi
publicado naquela conexão — o toggle não deixa lixo para trás.

`PATCH /calendar/connections/:provider` com `{ publishEnabled: boolean }`, validado
por Zod, no service da fase 1.

## Erros

| Situação | Comportamento |
| --- | --- |
| `createEvent` falha | logado; nenhuma linha gravada; tenta no próximo tick |
| `updateEvent`/`deleteEvent` volta 404 | tratado como sucesso; linha local removida |
| Token expirado | refresh transparente pelo service da fase 1 |
| Consentimento revogado | conexão vira `NEEDS_REAUTH` e é ignorada pela publicação (sem tentar apagar o que já está lá — o acesso não existe mais) |
| Rate limit do provedor | erro logado por conexão; o tick seguinte retoma |

## Testes

- `services/calendar-publish-service.test.ts`: o cálculo do estado desejado é
  função pura — DT com `startTime` gera evento cronometrado, sem `startTime` gera
  dia inteiro; período de votação gera duas entradas; pessoa de outro setor não
  recebe o período; janela exclui o que está longe.
- `scheduler/calendar-publish.test.ts` (com banco): primeiro tick cria e grava
  `providerEventId`; segundo tick **não faz chamada nenhuma** (asserção sobre o stub
  de `fetch`); editar o DT dispara update e novo hash; apagar o DT dispara delete e
  remove a linha; `publishEnabled = false` remove tudo; conexão `NEEDS_REAUTH` é
  ignorada; 404 no delete não deixa linha órfã.
- `lib/calendar/google.test.ts` / `microsoft.test.ts` (estendidos): corpo enviado
  tem o fuso de São Paulo e o formato de dia inteiro correto em cada provedor.
- `routes/calendar.test.ts` (estendido): `PATCH` altera `publishEnabled` só da
  própria conexão.
- Web: toggle reflete e altera o estado; texto explica que desligar remove os
  eventos já criados.

## Fora de escopo

- Retro (sem horário agendado no schema — justificativa acima).
- Criar link de reunião novo (Meet/Teams) pelo Legends: se o DT já tiver `joinUrl`,
  ele é reaproveitado; gerar reunião é escopo e complexidade de outra ordem.
- Convidados/RSVP nativo (decisão registrada acima).
- Publicar na agenda de quem não conectou (por e-mail com `.ics`, ou feed
  assinável) — a decisão foi publicar via API, para quem conectou.
- Calendário compartilhado da empresa (um calendário "Legends" que todos assinam):
  alternativa razoável, mas exige um recurso de calendário administrado pelo tenant
  e sai do modelo "cada pessoa conecta a própria conta".
