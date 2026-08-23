# Lembretes em mesas reivindicadas

**Data:** 2026-07-31
**Status:** proposto
**Tarefa:** 21925

## Contexto

O escritório virtual já permite que colaboradores reivindiquem mesas. A mesa
ocupada aparece no mapa com o dono, expõe hover/click por meio de
`DeskHoverCard`/`DeskActionPanel`, e as mudanças de ocupação são sincronizadas
por WebSocket (`desk-claimed`/`desk-released`).

Também já existe uma central de notificações persistente (`Notification`), com
notificações por usuário, ator opcional, link e metadata. A feature de lembrete
deve aproveitar esse canal para avisar quem recebeu o lembrete e, depois, quem
enviou quando o dono da mesa abrir a mensagem.

## Objetivo

Permitir que qualquer colaborador deixe um lembrete privado em uma mesa
reivindicada por outra pessoa. O lembrete aparece como um presente sobre a mesa.
Somente o dono da mesa consegue ler o conteúdo. Depois que o dono abre e lê, o
presente some e quem enviou recebe uma notificação de leitura.

## Regras de negócio

- Só é possível deixar lembrete em mesa reivindicada.
- O autor não deixa lembrete para a própria mesa.
- Cada lembrete pertence a uma mesa ativa, a um autor e ao dono da mesa no
  momento do envio.
- O conteúdo é privado: somente o dono destinatário pode receber o texto pela
  API.
- Quando uma pessoa que não é dona tenta abrir o presente, ela vê apenas quem
  enviou e que o conteúdo é privado.
- Ao criar o lembrete, o dono recebe a notificação:
  `Fulano deixou um lembrete para você na sua mesa.`
- Ao dono abrir o lembrete, ele é marcado como lido, some do mapa e o autor
  recebe a notificação:
  `Seu lembrete foi lido por Fulano.`
- Abrir novamente um lembrete já lido retorna 404 ou estado equivalente de
  "não há presente"; a notificação de leitura é enviada uma única vez.
- Se a mesa for liberada, removida do mapa ou republicada sem continuidade do
  mesmo `externalKey`, os lembretes pendentes ligados à mesa deixam de aparecer.

## Modelo de dados

Novo model Prisma `OfficeDeskReminder`:

```prisma
model OfficeDeskReminder {
  id          String    @id @default(cuid())
  deskId      String
  senderId    String
  recipientId String
  message     String
  readAt      DateTime?
  createdAt   DateTime  @default(now())
  companyId   String    @default("company-emr")

  desk      OfficeDesk @relation(fields: [deskId], references: [id], onDelete: Cascade)
  sender    User       @relation("OfficeDeskReminderSender", fields: [senderId], references: [id])
  recipient User       @relation("OfficeDeskReminderRecipient", fields: [recipientId], references: [id])
  company   Company    @relation(fields: [companyId], references: [id])

  @@index([deskId, readAt])
  @@index([recipientId, readAt])
  @@index([senderId])
  @@index([companyId])
}
```

O modelo permite histórico de lembretes lidos, mas a UI do mapa mostra apenas
pendentes (`readAt: null`). Se for necessário limitar spam, a implementação pode
começar com no máximo um lembrete pendente por `deskId + senderId` ou apenas
um pendente por mesa; essa decisão deve ser validada antes do código se houver
dúvida de produto.

## Contrato compartilhado

Adicionar DTOs em `@legends/shared`:

```ts
export interface OfficeDeskReminderSummaryDTO {
  id: string
  deskId: string
  deskExternalKey: string
  sender: { id: string; name: string }
  recipientId: string
  createdAt: string
}

export interface OfficeDeskReminderDetailDTO extends OfficeDeskReminderSummaryDTO {
  message: string | null
  canRead: boolean
}
```

`ActiveOfficeMapDTO` passa a incluir `deskReminders:
OfficeDeskReminderSummaryDTO[]`, contendo somente lembretes pendentes do mapa
ativo. O resumo nunca inclui conteúdo.

Novos tipos de notificação:

- `OFFICE_DESK_REMINDER_RECEIVED`
- `OFFICE_DESK_REMINDER_READ`

Novos eventos WebSocket no escritório:

- `desk-reminder-created` com o resumo do lembrete, para desenhar o presente.
- `desk-reminder-read` com `reminderId`, `deskId` e `deskExternalKey`, para
  remover o presente em tempo real.

