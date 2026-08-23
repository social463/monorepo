# Painéis de RH embutidos — design

Data: 2026-08-01
Branch: `feat-admin-dashboards-crud`

## Problema

Os números de RH da EMR vivem fora do Legends (Power BI, Looker Studio, Metabase
interno). Hoje a liderança troca de ferramenta para olhar painel, e o time de Gente e
Gestão não passa o dia no Legends. Embutir os painéis é a entrega mais barata do lote e
a que traz esse público para dentro do produto.

A origem é o `/app/admin/dashboards` do portal EMR: CRUD de painel externo (título,
descrição, URL de embed, altura, ordem) renderizado em `<iframe>`. O portal aceita
**qualquer URL** vinda do formulário — é exatamente o que não se deve copiar.

## Escopo

Entra:

- CRUD de painel: título, descrição, URL de embed, altura, ordem.
- Escopo do painel: da empresa inteira ou de um setor específico.
- Exibição embutida na ordem definida, com botão de abrir em nova aba.
- Validação de URL no backend (https + allowlist de hosts), sandbox no iframe e
  `frame-src` no CSP do nginx.

Não entra: construir gráfico dentro do Legends, SSO com a ferramenta de BI, cache dos
dados do painel.

## Audiência

Os painéis vivem **exclusivamente dentro de `/admin`**: quem cadastra é quem vê. Número
de RH (headcount, turnover, absenteísmo) não é dado para o colaborador comum, então não
há tela de leitura fora da administração, nem `FeatureKey` nova, nem rota pública.

- **ADMIN** — vê e gerencia todos os painéis da empresa.
- **SUBADMIN** — vê os painéis da empresa (`sectorId = null`) e os do próprio setor;
  gerencia **só** os do próprio setor.

O "líder de Gente e Gestão" do enunciado é o SUBADMIN do setor "Gente e Gestão".

## Contrato — `packages/shared/src/hr-dashboard.ts`

```ts
export const HR_DASHBOARD_MIN_HEIGHT = 300
export const HR_DASHBOARD_MAX_HEIGHT = 2000
export const HR_DASHBOARD_DEFAULT_HEIGHT = 720
export const HR_DASHBOARD_TITLE_MAX_LENGTH = 120
export const HR_DASHBOARD_DESCRIPTION_MAX_LENGTH = 400
export const HR_DASHBOARD_URL_MAX_LENGTH = 2000

export interface HrDashboardDTO {
  id: string
  title: string
  description: string | null
  embedUrl: string
  height: number
  sortOrder: number
  /** null = painel da empresa inteira. */
  sectorId: string | null
  sectorName: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateHrDashboardRequest {
  title: string
  description?: string | null
  embedUrl: string
  height?: number
  sortOrder?: number
  sectorId?: string | null
}

export type UpdateHrDashboardRequest = Partial<CreateHrDashboardRequest>

export interface HrDashboardListResponse {
  dashboards: HrDashboardDTO[]
  /** Hosts aceitos, para o formulário dizer quais ferramentas estão liberadas. */
  allowedHosts: string[]
}

/** Filtro de escopo da listagem (só ADMIN usa); `all` é o default. */
export type HrDashboardScopeFilter = 'all' | 'company' | (string & {})
```

`allowedHosts` volta na listagem de propósito: sem isso, o admin só descobre que o host
está errado errando. Exportado no barril `index.ts`.

## Dados — Prisma

```prisma
model HrDashboard {
  id          String   @id @default(cuid())
  title       String
  description String?
  embedUrl    String
  height      Int      @default(720)
  sortOrder   Int      @default(0)
  sectorId    String?
  companyId   String
  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  company   Company @relation(fields: [companyId], references: [id])
  sector    Sector? @relation(fields: [sectorId], references: [id], onDelete: Cascade)
  createdBy User    @relation(fields: [createdById], references: [id])

  @@index([companyId, sectorId, sortOrder])
}
```

`HrDashboard` entra em `TENANT_SCOPED_MODELS` (`apps/api/src/lib/tenant-scope.ts`) —
toda leitura e escrita passa por `scopedPrisma(companyId)`.

A FK de setor é **`onDelete: Cascade`**, não `SetNull`: com `SetNull`, apagar um setor
promoveria os painéis dele a painéis da empresa, expondo dado de RH de um setor para
todos os administradores. Sumir é o comportamento seguro.

