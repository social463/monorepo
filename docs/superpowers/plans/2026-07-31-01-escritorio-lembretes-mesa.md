# Lembretes em mesas reivindicadas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `tlc-spec-driven` to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir deixar lembretes privados em mesas reivindicadas, exibidos como presentes no escritório, com leitura exclusiva pelo dono e notificações de recebimento/leitura.

**Spec:** `docs/superpowers/specs/2026-07-31-escritorio-lembretes-mesa-design.md`

**Architecture:** Contrato em `@legends/shared`; persistência em Prisma via `OfficeDeskReminder`; regras em service da API; rotas finas em `office-maps.ts`; notificações via `createNotification`; atualização ao vivo no escritório via novos eventos WebSocket; UI React/Phaser aproveitando `DeskHoverCard`, `DeskActionPanel`, `useOfficeInteractions` e overlays do `OfficePage`.

## Global Constraints

- Mensagens ao usuário em português.
- Alterar contratos em `@legends/shared` antes de API/web.
- API segue `route → service → Prisma`; erros de domínio tipados com `status`.
- Testes de API exigem Postgres local (`pnpm db:up`).
- Não vazar `message` do lembrete fora do destinatário.
- Não editar migration aplicada; gerar migration nova para `OfficeDeskReminder` e novos `NotificationType`.
- Durante implementação, rodar testes focados dos arquivos alterados; suíte completa só como verificação final.

---

### Task 1: Contrato compartilhado de lembretes e eventos

**Files:**
- Modify: `packages/shared/src/office-map.ts`
- Modify: `packages/shared/src/office.ts`
- Modify: `packages/shared/src/notification.ts`
- Test/verify: `packages/shared` typecheck e testes próximos, se houver.

- [ ] Adicionar `OfficeDeskReminderSummaryDTO` e `OfficeDeskReminderDetailDTO`.
- [ ] Incluir `deskReminders: OfficeDeskReminderSummaryDTO[]` em `ActiveOfficeMapDTO`.
- [ ] Adicionar eventos `desk-reminder-created` e `desk-reminder-read` em `OfficeServerMessage`.
- [ ] Adicionar `OFFICE_DESK_REMINDER_RECEIVED` e `OFFICE_DESK_REMINDER_READ` em `NOTIFICATION_TYPES`.
- [ ] Rodar `pnpm --filter @legends/shared exec tsc --noEmit -p tsconfig.json`.

---

### Task 2: Persistência Prisma

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: nova migration em `apps/api/prisma/migrations/*`

- [ ] Adicionar relações de remetente/destinatário em `User`.
- [ ] Adicionar `OfficeDeskReminder` com `deskId`, `senderId`, `recipientId`, `message`, `readAt`, `createdAt`, `companyId`.
- [ ] Adicionar enum values `OFFICE_DESK_REMINDER_RECEIVED` e `OFFICE_DESK_REMINDER_READ`.
- [ ] Gerar migration com `pnpm db:migrate`.
- [ ] Rodar `pnpm db:generate`.

---

### Task 3: Service de lembretes de mesa

**Files:**
- Modify/Create: `apps/api/src/services/office-desk-reminder-service.ts` ou seção coesa em `office-map-service.ts`
- Modify: `apps/api/src/services/notification-service.ts`
- Test: `apps/api/src/services/office-desk-reminder-service.test.ts` ou testes próximos existentes.

- [ ] Implementar erro de domínio (`DeskReminderError`) com `status` e `code`.
- [ ] Implementar listagem de lembretes pendentes do mapa ativo para compor `GET /office/map`.
- [ ] Implementar criação com validação: mesa ativa existe, mesa tem dono, autor não é dono, companyId isolado.
- [ ] Criar notificação de recebimento para o dono com ator igual ao autor.
- [ ] Implementar detalhe: destinatário recebe conteúdo; demais recebem `message: null`.
- [ ] Implementar leitura: só destinatário, marca `readAt`, notifica autor uma única vez.
- [ ] Atualizar `emojiForNotificationType` para os novos tipos.
- [ ] Cobrir privacidade, multiempresa, notificações e idempotência em teste.

---

### Task 4: Rotas HTTP e mapa ativo

**Files:**
- Modify: `apps/api/src/routes/office-maps.ts`
- Modify: `apps/api/src/services/office-map-service.ts`
- Modify: `apps/api/src/lib/serialize.ts`, se necessário.
- Test: `apps/api/src/routes/office-maps.test.ts`

