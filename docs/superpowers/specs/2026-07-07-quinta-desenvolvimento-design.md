# Quinta de Desenvolvimento — Design

**Data:** 2026-07-07
**Status:** Implementado

## Contexto

O Legends precisa de uma área para colaboradores cadastrarem temas para apresentar
na Quinta de Desenvolvimento. A cadência é quinzenal (nova sprint a cada 14 dias,
sempre numa segunda-feira), encerrando na sexta-feira da 2ª semana; a sprint atual
iniciou em 2026-07-06 (06→17). Cada sprint aceita apenas um tema.

## Decisões

- Nova rota autenticada `/quinta-desenvolvimento` no frontend.
- Calendário mensal responsivo, em grade similar ao Google Calendar.
- Âncora de sprint: `2026-07-06`; cadência de 14 dias; fim na sexta da 2ª semana (start + 11).
- O evento aparece na primeira quinta-feira dentro da sprint.
- Payload de criação: `title`, `description` e `sprintStart` opcional.
- Notificação in-app para usuários ativos não-admin quando um tema é cadastrado.
- Comunicação em canal Teams via webhook global configurado pelo admin.
- Preparação para selos: o evento persiste `presenterId`, permitindo conceder selo
  posteriormente ao apresentador.

## API

- `GET /development-thursday/events?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /development-thursday/events`
- `GET /admin/development-thursday/settings`
- `PATCH /admin/development-thursday/settings`

## Dados

- `DevelopmentThursdayEvent`: título, descrição, sprint, data do evento e apresentador.
- `AppSetting`: configuração global simples para a URL Teams.
- `NotificationType.DEVELOPMENT_THURSDAY_EVENT`.

## Fora de escopo

- Edição/cancelamento de tema.
- Selecionar apresentador diferente de quem cadastrou.
- Concessão automática de selo.