Migration nova via `pnpm db:migrate` — nenhuma migration aplicada é editada.

## Validação de URL — `apps/api/src/lib/embed-url.ts`

`embedUrl` é conteúdo de terceiro embutido no produto. Validação no backend, em função
pura testável isolada:

```ts
export function assertEmbedUrlAllowed(raw: string, allowedHosts: string[]): string
```

Regras, em ordem — cada falha vira `HrDashboardError` com status 400 e mensagem em
português:

1. `new URL(raw)` lança → "Informe uma URL válida."
2. `protocol !== 'https:'` → "Somente endereços https são aceitos." Pega `http:`,
   `javascript:` e `data:` no mesmo teste.
3. `username` ou `password` presentes → "URL com credenciais não é aceita."
4. `port` explícita → "URL com porta não é aceita."
5. `hostname` em minúsculas **não está na allowlist por igualdade exata** → "O endereço
   `<host>` não está entre as ferramentas liberadas." Igualdade exata, nunca sufixo:
   `app.powerbi.com.evil.com` cai fora.

Devolve `url.toString()` normalizado, que é o valor persistido.

A allowlist vem de `apps/api/src/lib/config.ts`:

```ts
export function resolveHrDashboardAllowedHosts(env: { HR_DASHBOARD_ALLOWED_HOSTS?: string }): string[]
```

Lê `HR_DASHBOARD_ALLOWED_HOSTS` (CSV), normaliza para minúsculas e descarta entradas
vazias. Vazia ou ausente → default embutido: `app.powerbi.com`,
`lookerstudio.google.com`, `datastudio.google.com`. O host do Metabase interno é do
ambiente, então entra pela env no deploy; `apps/api/.env.example` documenta a variável.

## Backend

### Service — `apps/api/src/services/hr-dashboard-service.ts`

`HrDashboardError extends Error` com `status` HTTP, no padrão `VoteError`. Todo acesso
por `scopedPrisma(companyId)`. Toda mutação grava `recordAuditLog`
(`entityType: 'HrDashboard'`) **dentro do mesmo `$transaction`** da escrita.

| Função | Regra |
|---|---|
| `listHrDashboards` | SUBADMIN: `OR: [{ sectorId: null }, { sectorId: actor.sectorId }]`. ADMIN: tudo, ou filtrado por `scope` (`company` → `sectorId: null`; cuid → aquele setor). Ordem `[{ sortOrder: 'asc' }, { createdAt: 'asc' }]` |
| `createHrDashboard` | Valida a URL; SUBADMIN sempre cria no próprio setor — `sectorId` omitido assume o setor dele, `sectorId` explícito e diferente (inclusive `null`) → 403; ADMIN escolhe qualquer setor da empresa (existência validada) ou `null` para painel da empresa; audita `CREATE` |
| `updateHrDashboard` | Carrega o existente; SUBADMIN só toca painel do próprio setor e não pode movê-lo para outro escopo (→ 403); revalida a URL quando `embedUrl` muda; audita `UPDATE` com `before`/`after` |
| `deleteHrDashboard` | Mesma guarda de escopo do update; audita `DELETE` |

### Rotas — `apps/api/src/routes/hr-dashboards.ts`

Registradas em `app.ts` sob `/admin/hr-dashboards`, seguindo `/admin/office-settings`.
**Todas** com `onRequest: [app.authenticate, app.requireAdminOrSubadmin]` — inclusive o
GET, já que a audiência é só a liderança.

- `GET /admin/hr-dashboards?scope=` → `HrDashboardListResponse`
- `POST /admin/hr-dashboards`
- `PATCH /admin/hr-dashboards/:id`
- `DELETE /admin/hr-dashboards/:id`

Rota fina: Zod `safeParse` → `400 { message, issues }`, chama o service, serializa com
`toHrDashboardDTO` em `lib/serialize.ts`. `height` validado por Zod
(`int().min(HR_DASHBOARD_MIN_HEIGHT).max(HR_DASHBOARD_MAX_HEIGHT)`). Erro de domínio
tratado por `instanceof HrDashboardError` → `err.status`; o resto sobe.

## Frontend

