# Integração de calendário — Fase 1: conexão (fundação)

**Data:** 2026-07-29
**Fases seguintes:** `2026-07-29-calendario-leitura-design.md` (leitura),
`2026-07-29-calendario-publicacao-design.md` (escrita). Ambas dependem desta.

## Problema

O Legends não sabe nada da agenda de ninguém. Queremos, adiante, marcar quem está
em reunião no escritório, avisar a pessoa da reunião que vem e publicar os eventos
do Legends no calendário dela. Tudo isso depende de uma coisa que não existe: uma
conexão autorizada com o calendário de cada pessoa.

Esta fase entrega **só a conexão** — nenhuma feature de produto. O critério de
pronto é: a pessoa clica "conectar" no perfil, autoriza no provedor, e o Legends
guarda um refresh token utilizável; clica "desconectar" e o acesso é revogado.

## Contexto do repo

- Já existe integração **de saída** com o Teams: `apps/api/src/lib/teams-client.ts`
  posta Adaptive Cards em URLs de Power Automate (`User.teamsWebhookUrl` para DM,
  e um webhook por empresa para o Development Thursday). É fire-and-forget, sem
  OAuth e sem leitura. Nada disso muda aqui.
- Configuração por empresa já tem padrão: `AppSetting` com unique composta
  `key_companyId`, lido/gravado com `companyId` explícito nos dois lados e com
  `recordAuditLog` — ver `getDevelopmentThursdaySettings` /
  `updateDevelopmentThursdaySettings` em
  `apps/api/src/services/development-thursday-service.ts:282`.
- `apps/api/src/services/audit-log-service.ts:24` já trata o risco de um campo
  sensível de `User` (`teamsWebhookUrl`) vazar por include aninhado. Tokens de
  calendário entram na mesma categoria.
- `apps/api/src/lib/config.ts` estabelece o padrão de segredo obrigatório:
  fallback em desenvolvimento, erro em produção (`JWT_SECRET`).

## Decisões de produto

**Credenciais OAuth são por empresa (BYO app).** O Legends é whitelabel e vendido
para empresas; cada tenant registra o próprio app (Google Cloud / Entra ID) e cola
as credenciais no admin. Não existe app único do Legends.

Consequências, todas desejáveis:

- Escopos de calendário são "sensíveis" no Google. Um app único e público exigiria
  processo de verificação do Google e publisher verification na Microsoft. Com app
  interno de cada tenant, nada disso entra no caminho.
- Os dados ficam sob o app do próprio cliente — argumento de venda, não obstáculo.
- Custo: a integração só funciona depois que o admin do cliente configurar. A UI
  precisa dizer isso com clareza, não falhar de forma opaca.

**Dois provedores desde o início.** Parte das empresas está no Microsoft 365, parte
no Google Workspace, e há tenants misturados. `GOOGLE` e `MICROSOFT` são pares.

**Já pedimos escopo de escrita.** A fase 3 escreve na agenda. Pedir
`calendar.events` / `Calendars.ReadWrite` agora evita um segundo consentimento
depois — o usuário autoriza uma vez.

## Modelo de dados

```prisma
enum CalendarProvider {
  GOOGLE
  MICROSOFT
}

enum CalendarConnectionStatus {
  ACTIVE
  NEEDS_REAUTH
  REVOKED
}

model CalendarConnection {
  id                   String                   @id @default(cuid())
  userId               String
  companyId            String
  provider             CalendarProvider
  providerAccountEmail String
  accessTokenEnc       String
  accessTokenExpiresAt DateTime
  refreshTokenEnc      String
  scopes               String
  status               CalendarConnectionStatus @default(ACTIVE)
  publishEnabled       Boolean                  @default(true)
  syncCursor           String?
  lastSyncAt           DateTime?
  lastSyncError        String?
  createdAt            DateTime                 @default(now())
  updatedAt            DateTime                 @updatedAt

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company @relation(fields: [companyId], references: [id])

  @@unique([userId, provider])
  @@index([companyId])
  @@index([status])
}
```

`syncCursor`, `lastSyncAt` e `lastSyncError` são escritos pela fase 2 e
`publishEnabled` pela fase 3; nascem aqui para não migrar a tabela duas vezes. As
**relações inversas** (`events` na fase 2, `publishedEvents` na fase 3) entram junto
com as tabelas de cada fase — o Prisma exige os dois lados, então cada fase
acrescenta seu campo aqui. A migration é nova (`pnpm db:migrate`) — nenhuma
migration aplicada é editada.

`CALENDAR_ENCRYPTION_KEY` entra em `apps/api/.env.example` junto das outras
variáveis, documentada como base64 de 32 bytes.

### Credenciais por empresa

Chaves em `AppSetting` (`key_companyId`), nomes fixados como constantes exportadas
pelo service:

| Chave | Conteúdo |
| --- | --- |
| `calendar_google_client_id` | texto puro |
| `calendar_google_client_secret_enc` | cifrado |
| `calendar_microsoft_client_id` | texto puro |
| `calendar_microsoft_client_secret_enc` | cifrado |
| `calendar_microsoft_tenant_id` | texto puro |

