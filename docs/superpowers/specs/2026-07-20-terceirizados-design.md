# Role de terceirizados com acesso controlado por feature

**Data:** 2026-07-20
**Status:** aprovado para plano

## Contexto

Hoje o Legends tem cinco roles (`LEGEND`, `LEAD`, `MANAGER`, `HEAD`, `ADMIN`), todas com acesso
total às mesmas telas — a única distinção de acesso é binária (admin vs. não-admin, dev vs. admin).
Precisamos incorporar colaboradores terceirizados que devem acessar a plataforma, mas com um
subconjunto de features controlado individualmente pelo admin (ex.: um terceirizado pode ter
acesso ao escritório virtual e ao mural, mas não a votação; outro pode ter acesso a mais coisas).

O cadastro desses usuários não passa pelo fluxo atual (`CollaboratorsSection`, onde o admin digita
e-mail/senha na hora). Em vez disso, o admin gera um link de convite e o próprio terceirizado
define e-mail e senha ao aceitar o convite — padrão já usado para convidados do escritório virtual
(`OfficeGuestInvite` / `office-guest-service.ts`), mas aqui o resultado é uma conta `User` real e
persistente, não uma sessão efêmera.

## Não-objetivos

- Verificação de e-mail/domínio no cadastro do convite (o link é a única barreira).
- Edição em lote de features de vários terceirizados de uma vez.
- Qualquer mudança na lógica de elegibilidade a votação/badges/Destaque do Mês além do próprio
  gate de acesso: se a feature correspondente estiver habilitada, o terceirizado participa como
  um usuário comum nela (pode votar, ser votado, ganhar selo, etc.).

## Modelo de dados

### `UserRole`

Novo valor `THIRD_PARTY` (rótulo pt-BR: "Terceirizado") em `apps/api/prisma/schema.prisma` e em
`USER_ROLES` / `USER_ROLE_LABELS` (`packages/shared/src/enums.ts`).

### `User.enabledFeatures`

Novo campo `enabledFeatures Json @default("[]")` em `User`. Só tem efeito para usuários com
`role = THIRD_PARTY`; para as demais roles é ignorado — elas mantêm acesso total, como hoje.
Armazena um array de chaves de feature (`string[]`), validado contra a lista canônica abaixo.

### Chaves de feature (canônicas, em `@legends/shared`)

Mapeadas 1:1 com os itens hoje presentes em `buildNavItems` (`apps/web/src/components/nav-items.ts`)
que fazem sentido restringir. Ficam **sempre disponíveis** (baseline, não togláveis) para qualquer
usuário autenticado, terceirizado ou não: Home (`/`), "Meu perfil" (`/perfil/:id` do próprio
usuário), edição de personagem (`/personagem`) e troca de senha (`/alterar-senha`) — são a própria
conta do usuário, não uma "feature" de negócio.

Chaves togláveis:

| Chave | Rota(s) | Nav label |
|---|---|---|
| `time` | `/time` | Time |
| `lendas` | `/lendas` | Lendas |
| `votar` | `/votar` | Votar |
| `selos` | `/selos` | Galeria de selos |
| `destaques` | `/destaques` | Destaques |
| `notificacoes` | `/notificacoes` | Notificações |
| `resenha` | `/resenha` | Resenha |
| `quinta-desenvolvimento` | `/quinta-desenvolvimento` | Quinta de Dev |
| `retrospectivas` | `/retrospectivas`, `/retrospectivas/:id`, `/retrospectivas/sprint/:sprint` | Retrospectivas |
| `escritorio` | `/escritorio` | Escritório |

O mapeamento rota→feature exato do lado do backend (quais arquivos de rota/handlers precisam do
gate) será levantado durante o plano de implementação, arquivo por arquivo.

### `ThirdPartyInvite`

Nova tabela, no mesmo espírito de `OfficeGuestInvite`:

```prisma
model ThirdPartyInvite {
  id              String    @id @default(cuid())
  tokenHash       String    @unique
  createdById     String
  createdBy       User      @relation(fields: [createdById], references: [id])
  enabledFeatures Json      @default("[]")
  expiresAt       DateTime
  usedAt          DateTime?
  revokedAt       DateTime?
  createdAt       DateTime  @default(now())
}
```

Convite é de uso único (`usedAt`), pode ser revogado (`revokedAt`) e expira (`expiresAt`).
Duração min/max configurável seguindo o padrão de `OFFICE_GUEST_INVITE_MIN_MINUTES` /
`_MAX_MINUTES`, mas com janela maior (convite de acesso à plataforma, não de sessão de escritório) —
definir minutos/dias durante o plano.

## Fluxo

### Admin cria o convite

- Nova seção "Terceirizados" no painel admin (`apps/web/src/pages/admin/ThirdPartySection.tsx`),
  com aba própria em `TabBar`.
- Formulário: nome/observação opcional (para o admin identificar o convite na lista), validade do
  link, checklist das 10 chaves de feature para pré-selecionar.