- [ ] Incluir `deskReminders` no payload de `GET /office/map`.
- [ ] Adicionar `POST /office/desks/:id/reminders` com Zod para `{ message }`.
- [ ] Adicionar `GET /office/desk-reminders/:id`.
- [ ] Adicionar `POST /office/desk-reminders/:id/read`.
- [ ] Emitir `desk-reminder-created` após criação.
- [ ] Emitir `desk-reminder-read` após primeira leitura.
- [ ] Testar status codes e payloads das novas rotas.

---

### Task 5: Estado realtime do escritório

**Files:**
- Modify: `apps/api/src/lib/office-hub.ts`
- Test: `apps/api/src/lib/office-hub-map.test.ts` ou `office-hub.test.ts`
- Modify: `apps/web/src/office/useOfficeInteractions.ts`
- Test: `apps/web/src/office/useOfficeInteractions.test.tsx`

- [ ] Adicionar helpers de broadcast no hub para criação/leitura de lembrete.
- [ ] No web, manter estado local de `deskReminders` inicializado pelo mapa ativo.
- [ ] Consumir `desk-reminder-created` adicionando/atualizando presente.
- [ ] Consumir `desk-reminder-read` removendo presente pendente.
- [ ] Garantir comparação estável para evitar render loop com arrays novos.

---

### Task 6: Cliente HTTP do web

**Files:**
- Create/Modify: `apps/web/src/lib/office-desk-reminder-api.ts`
- Test: `apps/web/src/lib/office-desk-reminder-api.test.ts`

- [ ] Implementar `createOfficeDeskReminder(deskId, message)`.
- [ ] Implementar `getOfficeDeskReminder(id)`.
- [ ] Implementar `markOfficeDeskReminderRead(id)`.
- [ ] Testar URLs, métodos e ausência de `Content-Type` em requests sem corpo.

---

### Task 7: UI de deixar lembrete

**Files:**
- Modify: `apps/web/src/office/DeskHoverCard.tsx`
- Modify: `apps/web/src/office/DeskActionPanel.tsx`
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Create: componente de post-it/modal, se ficar grande demais para `OfficePage`.
- Test: `apps/web/src/pages/OfficePage.test.tsx` e/ou testes dos componentes.

- [ ] Mostrar ação `Deixar lembrete` para mesa reivindicada por outro usuário.
- [ ] Abrir post-it com textarea e botão `Salvar lembrete`.
- [ ] Validar mensagem não vazia e exibir erro de API em português.
- [ ] Ao salvar, chamar API e fechar overlay.
- [ ] Não mostrar ação para mesa livre nem para a própria mesa.

---

### Task 8: Presente sobre a mesa e leitura privada

**Files:**
- Create: `apps/web/src/office/deskReminderPresentation.ts`
- Modify: `apps/web/src/office/scenes/OfficeScene.ts`
- Modify: `apps/web/src/office/OfficeCanvas.tsx`
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Test: focado em `OfficePage.test.tsx`/estado do hook; teste visual manual no dev server se necessário.

- [ ] Criar configuração visual centralizada com `OFFICE_DESK_REMINDER_GIFT_ASSET_ID = 'city-props/caixa-de-presente-com-coracao'`.
- [ ] Se o asset curado não puder ser usado diretamente no runtime, versionar fallback `apps/web/public/office/reminder-gift.png` e configurar a cena por esse módulo.
- [ ] Renderizar presente sobre mesas com lembrete pendente.
- [ ] Tornar presente clicável sem quebrar clique da mesa.
- [ ] Ao abrir como destinatário, buscar detalhe, mostrar remetente e conteúdo.
- [ ] Ao abrir como não destinatário, mostrar remetente e mensagem de privacidade sem conteúdo.
- [ ] Ao destinatário ler, chamar `markOfficeDeskReminderRead` e remover presente.
- [ ] Confirmar que evento realtime também remove o presente em outras abas.

---

### Task 9: Verificação final

- [ ] `pnpm --filter @legends/shared exec tsc --noEmit -p tsconfig.json`
- [ ] Testes focados do `@legends/api` para service/rotas, com Postgres rodando.
- [ ] Testes focados do `@legends/web` para API client/hook/UI.
- [ ] `pnpm build` ou verificação equivalente se o escopo ficar amplo.
- [ ] Registrar no resumo final migrations geradas e testes executados.