Um provedor está "configurado" quando client id e secret existem (e `tenant_id`,
no caso Microsoft). Não há flag separada de habilitação: configurar É habilitar,
limpar as credenciais É desabilitar. Menos estado para divergir.

## Cifra de segredos

Novo `apps/api/src/lib/crypto.ts`, com uma responsabilidade só:

```ts
export function encryptSecret(plain: string): string   // "v1:<iv>:<tag>:<ct>", base64url
export function decryptSecret(stored: string): string
```

AES-256-GCM, chave de 32 bytes em `CALENDAR_ENCRYPTION_KEY` (base64), lida via
`lib/config.ts` no padrão do `JWT_SECRET`: fallback derivado em desenvolvimento,
erro na subida em produção. O prefixo `v1:` deixa a porta aberta para rotação de
chave sem adivinhar formato.

Nada de token ou secret decifrado entra em log, em resposta HTTP ou em audit log.
Concretamente:

- `toPublicUser` e vizinhos em `lib/serialize.ts` não ganham nenhum campo novo.
- O DTO de conexão (abaixo) não tem campo de token.
- `recordAuditLog` das credenciais grava `{ configured: true }`, nunca o valor.
- A cláusula de proteção do `audit-log-service.ts` passa a cobrir também
  `accessTokenEnc`/`refreshTokenEnc` se um include aninhado alcançar
  `CalendarConnection`.

## Adapters de provedor

`apps/api/src/lib/calendar/provider.ts` define o contrato; `google.ts` e
`microsoft.ts` implementam; `index.ts` resolve provider → adapter. Esses dois
arquivos são o **único** lugar que conhece o formato de cada provedor — a mesma
disciplina do `teams-client.ts`, onde só uma função sabe o que é Adaptive Card.

```ts
export interface CalendarCredentials {
  clientId: string
  clientSecret: string
  tenantId?: string
}

export interface CalendarTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scopes: string
}

export interface CalendarProviderAdapter {
  authorizeUrl(input: { creds: CalendarCredentials; redirectUri: string; state: string }): string
  exchangeCode(input: { creds: CalendarCredentials; redirectUri: string; code: string }): Promise<CalendarTokens & { email: string }>
  refresh(input: { creds: CalendarCredentials; refreshToken: string }): Promise<CalendarTokens>
  revoke(input: { creds: CalendarCredentials; refreshToken: string }): Promise<void>
}
```

Fases 2 e 3 acrescentam `listEvents` e `createEvent`/`updateEvent`/`deleteEvent` a
essa mesma interface.

Escopos pedidos:

- Google: `openid email https://www.googleapis.com/auth/calendar.events`,
  com `access_type=offline` e `prompt=consent` (sem isso o Google não devolve
  refresh token na segunda autorização).
- Microsoft: `openid email offline_access Calendars.ReadWrite`, no endpoint do
  tenant configurado.

`refresh` que volta `invalid_grant` (Google) ou `AADSTS700082`/consent revogado
(Microsoft) é um erro **esperado**: vira `status = NEEDS_REAUTH`, não exceção.