- `POST /admin/third-party-invites` (`onRequest: [authenticate, requireAdmin]`) cria o registro e
  devolve a URL pronta (`https://.../terceirizado/convite/:token`), no padrão de `inviteUrl()` em
  `office-guests.ts`.
- Lista de convites pendentes/expirados na mesma seção, com opção de revogar.

### Terceirizado aceita o convite

- `GET /third-party-invites/:token` (público): valida o convite (expirado/revogado/usado →
  404/410), devolve o mínimo necessário para renderizar a tela (não expõe `enabledFeatures`).
- Página `apps/web/src/pages/ThirdPartyInvitePage.tsx` (`/terceirizado/convite/:token`): formulário
  de nome, e-mail, senha (mesma regra de senha mínima do cadastro atual, 8+ caracteres).
- `POST /third-party-invites/:token/accept` (público): revalida o convite, cria `User` com
  `role: THIRD_PARTY` e `enabledFeatures` copiadas do convite, marca `usedAt`, faz login automático
  (mesmo par access token + refresh cookie de `/auth/login`) e retorna o usuário — a página
  redireciona para `/`.

### Edição posterior das features

- `PATCH /admin/users/:id` (rota já existente em `admin.ts`) passa a aceitar `enabledFeatures` no
  corpo, validado (e persistido) somente quando o usuário-alvo tem `role === 'THIRD_PARTY'`.
- Na seção "Terceirizados", cada linha tem uma edição inline do checklist de features (mesmo padrão
  de `CollaboratorRow`), reaproveitando o toggle `active`/`leftAt` já existente.

## Gating de acesso

### Backend

- `enabledFeatures` passa a ser assinado no JWT junto com `sub`/`role` (em login, refresh e no
  accept do convite), evitando leitura ao banco em toda request — mesmo padrão hoje usado para
  `role`. Uma mudança feita pelo admin reflete no próximo refresh (janela de 15 min do access
  token, igual a qualquer mudança de `role` hoje).
- Novo decorator `app.requireFeature(key: string)` em `app.ts`: se `request.user.role !==
  'THIRD_PARTY'`, deixa passar sem checagem (zero impacto nas demais roles); caso contrário, exige
  que `key` esteja em `request.user.enabledFeatures`, senão `403 { message: 'Acesso não liberado
  para este usuário' }`.
- Aplicado como `onRequest: [app.authenticate, app.requireFeature('<chave>')]` nas rotas
  correspondentes a cada feature da tabela acima (votes, badges, highlights, mural/time, review
  (resenha), development-thursday, retro*, office-* , notifications). Mapeamento fino rota→feature
  fica para o plano.

### Frontend

- `PublicUser` (`@legends/shared`) ganha `enabledFeatures?: string[]`.
- `buildNavItems` (`nav-items.ts`) recebe `role`/`enabledFeatures` e omite os itens cuja chave não
  está habilitada quando `role === 'THIRD_PARTY'`.
- Novo componente `FeatureGate` em `App.tsx` (mesmo padrão de `DevOnly`/`AdminOnly`), envolvendo as
  rotas da tabela acima; redireciona para `/` quando a feature não está habilitada.
- Chamadas de API que retornarem 403 por falta de feature já caem no tratamento de erro genérico
  existente (`ApiError`); não é necessário tratamento especial, já que a navegação evita que o
  terceirizado chegue lá.

## Admin UI

- `USER_ROLE_LABELS['THIRD_PARTY'] = 'Terceirizado'` em `@legends/shared`.
- `CollaboratorsSection` continua restrito às roles efetivas (`LEGEND`..`ADMIN`); terceirizados não
  aparecem nela — vivem só na seção nova `ThirdPartySection`.

## Testes

Seguindo a convenção do repo (Vitest colocado ao lado do código, Postgres real para a API):

- `apps/api/src/services/third-party-invite-service.test.ts` — criação/validação/expiração/uso
  único do convite.
- `apps/api/src/routes/third-party-invites.test.ts` — rotas de criação (admin), consulta pública e
  accept.
- Teste do decorator `requireFeature` (ex. em `app.test.ts` ou próximo a uma rota gated).
- `apps/web/src/components/nav-items.test.ts` (ou extensão do existente) — filtragem por
  `enabledFeatures`.
- Teste de `FeatureGate` no fluxo de rotas do `App.tsx`.

## Riscos / pontos de atenção

- Levantar todas as rotas que hoje não fazem nenhuma distinção de role e decidir, arquivo por
  arquivo, qual chave de feature se aplica — superfície grande (votes, badges, mural, resenha,
  quinta de dev, retro, office). Isso é trabalho de mapeamento, não de design; fica para o plano.
- Garantir que o WebSocket do escritório (`office-ws.ts`) e mídia (`office-media.ts`) também
  respeitem `escritorio` — conexões WS não passam pelo mesmo pipeline de `onRequest` das rotas REST,
  então a checagem ali precisa ser explícita na autenticação da conexão.
