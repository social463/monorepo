# Plano — Quinta de Desenvolvimento

## Objetivo

Criar uma área para cadastrar um tema por sprint para a Quinta de Desenvolvimento,
com calendário, notificações internas e comunicação em chat Teams configurável pelo
admin.

## Implementação

- Adicionar contrato compartilhado de eventos e settings.
- Criar modelos Prisma `DevelopmentThursdayEvent` e `AppSetting`.
- Criar service com cálculo de sprint quinzenal (cadência 14 dias, fim na sexta da 2ª semana) a partir de 2026-07-06.
- Criar rotas autenticadas para listar/criar eventos.
- Criar rotas admin para ler/salvar a URL Teams.
- Espalhar notificação in-app para usuários ativos não-admin.
- Postar card no webhook Teams global, best-effort.
- Criar página `/quinta-desenvolvimento` com calendário mensal responsivo e formulário.
- Adicionar item de navegação e aba admin.
- Cobrir cálculo de sprint, criação, duplicidade, listagem e settings com testes.

## Verificação

- `pnpm --filter @legends/api exec prisma generate`
- `pnpm --filter @legends/api test -- src/routes/development-thursday.test.ts src/services/development-thursday-service.test.ts`
- `pnpm --filter @legends/api build`
- `pnpm --filter @legends/web build`