Assimetria conhecida entre os dois: o Google tem endpoint de revoke, a Microsoft
**não** expõe revoke de refresh token delegado (só `/me/revokeSignInSessions`, que
encerra todas as sessões da pessoa — desproporcional para "desconectei meu
calendário"). No lado Microsoft, `revoke` é no-op; o que garante que o Legends
perde o acesso, nos dois casos, é apagar a conexão local.

## Serviço e rotas

`apps/api/src/services/calendar-connection-service.ts` concentra a regra:
resolver credenciais da empresa, montar authorize URL, trocar code, salvar
conexão cifrada, entregar um access token válido (refresh transparente quando
expirado), revogar. Erros de domínio via `CalendarError extends Error` com
`status`, no padrão do `VoteError`.

`apps/api/src/routes/calendar.ts` — rotas finas, Zod com `safeParse`,
`onRequest: [app.authenticate]`, registradas em `app.ts`:

| Rota | Efeito |
| --- | --- |
| `GET /calendar/connections` | conexões do próprio usuário + quais provedores a empresa configurou |
| `POST /calendar/connect/:provider` | devolve `{ authorizeUrl }`; 409 se o provedor não está configurado |
| `GET /calendar/callback/:provider` | valida `state`, troca o code, salva, redireciona para `/perfil/<userId>?calendario=ok\|erro` (a rota do front é `/perfil/:id`) |
| `DELETE /calendar/connections/:provider` | revoga no provedor (best-effort) e apaga a linha |

`app.requireAdmin` em `routes/admin.ts`:

| Rota | Efeito |
| --- | --- |
| `GET /admin/calendar-settings` | `{ google: { configured, clientId }, microsoft: { configured, clientId, tenantId } }` — secret nunca volta |
| `PUT /admin/calendar-settings` | grava credenciais (secret cifrado), com audit log; string vazia limpa |

**O `state` é um token curto assinado por HMAC** (10 min), contendo `userId`,
`companyId`, `provider` e um nonce, em `lib/calendar/state.ts`. Isso resolve CSRF no
callback sem tabela de estado nem sessão: o callback só aceita um `state` que nós
mesmos assinamos, e o `userId` vem de dentro dele — não do request.

Deliberadamente **não** é um JWT da app: reusar o segredo e o formato do access
token criaria um caminho para um `state` ser apresentado como credencial de sessão.
A chave do HMAC é derivada de `CALENDAR_ENCRYPTION_KEY` com separação de domínio.

O `redirectUri` é derivado de `lib/app-url.ts` (`absoluteUrl`), nunca aceito por
parâmetro; um redirect URI controlável pelo cliente é o buraco clássico desse
fluxo. Deve ser registrado no app do cliente como
`<APP_URL>/api/calendar/callback/google` e `.../microsoft`.

## Contrato compartilhado

Novo `packages/shared/src/calendar.ts`, exportado no barril:

```ts
export type CalendarProviderKey = 'google' | 'microsoft'

export interface CalendarConnectionDTO {
  provider: CalendarProviderKey
  accountEmail: string
  status: 'active' | 'needs_reauth' | 'revoked'
  publishEnabled: boolean
  lastSyncAt: string | null
}

export interface CalendarIntegrationStateDTO {
  connections: CalendarConnectionDTO[]
  /** Provedores que o admin da empresa já configurou. */
  available: CalendarProviderKey[]
}
```

Sem campo de token, por construção. `toCalendarConnectionDTO` entra em
`lib/serialize.ts` junto dos outros conversores.

## Frontend

**Perfil — seção "Integrações".** Para cada provedor disponível: estado e ação.
Quatro estados possíveis, todos com texto explícito em português:

- não configurado pela empresa → "Seu administrador ainda não configurou o Google
  Calendar" (sem botão);
- configurado e desconectado → botão "Conectar";
- conectado → e-mail da conta + "Desconectar";
- `needs_reauth` → aviso de que o acesso expirou + "Reconectar".

O clique em conectar chama `POST /calendar/connect/:provider` e navega para a
`authorizeUrl` retornada. A volta cai em `/perfil?calendario=ok|erro`, que mostra
um toast e limpa o parâmetro.

**Admin — `CalendarSection.tsx`.** Formulário por provedor (client id, client
secret, tenant id). O secret aparece como campo vazio com placeholder
"configurado" quando já existe: enviar vazio mantém o atual, enviar valor troca,
limpar explicitamente remove. A seção explica em uma frase quais redirect URIs
registrar.

Tudo via `lib/api.ts` (`/api/...`), com React Query, como o resto do app.

## Erros

| Situação | Resposta |
| --- | --- |
| Provedor não configurado na empresa | `409` com mensagem em português |
| `state` inválido ou expirado no callback | redirect para `/perfil?calendario=erro` |
| Provedor recusa o code | idem, com `lastSyncError` não gravado (não há conexão) |
| `refresh` com consentimento revogado | `status = NEEDS_REAUTH`, sem exceção |
| Falha de rede no `revoke` | apaga a conexão local e loga; não bloqueia o usuário |
| `CALENDAR_ENCRYPTION_KEY` ausente em produção | erro na subida do processo |

## Testes

Vitest ao lado do código, Postgres real (`pnpm db:up`), HTTP dos provedores por
stub de `fetch` — exatamente como `lib/teams-client.test.ts` já faz.

- `lib/crypto.test.ts`: round-trip; texto cifrado difere entre chamadas (IV
  aleatório); ciphertext adulterado falha na autenticação da tag.
- `lib/calendar/google.test.ts`, `microsoft.test.ts`: `authorizeUrl` carrega
  scopes, `state`, `access_type=offline` (Google) e o tenant certo (Microsoft);
  `exchangeCode` mapeia a resposta para `CalendarTokens`; `invalid_grant` no
  refresh é sinalizado como reauth, não exceção.
- `services/calendar-connection-service.test.ts`: conexão nasce `ACTIVE` com
  tokens cifrados no banco (asserção direta: o valor no banco **não** contém o
  token em claro); reconectar o mesmo provedor atualiza a linha em vez de
  duplicar; access token expirado dispara refresh e persiste o novo.
- `routes/calendar.test.ts`: 401 sem auth; 409 sem credenciais; callback com
  `state` de outro usuário é rejeitado; `DELETE` remove a conexão.
- `routes/admin.test.ts`: `PUT` grava audit log sem o secret; `GET` nunca devolve
  secret; não-admin recebe 403.
- Web: a seção de integrações renderiza os quatro estados; admin envia vazio sem
  apagar o secret existente.

## Fora de escopo

- Ler ou escrever eventos (fases 2 e 3).
- Qualquer mudança no `teams-client.ts` e no fluxo de Power Automate atual.
- Login social / SSO — este OAuth é só para calendário e não autentica ninguém.
- App único do Legends com verificação no Google (decisão explícita acima).
