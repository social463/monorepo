# Plan — Convite a pessoas específicas no calendário

Spec: `docs/superpowers/specs/2026-08-25-convidar-pessoas-no-calendario-design.md`

## 1. Modelo e contrato

- [x] Migration: `CalendarEventGuest` (eventId, userId, companyId,
      `@@unique([eventId, userId])`, cascade nos dois lados).
- [x] `@legends/shared`: `guestIds` no `UpsertCalendarEventRequest`; `guests`
      (lista de `PublicUser`) no DTO de gestão do evento.
- [x] `CalendarEventGuest` em `TENANT_SCOPED_MODELS` e no `test/setup.ts`.

## 2. Visibilidade

- [x] `visibilityWhere` ganha o OR de convidado.
- [x] O filtro em memória de `audienceReaches` é pulado para quem é convidado —
      são **dois** pontos, e mexer só num deixa o convidado de fora sem erro.
- [x] `isInternalComm` **não** afrouxa: convite não é autorização para ver o
      registro interno da G&G.
- [x] Testes: convidado de outro setor vê; convidado fora da tag vê; ninguém mais
      passa a ver; Ação de Comunicação Interna continua escondida.

## 3. Notificação e pop-up

- [x] `NotificationType.CALENDAR_EVENT_INVITED` + emoji no card do Teams.
- [x] `notifyCalendarEventInvited` no `notification-service`.
- [x] Service dispara na criação e, na edição, **só para quem entrou agora**
      (diff contra o banco).
- [x] `CalendarInviteToasts` no `AppLayout`: lê a consulta de notificações que já
      roda a cada 10s e mostra só o tipo do convite.
- [x] Testes: criar avisa os convidados; editar sem mexer na lista não avisa
      ninguém; adicionar um avisa só ele.

## 4. Lembrete

- [x] O agendador soma os convidados aos destinatários por setor, sem duplicar
      quem está nos dois.
- [x] Teste: convidado de fora do setor recebe o lembrete.

## 5. Tela

- [x] Campo **Convidados** no formulário, com `TargetPicker` (busca por nome,
      seleção múltipla), convivendo com o público-alvo por tag.
- [x] Os convidados aparecem na lista de eventos de quem administra.
- [x] Testes: escolher duas pessoas manda os dois ids; remover manda a lista sem
      ele.

## 6. Fechamento

- [x] `pnpm test`: shared 534/534, web 2535/2535 e api **2935/2935** — as três
      suítes inteiras.
      Nota de execução: os testes do calendário estouraram o timeout de 5s
      **duas vezes** com o `pnpm dev` (api + Vite) rodando junto; sem eles, o
      arquivo inteiro roda em 11s. Era carga da máquina, não o código — e o
      segundo estouro caiu num teste que este lote nem tocou, que foi o que
      denunciou a causa.
- [x] Conferido no app rodando, ponta a ponta: evento marcado só para "Líder"
      com a Erika (LEGEND) convidada — ela vê a ocorrência e recebe
      `CALENDAR_EVENT_INVITED` apontando para `/calendario?dia=2026-09-15`;
      outro LEGEND não convidado continua sem ver.

## 7. Decisão de UI que apareceu no caminho

Os dois toasts — comunicado novo e convite de evento — usavam `fixed bottom-lg
right-lg` cada um. Dois containers fixos no mesmo canto se sobrepõem
exatamente. Os dois passaram a devolver só a lista, e o `AppLayout` os monta num
**stack único**: são notificação para a mesma pessoa, e empilhar é o certo.
