# Dashboard de métricas por empresa (Super Admin) — Design

## Contexto

A `SuperAdminPage.tsx` (`/super-admin`) já lista empresas com nome/slug/status e
permite criar (`POST /super-admin/companies`, cria empresa + setor "Geral" +
primeiro admin) e editar (`PATCH /super-admin/companies/:id`, nome/`active`).
Isso é só leitura de identidade — não há nenhuma métrica de uso.

O super admin (perfil recém-criado, primeira conta real em produção) quer, ao
entrar, ter visão de negócio: quantos usuários cada empresa tem, como estão
distribuídos por setor, e — preparando terreno para quando existirem empresas
pagantes — desde quando cada empresa está na base. **Plano/billing fica fora
de escopo**: não existe esse conceito no schema hoje e não há regra de negócio
definida ainda; adicionar o campo agora seria especular sem uso real.

## Escopo

- Lista (`/super-admin`, tela existente): cada linha vira link para o detalhe;
  ganha um chip discreto com o total de usuários da empresa (leitura rápida
  sem precisar entrar). CRUD existente (criar empresa, editar nome/status)
  não muda.
- Nova página de detalhe (`/super-admin/companies/:id`): nome, status, "criada
  em", total de usuários, usuários por setor.
- Backend: um novo endpoint agregado (não expande o `GET` de listagem, que
  fica leve) — dashboard só busca dados quando o super admin entra no
  detalhe.

Fora de escopo: campo de plano/billing; edição de setores pela tela de super
admin (isso já existe na área de admin da própria empresa); qualquer
enforcement de limites por plano; auditoria dessas visualizações.

## Backend

### `GET /super-admin/companies/:id/dashboard`

Guard: `superAdminOnly` (mesmo padrão do arquivo — `onRequest: [app.authenticate, app.requireSuperAdmin]`).

Implementação inline em `apps/api/src/routes/super-admin.ts` (mesmo padrão sem
service próprio que o arquivo já segue):

```ts
app.get('/super-admin/companies/:id/dashboard', superAdminOnly, async (request, reply) => {
  const { id } = request.params as { id: string }
  const company = await prisma.company.findUnique({ where: { id } })
  if (!company) return reply.code(404).send({ message: 'Empresa não encontrada.' })

  const sectors = await prisma.sector.findMany({
    where: { companyId: id },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, _count: { select: { users: true } } },
  })
  const totalUsers = sectors.reduce((sum, s) => sum + s._count.users, 0)

  return reply.send({
    company,
    totalUsers,
    sectorBreakdown: sectors.map((s) => ({ sectorId: s.id, sectorName: s.name, userCount: s._count.users })),
  })
})
```

- Usa `_count` por setor em vez de `groupBy` em `User` — assim setores sem
  nenhum usuário aparecem no resultado com `userCount: 0` (não somem da
  lista), e evita um segundo lookup pra casar nome do setor com o id.
- `totalUsers` soma os setores (equivalente a contar todos os usuários da
  empresa) — não conta usuários "órfãos" porque `User.sectorId` é obrigatório
  (`@default`, sempre presente).
- 404 se a empresa não existir. 403 já é tratado pelo guard `superAdminOnly`
  (mesmo comportamento das outras rotas do arquivo).

### Chip de contagem na listagem

Em vez de mudar o shape de `GET /super-admin/companies`, o chip da lista
reaproveita o mesmo endpoint de dashboard por empresa (`useQuery` por linha,
`enabled` sempre — lista de empresas costuma ser pequena, dezenas no máximo,
não centenas). Alternativa descartada: expandir `GET /super-admin/companies`
para incluir `_count.users` por empresa direto — mais eficiente (uma query só),
mas acopla a rota de listagem (usada também pelo formulário de criação) a uma
métrica que só a lista consome visualmente; se a lista crescer a ponto de N+1
queries pesarem, revisitar então.

## Contrato compartilhado (`packages/shared/src/company.ts`)

```ts
export interface CompanySectorBreakdownDTO {
  sectorId: string
  sectorName: string
  userCount: number
}

export interface CompanyDashboardDTO {
  company: CompanyDTO & { createdAt: string }
  totalUsers: number
  sectorBreakdown: CompanySectorBreakdownDTO[]
}
```

`CompanyDTO` hoje não tem `createdAt` — o endpoint de dashboard retorna o
model do Prisma direto (mesmo padrão das rotas existentes no arquivo, que não
serializam `Company`), então `createdAt` vem naturalmente; o tipo compartilhado
só precisa declarar o campo.

## Frontend

### Lista (`SuperAdminPage.tsx`)

- `CompanyRow` (modo leitura) ganha um `<Link to={`/super-admin/companies/${company.id}`}>`
  envolvendo o nome (ou um botão "Ver detalhes" ao lado dos já existentes
  "Editar"/"Ativar"-"Desativar" — não substitui as ações inline que já
  funcionam).
- Chip de usuários: pequeno `<CompanyUserCountChip companyId={company.id} />`
  que faz `useQuery(['super-admin', 'companies', company.id, 'dashboard'])` e
  renderiza só `totalUsers` (loading → nada ou "…", sem spinner — é
  informação secundária). Reaproveita o endpoint do dashboard para não criar
  um terceiro shape de resposta.

### Nova página `CompanyDashboardPage.tsx` (`apps/web/src/pages/CompanyDashboardPage.tsx`)

Segue o padrão visual de `AdminDashboardPage.tsx` (cards
`rounded-xl border border-outline-variant/40 bg-surface-container p-lg`) e usa
`Panel`/`inputCls` de `pages/admin/shared.tsx` onde fizer sentido, consistente
com `SuperAdminPage.tsx`:

- Cabeçalho: nome da empresa, badge de status (ativo/inativo, mesmo estilo de
  `PeriodStateBadge`), "criada em" formatada (`toLocaleDateString('pt-BR')`),
  link "← Voltar" para `/super-admin`.
- Card "Usuários": número grande com `totalUsers`.
- Card/lista "Por setor": `sectorBreakdown` em tabela simples (nome do setor +
  contagem), ordenada por nome (já vem ordenada do backend).
- Estados: loading (`"Carregando..."`, mesmo texto usado em `SuperAdminPage`),
  404 (empresa não encontrada → mensagem + link de volta).

### Rotas (`App.tsx`)

Nova rota dentro do mesmo gate `SuperAdminOnly` que já protege `/super-admin`:

```tsx
<Route
  path="/super-admin/companies/:id"
  element={
    <ProtectedRoute>
      <SuperAdminOnly>
        <CompanyDashboardPage />
      </SuperAdminOnly>
    </ProtectedRoute>
  }
/>
```

## Testes

- Backend (`super-admin.test.ts`): `GET /companies/:id/dashboard` retorna
  `totalUsers` e `sectorBreakdown` corretos (inclui setor com 0 usuários),
  404 pra id inexistente, 403 pra quem não é `SUPER_ADMIN`.
- Frontend:
  - `CompanyDashboardPage.test.tsx`: renderiza métricas a partir do mock da
    API, mostra estado de "empresa não encontrada" em 404.
  - `SuperAdminPage.test.tsx`: linha da lista linka para
    `/super-admin/companies/:id`; chip mostra a contagem retornada pelo mock.
