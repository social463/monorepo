# UI de gestão de empresas (Super Admin) — Design

## Contexto (revisado)

**Correção importante:** a versão original deste spec assumia que não existia
nenhuma UI de Super Admin. Isso estava errado — `apps/web/src/pages/SuperAdminPage.tsx`
já existe (commit `84ee88c9`, já mergeado em `feat/multi-empresa-auth-jwt-clean`),
com: rota `/super-admin`, gate `SuperAdminOnly` em `App.tsx`, redirect pós-login
pra quem loga como `SUPER_ADMIN`, listagem de empresas (`GET /super-admin/companies`)
e criação (empresa + primeiro admin, `POST /super-admin/companies`, atômico).
Testes cobrindo tudo isso já existem em `SuperAdminPage.test.tsx` e
`super-admin.test.ts`.

O que falta, de fato: a lista hoje é **só leitura** — mostra nome/slug/status
(riscado quando `active: false`), mas não tem como renomear nem
ativar/reativar uma empresa pela UI. Não existe endpoint de update na API.

## Escopo (revisado)

- Backend: novo `PATCH /super-admin/companies/:id` (renomear + `active`) em
  `apps/api/src/routes/super-admin.ts`.
- Contrato compartilhado: tipo de request em `packages/shared/src/company.ts`.
- Frontend: edição inline na `SuperAdminPage.tsx` já existente — cada linha da
  lista ganha "Editar" (campo nome + toggle ativa/inativa, Salvar/Cancelar) e
  um atalho "Ativar"/"Desativar" direto, mesmo padrão de
  `AdministratorRow` em `pages/admin/AdministratorsSection.tsx`.

Fora de escopo (inalterado): exclusão definitiva de empresa; enforcement de
`company.active` no login/acesso (`active` continua só informativo — nenhuma
rota checa isso hoje, para nenhuma empresa); auditoria das ações do Super Admin;
qualquer tela de "impersonar" um admin de empresa específica.

## Backend

### `PATCH /super-admin/companies/:id`

Body (Zod, todos os campos opcionais, mas pelo menos um obrigatório):
```ts
{ name?: string, active?: boolean }
```
- `name`: trim, mínimo 1 caractere se informado. Recalcula `slug` via `slugify(name)`
  (mesma função já usada em `createCompanySchema`, importada de `../lib/slug`).
- `active`: booleano puro.
- 404 se a empresa não existir; 409 (`Prisma.PrismaClientKnownRequestError` código
  `P2002`) se o novo nome colidir com um slug já existente de outra empresa.
- Response: `{ company: Company }` (mesmo shape do `POST`/`GET` — `Company` é o
  model do Prisma Client, já usado sem serialização própria nas duas rotas
  existentes).
- Guard: `superAdminOnly` (já definido no arquivo, primeira linha de
  `superAdminRoutes`).

Implementação inline na própria rota (mesmo padrão do arquivo hoje — 61 linhas,
sem service próprio).

## Contrato compartilhado (`packages/shared/src/company.ts`)

Adicionar ao arquivo existente (que hoje só tem `DEFAULT_COMPANY_ID`,
`INTERNAL_COMPANY_ID`, `CompanyDTO`):
```ts
export interface UpdateCompanyRequest {
  name?: string
  active?: boolean
}
```
(Não precisamos de tipo de response novo — `{ company: CompanyDTO }`, igual ao
que `SuperAdminPage.tsx` já usa inline pro `POST`.)

## Frontend

### Edição inline em `SuperAdminPage.tsx`

Cada linha da lista de empresas (hoje um `<li>` simples, só leitura) vira um
componente com estado próprio de edição — mesmo padrão de `AdministratorRow`
em `pages/admin/AdministratorsSection.tsx`:

- Modo leitura: nome + slug + badge de status; botões "Editar" e
  "Ativar"/"Desativar" (o toggle dispara a mutação direto, sem entrar no modo
  de edição — só muda `active`).
- Modo edição (clicou "Editar"): campo de texto com o nome atual, toggle de
  ativa/inativa, botões "Salvar"/"Cancelar". "Salvar" valida nome não-vazio
  antes de mandar.
- Mutação: `useMutation` que chama `PATCH /super-admin/companies/:id`,
  `onSuccess` invalida `['super-admin', 'companies']` (mesma query key já usada
  na página); erro mostra mensagem inline (`updateError`), mesmo padrão de
  `AdministratorsSection`.

### API client

Sem novo arquivo — `SuperAdminPage.tsx` já faz `apiFetch` inline (não usa um
módulo `super-admin-api.ts` separado, diferente do que a v1 deste spec supôs).
Mantém esse padrão: a chamada `PATCH` vai inline no componente, igual ao
`POST` que já existe ali.

## Testes

- Backend (`super-admin.test.ts`): `PATCH` renomeia (200, `slug` recalculado),
  ativa/desativa (200), 404 pra id inexistente, 409 pra nome colidindo com slug
  existente, 403 pra quem não é `SUPER_ADMIN` (reaproveita `adminToken` já
  definido no arquivo).
- Frontend (`SuperAdminPage.test.tsx`): editar nome de uma empresa (chama
  `PATCH` com o payload certo, lista atualiza), ativar/desativar direto pelo
  atalho, cancelar edição não dispara chamada nenhuma.