`apps/web/src/pages/admin/HrDashboardsSection.tsx`, rota aninhada `/admin/paineis` em
`App.tsx`, item **"Painéis de RH"** no grupo *Visão geral* da `AdminSidebar` — sem
`adminOnly` e sem `featureKey`, porque o SUBADMIN precisa enxergar.

Dados por React Query + `apiFetch`. Cabeçalho com o seletor de escopo (só para ADMIN:
"Todos", "Empresa" e um item por setor) e o botão "Novo painel". Formulário de
criação/edição com título, descrição, URL, altura e ordem; a mensagem de erro do
backend aparece como está (já vem em português) e o campo de URL mostra os
`allowedHosts` como dica.

Painéis empilhados na ordem definida. Cada card traz título, descrição, chip de escopo
(Empresa / nome do setor), "Abrir em nova aba" (`rel="noreferrer noopener"`), editar,
excluir, e o iframe:

```jsx
<iframe
  src={dashboard.embedUrl}
  height={dashboard.height}
  title={dashboard.title}
  loading="lazy"
  referrerPolicy="no-referrer"
  sandbox="allow-scripts allow-same-origin"
/>
```

Sem `allow-top-navigation` e sem `allow-popups`: o painel embutido não navega a aba de
cima nem abre janela. `allow-scripts allow-same-origin` juntos só anulariam o sandbox se
o conteúdo fosse da mesma origem do Legends — aqui é sempre terceiro, e as ferramentas
de BI precisam dos dois para autenticar a sessão.

Sem nenhum painel: estado vazio com "Nenhum painel cadastrado ainda" e a ação
"Cadastrar o primeiro painel".

## CSP — `nginx/default.conf`

O nginx hoje não emite CSP nenhum. A política nova tem **uma diretiva só**, no
`location /`:

```nginx
add_header Content-Security-Policy "frame-src 'self' https://app.powerbi.com https://lookerstudio.google.com https://datastudio.google.com;" always;
```

Sem `default-src`, nada além de frames fica restrito — Phaser (blob workers), LiveKit
(wss), imagens do S3 e estilos inline do Tailwind seguem funcionando. Uma CSP completa é
hardening de verdade, mas é tarefa própria, com risco real de quebrar tela em produção.

A lista repete a de `resolveHrDashboardAllowedHosts`; um comentário no `default.conf`
aponta para lá. A duplicação é consciente e mantida à mão: acrescentar host exige mexer
nos dois lugares.

## Testes

Vitest, colocados ao lado do arquivo. API contra Postgres real (`pnpm db:up`; nesta
máquina `LEGENDS_DB_PORT=5442`).

- **`lib/embed-url.test.ts`** — puro: `http:`, `javascript:`, `data:`, host fora da
  allowlist, subdomínio forjado (`app.powerbi.com.evil.com`), userinfo, porta explícita,
  host em maiúsculas aceito, URL válida devolvida normalizada.
- **`services/hr-dashboard-service.test.ts`** — SUBADMIN vê empresa + próprio setor e
  não vê o de outro setor; SUBADMIN recebe 403 ao editar/apagar painel da empresa ou de
  outro setor; ordenação por `sortOrder`; auditoria gravada em create/update/delete.
- **`routes/hr-dashboards.test.ts`** — chamada direta à API com host fora da allowlist e
  com `http:` → 400 em português; altura 299 e 2001 → 400; papel LEGEND → 403;
  criação e listagem no caminho feliz.
- **`pages/admin/HrDashboardsSection.test.tsx`** — estado vazio com a ação de cadastrar;
  iframe renderizado com `sandbox` e **sem** `allow-top-navigation`; painéis na ordem de
  `sortOrder`; erro do backend exibido.

## Critérios de aceite

1. Admin cadastra painel com título e URL válida e ele passa a aparecer embutido, na
   ordem definida.
2. URL com esquema diferente de https é recusada com 400 e mensagem em português.
3. URL de host fora da allowlist é recusada com 400, inclusive por chamada direta à API.
4. Altura fora de 300–2000 é recusada.
5. O iframe é renderizado com `sandbox` e sem permissão de navegação no topo.
6. Painel de um setor não aparece para o SUBADMIN de outro setor.
7. Sem painel cadastrado, a tela mostra estado vazio com ação de cadastrar o primeiro.