## API

Rotas autenticadas novas em `office-maps.ts`, com lógica em service:

- `POST /office/desks/:id/reminders`
  - body: `{ message: string }`
  - valida mensagem não vazia e limite de tamanho.
  - 404 se a mesa ativa não existe.
  - 409 se a mesa não está reivindicada.
  - 403 se o autor é o dono da mesa.
  - cria o lembrete, notifica o dono e emite `desk-reminder-created`.

- `GET /office/desk-reminders/:id`
  - retorna resumo para qualquer usuário autenticado.
  - se quem chama é o destinatário, retorna `message` e `canRead: true`.
  - se quem chama não é o destinatário, retorna `message: null` e
    `canRead: false`.

- `POST /office/desk-reminders/:id/read`
  - apenas o destinatário pode executar.
  - marca `readAt`, notifica o autor, emite `desk-reminder-read`.
  - idempotência: se já estiver lido, não reenviar notificação.

## Frontend

- Hover em mesa reivindicada por outra pessoa mostra ação `Deixar lembrete`.
- Clique na ação abre um post-it/modal compacto com textarea e botão
  `Salvar lembrete`.
- Ao salvar, o modal fecha, o mapa mostra um presente sobre a mesa e o dono
  recebe a notificação existente do app.
- O presente aparece sobre a mesa para todos, mas o conteúdo só é carregado
  quando alguém tenta abrir.
- Ao abrir:
  - dono: vê remetente e mensagem, com ação de fechar/confirmar leitura; ao
    confirmar ou abrir com sucesso, o presente é marcado como lido e some.
  - não dono: vê remetente e texto de privacidade, sem conteúdo.
- O estado local do escritório consome os eventos WebSocket para adicionar e
  remover presentes sem refresh.

## Visual

O presente deve ser um objeto pequeno sobreposto ao centro/superfície da mesa,
com dimensão estável por tile e hit area suficiente para clique. Pode ser
desenhado em CSS/canvas/Phaser como sprite simples ou reaproveitar asset
existente se houver um ícone adequado no catálogo. O post-it deve usar texto
curto, layout compacto e não bloquear controles essenciais do escritório.

### Ícone do presente

Ícone padrão recomendado: **Caixa de presente com coração**, asset já curado no
catálogo de mobília:

- `id`: `city-props/caixa-de-presente-com-coracao`
- `sheet`: `city-props`
- `category`: `Decoração`
- região: `col: 6`, `row: 211`, `cols: 2`, `rows: 2`

Para não acoplar a feature a um asset hardcoded dentro da cena, a implementação
deve centralizar a escolha em um módulo pequeno do web, por exemplo
`apps/web/src/office/deskReminderPresentation.ts`:

```ts
export const OFFICE_DESK_REMINDER_GIFT_ASSET_ID = 'city-props/caixa-de-presente-com-coracao'
export const OFFICE_DESK_REMINDER_GIFT_LABEL = 'Presente com lembrete'
```

Se o renderer do escritório não conseguir reutilizar diretamente o asset curado
do catálogo, o fallback aceitável é versionar um PNG estático em
`apps/web/public/office/reminder-gift.png` e apontar esse mesmo módulo para a
URL. Evitar emoji como implementação final: é útil como placeholder, mas varia
por sistema operacional e fica menos consistente com o pixel-art do escritório.

## Testes

- `@legends/shared`: DTOs/tipos compilam e eventos entram no contrato.
- API service/routes:
  - cria lembrete em mesa de outro usuário.
  - rejeita mesa livre, própria mesa e mesa de outra empresa.
  - não vaza mensagem para não destinatário.
  - leitura pelo dono marca `readAt`, remove pendente e notifica autor uma vez.
  - criação notifica o dono.
- Web:
  - cliente HTTP chama as rotas corretas.
  - hover/click oferece `Deixar lembrete` só em mesa reivindicada por outro.
  - salvar renderiza estado de presente.
  - abertura por não dono oculta conteúdo.
  - evento `desk-reminder-read` remove presente do estado.

## Fora de escopo

- Histórico visual de lembretes antigos.
- Respostas, reações ou comentários no lembrete.
- Anexos/imagens.
- Notificação externa Teams além do comportamento padrão de `createNotification`.
- Lembretes em mesas livres ou em objetos de mobília que não sejam `desk`.
