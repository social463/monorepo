# Eventos de calendário da empresa — plan

Spec: `docs/superpowers/specs/2026-08-03-eventos-calendario-design.md`
PBI: #22328 · Branch: `feat/22328-eventos-calendario`

## 1. Contrato — `packages/shared/src/calendar-event.ts`

- `CalendarRecurrence`, labels; `CALENDAR_REMINDER_OFFSETS` (0, 1, 3, 7, 14, 30) e labels.
- `CalendarEventTypeDTO`, `CalendarEventDTO`, `CalendarEventOccurrenceDTO`,
  payloads de create/update, `CalendarEventsResponse`.
- `expandOccurrences(rule, from, to)` — pura, com clamp de fim de mês e corte por
  `recurrenceUntil`/`recurrenceCount`. Barril em `index.ts`.
- Teste: `calendar-event.test.ts` — semanal/mensal/anual, 31 em mês de 30, 29/02,
  virada de ano, corte por contagem, evento único fora da janela.

## 2. Schema — `apps/api/prisma`

- Models e enum da spec; relações em `Company`, `Sector`, `User`.
- `NotificationType += CALENDAR_EVENT_REMINDER`; emoji em `notification-service.ts`;
  `NOTIFICATION_TYPES` em `packages/shared/src/notification.ts`.
- `TENANT_SCOPED_MODELS += CalendarEvent, CalendarEventType`.
- Migration escrita à mão (o `.env` local aponta para HML — **não** rodar
  `migrate dev` contra ele); validada pelo `migrate deploy` do global-setup dos testes.

## 3. API

- `services/calendar-event-service.ts`: CRUD de tipo e evento, `CalendarEventError`
  tipado com `status`, `listOccurrencesFor(user, from, to)` aplicando público-alvo.
- `lib/serialize.ts`: `toCalendarEventDTO`, `toCalendarEventTypeDTO`.
- `routes/admin.ts`: oito rotas sob `produtoAdmin`, Zod + `issues` no 400.
- `routes/calendar.ts`: `GET /calendar/events` com `requireFeature('calendario')`.
- Testes: gate de setor (ADMIN passa, SUBADMIN sem feature 403), isolamento por
  empresa, público-alvo (empresa inteira × setores), validação.

## 4. Scheduler — `apps/api/src/scheduler/calendar-event-reminders.ts`

- Tick horário, dispara às 9h de São Paulo; `now` injetável.
- Para cada evento com `reminderDaysBefore` não vazio: ocorrências na janela,
  INSERT em `CalendarEventReminderSent` como reivindicação (P2002 → pula),
  destinatários = ativos, do público-alvo, com feature `calendario`.
- Sobe em `server.ts`; não sobe em teste.
- Testes: dispara uma vez, não repete no segundo tick, respeita público-alvo e
  feature, recorrente notifica ocorrências distintas.

## 5. Web — calendário

- `calendar-events.ts`: `CalendarFilter` passa a aceitar `tipo:<slug>`;
  `parseFilters`/`serializeFilters` recebem os slugs conhecidos; `buildEvents`
  aceita as ocorrências.
- `useCalendarData.ts`: query nova de `/calendar/events`, ligada quando algum chip
  de tipo está ativo; tipos sempre buscados (alimentam os chips).
- `CalendarPage.tsx`: chips derivados + chips de tipo.
- Testes: chip liga/desliga, ocorrência aparece no dia, filtro sobrevive à URL.

## 6. Web — admin

- `pages/admin/CalendarEventsSection.tsx`: lista + formulário (título, descrição,
  data, hora, tipo, setores, antecedências, recorrência) e gestão de tipos.
- Rota `/admin/eventos` sob `AdminSectorFeatureOnly feature="desenvolvimento-produto"`;
  item na sidebar em "Comunidade" com `featureKey`.
- Teste: render da lista, submit do formulário, 403 não quebra a tela.

## 7. Fechamento

`pnpm test` com Postgres de pé (`LEGENDS_DB_PORT=5442`), commit, PR ligado ao #22328.
