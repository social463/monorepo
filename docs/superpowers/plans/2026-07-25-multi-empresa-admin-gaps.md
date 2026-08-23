# Multi-empresa — fix dos gaps de admin.ts (POST /admin/users + ADMIN nunca checado contra empresa do alvo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os 2 piores gaps de multi-tenancy encontrados no audit de completude de PR #10609:
(1) `POST /admin/users` nunca seta `companyId` (cai sempre em `company-emr`) nem valida `sectorId`
contra a empresa do ator; (2) em squads, períodos de votação (+ 4 sub-rotas de highlight), votos,
revogação de selo e revogação de convite terceirizado, só `SUBADMIN` é checado contra o setor do
alvo — `ADMIN` nunca é checado contra a empresa do alvo, então um `ADMIN` de uma empresa consegue
ler/editar/apagar recursos de outra empresa por id.

**Architecture:** Para cada handler afetado, trocar a busca crua do alvo
(`prisma.<model>.findUnique`) por `scopedPrisma(request.user.companyId).<model>.findUnique(...)` —
um alvo de outra empresa passa a não existir para essa query, virando 404 genuíno para qualquer
papel de admin. Cada função de service ganha `companyId` como novo parâmetro (sempre o último,
antes de nenhum — ver assinaturas exatas em cada task), vindo de `request.user.companyId` na rota
chamadora, e usa `scopedPrisma(companyId)` para carregar o `before`/alvo em vez de derivar o
escopo do `before.companyId` já carregado sem filtro. `sector-service.ts` já segue esse padrão —
é o exemplo a replicar (ver Task 0). A checagem de `sectorId` do `SUBADMIN` já existente continua
por cima, como restrição adicional mais estreita.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Zod, Vitest (contra Postgres real).

## Global Constraints

- **REGRA DE SEGURANÇA:** antes de rodar qualquer comando que grave no Postgres (migrations,
  `db:migrate`, seeds, ou mesmo só iniciar os testes), confira `apps/api/.env`'s `DATABASE_URL` —
  tem que apontar para `localhost:5432` (Postgres local via `pnpm db:up`), nunca para o host de
  homologação/produção. Esta fatia **não gera migration nova** (nenhum campo de schema muda), mas
  os testes da API batem em banco real (`legends_test`), então a regra vale do mesmo jeito.
- Esta fatia parte do código já commitado em `origin/feat/multi-empresa-auth-jwt-clean` (PR
  #10609). Se ao criar a branch de trabalho `origin/main` ainda não tiver esse PR mergeado, tire a
  branch de `origin/feat/multi-empresa-auth-jwt-clean` em vez de `origin/main` — os arquivos e
  assinaturas descritos abaixo assumem esse estado (confira com `git log --oneline -1` no arquivo
  antes de editar, e não confie em um working tree local com mudanças soltas de outra linha de
  trabalho).
- `pnpm db:up` precisa estar de pé antes de rodar qualquer teste da API (`fileParallelism: false`,
  os testes truncam todas as tabelas em `beforeEach`).
- Mensagens ao usuário em português; siga o estilo já existente na camada vizinha (mesma mensagem
  "Setor inválido.", "Squad não encontrada.", etc. — nunca revelar que um recurso existe em outra
  empresa via mensagem diferente de "não encontrado").
- Retro (retrospectivas) e `AdminAuditLog`/`DevelopmentThursdayEvent` globais ficam **fora de
  escopo** desta fatia — não toque nesses arquivos.
- Rode só o(s) arquivo(s) de teste do que foi alterado durante a implementação de cada task
  (ex.: `pnpm --filter @legends/api exec vitest run src/services/squad-service.test.ts`); a suíte
  completa (`pnpm test`) só entra na Task 6, verificação final.

---

## Decisão de leitura — nomes reais confirmados

Lendo `apps/api/src/routes/admin.ts` (estado real em `origin/feat/multi-empresa-auth-jwt-clean`,
849 linhas), os nomes de rota de highlight **divergem da spec resumida** (que sugeria nomes tipo
`highlight-draft`/`highlight-text`/`highlight-image`/`highlight-publish`). Os nomes reais são:

- `GET /admin/periods/:id/highlight` — leitura, já sem gap (não muda estado).
- `POST /admin/periods/:id/highlight` → `generateHighlightDraft`.
- `PATCH /admin/periods/:id/highlight` → `updateHighlightText`.
- `POST /admin/periods/:id/highlight/image` → `generateHighlightImage`.
- `POST /admin/periods/:id/highlight/publish` → `publishHighlight`.

Documentado aqui porque a spec supôs nomes diferentes — implementação segue os nomes reais acima.

Também confirmado: **não existe `vote-service.ts`** — a rota `DELETE /admin/votes/:id` busca e
apaga o voto diretamente em `admin.ts` com `prisma` cru (sem service dedicado). A spec supôs "o
serviço de votos correspondente"; como não há service, a Task 4 ajusta a query inline na própria
rota para `scopedPrisma(request.user.companyId)`, sem criar um service novo (YAGNI — não há
lógica de negócio a extrair, só a query do alvo).

`DELETE /admin/users/:userId/badges/:userBadgeId` é `adminOnly` (não `adminOrSubadmin`) — não há
checagem de `sectorId` de `SUBADMIN` para remover aqui (`SUBADMIN` nunca chega nessa rota), só a
checagem de empresa do `ADMIN` a acrescentar.

---

### Task 0: Ambiente — branch e Postgres

**Files:** nenhum arquivo de código nesta task.

- [ ] **Step 1: Confirmar `DATABASE_URL` local**

```bash
grep DATABASE_URL apps/api/.env
```
Expected: uma linha `DATABASE_URL="postgresql://legends:legends@localhost:5432/legends?schema=public"`
(host `localhost`, nunca um host remoto). Se apontar para outro host, **pare e corrija antes de
continuar** — nenhum comando dos passos seguintes deve rodar contra um `DATABASE_URL` remoto.

- [ ] **Step 2: Subir o Postgres local**

```bash
pnpm db:up
```
Expected: container do Postgres sobe (ou já está de pé).

- [ ] **Step 3: Criar a branch de trabalho a partir do estado correto**

```bash
git fetch origin
git log --oneline -1 origin/main -- apps/api/src/routes/admin.ts
```
Se a saída mostrar um commit que já contém `scopedPrisma`/`companyId` no diff de `admin.ts` (ou
seja, o PR #10609 já foi mergeado em `main`), rode:
```bash
git switch -c fix/multi-empresa-admin-gaps origin/main
```
Caso contrário (main ainda sem o PR), rode:
```bash
git switch -c fix/multi-empresa-admin-gaps origin/feat/multi-empresa-auth-jwt-clean
```

- [ ] **Step 4: Gerar o Prisma Client (garante que os tipos batem com o schema já aplicado)**

```bash
pnpm db:generate
```
Expected: `Generated Prisma Client` sem erros.

---

### Task 1: `POST /admin/users` — `companyId` do ator + validação de `sectorId` escopada

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (handler `app.post('/admin/users', ...)`, linhas
  369-410 no estado lido).
- Modify: `apps/api/src/routes/admin.test.ts` (novos testes dentro do describe `'admin routes'`,
  próximo aos testes existentes de `POST /admin/users` em torno da linha 614; reescrita do teste
  em `'sectorId em /admin/users'`; `sectorId` acrescentado a 8 testes pré-existentes que hoje
  dependem do fallback removido — ver Step 2d).

**Interfaces:**
- Nenhuma assinatura de service muda nesta task — a validação de `sectorId` passa a usar
  `scopedPrisma(request.user.companyId).sector.findUnique(...)` diretamente na rota (mesmo padrão
  já usado em outros pontos de `admin.ts`, ex. `findUserInCompany`).

**IMPORTANTE — o novo comportamento (ADMIN sem `sectorId` → 400) quebra vários testes HOJE
passando**, porque hoje `adminToken(app)` (o helper padrão de admin usado no arquivo) cria
usuários via `POST /admin/users` sem informar `sectorId` — o fallback silencioso pro
`DEFAULT_SECTOR_ID` era exatamente o que fazia esses `POST`s funcionarem. Os Steps 2c/2d abaixo
tratam disso: 2c reescreve o teste cuja premissa é exatamente o comportamento antigo; 2d lista
TODOS os pontos do arquivo que precisam de `sectorId: 'sector-dev-produto'` acrescentado ao
payload (o mesmo valor que o fallback antigo usava, então o resto da asserção de cada teste não
muda).

- [ ] **Step 1a: Escrever o teste que falha — `companyId` do usuário criado bate com o do ator**

Em `apps/api/src/routes/admin.test.ts`, dentro do describe `'admin routes'`, logo após o teste
`'creates a developer (POST /admin/users)'` (linha ~629), adicione:

```ts
  it('usuário criado herda o companyId do ator (não cai em company-emr fixo)', async () => {
    const app = buildApp()
    await app.ready()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Criar Usuario', slug: 'outra-empresa-criar-usuario-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Criar Usuario', slug: 'setor-outra-empresa-criar-usuario-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const token = await adminTokenForCompany(app, otherCompany.id, otherSector.id)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Nova Dev Outra Empresa', email: 'nova-dev-outra-empresa@x.com', password: 'changeme123', sectorId: otherSector.id },
    })
    expect(res.statusCode).toBe(201)
    const created = await prisma.user.findUniqueOrThrow({ where: { id: res.json().user.id } })
    expect(created.companyId).toBe(otherCompany.id)
    await app.close()
  })

  it('rejeita sectorId de outra empresa em POST /admin/users (400, mensagem genérica)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Setor Invalido', slug: 'outra-empresa-setor-invalido-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor De Outra Empresa', slug: 'setor-de-outra-empresa-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Invasor', email: 'invasor-setor@x.com', password: 'changeme123', sectorId: otherSector.id },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Setor inválido.')
    await app.close()
  })

  it('ADMIN sem sectorId no body recebe 400 pedindo o setor (sem cair no default fixo da EMR)', async () => {
    const app = buildApp()
    await app.ready()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Sem Setor', slug: 'outra-empresa-sem-setor-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Sem Setor', slug: 'setor-outra-empresa-sem-setor-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const token = await adminTokenForCompany(app, otherCompany.id, otherSector.id)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Sem Setor', email: 'sem-setor@x.com', password: 'changeme123' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Especifique o setor.')
    // e garante que NÃO criou o usuário no setor default da EMR por engano
    expect(await prisma.user.findUnique({ where: { email: 'sem-setor@x.com' } })).toBeNull()
    await app.close()
  })
```

- [ ] **Step 2: Confirmar que os 3 testes falham**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "companyId do ator|sectorId de outra empresa|sem sectorId no body"
```
Expected: 3 failures — o primeiro porque `created.companyId` ainda é `company-emr`; o segundo
porque `prisma.sector.findUnique` cru enxerga o setor de outra empresa (o 400 viria por outro
motivo hoje, ou passaria — dependendo da implementação atual; o ponto é que o comportamento não é
o esperado); o terceiro porque hoje cai silenciosamente em `DEFAULT_SECTOR_ID` e retorna 201.

- [ ] **Step 2b: Confirmar especificamente a falha do 3º teste antes de mexer no código**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "sem sectorId no body"
```
Expected: `expect(res.statusCode).toBe(400)` falha porque o statusCode recebido é `201`.

- [ ] **Step 2c: Reescrever o teste pré-existente cuja premissa é o comportamento antigo**

Em `apps/api/src/routes/admin.test.ts`, no describe `'sectorId em /admin/users'` (linha ~1720),
o teste `'cria lenda sem sectorId (cai no setor default) e com sectorId explícito'` afirma
exatamente o comportamento que este fix reverte. Substitua o teste inteiro por:

```ts
  it('rejeita POST /admin/users sem sectorId (400) e aceita com sectorId explícito', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const noSector = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Sem Setor', email: 'semsetor@empresa.com', password: 'changeme123' },
    })
    expect(noSector.statusCode).toBe(400)
    expect(noSector.json().message).toBe('Especifique o setor.')

    const sectorRes = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Comercial', enabledFeatures: [], roles: ['LEGEND'] },
    })
    const sectorId = sectorRes.json().sector.id

    const withSector = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Com Setor', email: 'comsetor@empresa.com', password: 'changeme123', sectorId },
    })
    expect(withSector.statusCode).toBe(201)
    expect(withSector.json().user.sectorId).toBe(sectorId)
    await app.close()
  })
```

- [ ] **Step 2d: Acrescentar `sectorId: 'sector-dev-produto'` a todo `POST /admin/users` via `adminToken(app)` que hoje não informa `sectorId`**

Esses testes hoje passam graças ao fallback pro `DEFAULT_SECTOR_ID` que este fix remove — sem essa
mudança, eles vão passar a receber `400` em vez do `201`/comportamento esperado que testam. Em
`apps/api/src/routes/admin.test.ts`, acrescente `sectorId: 'sector-dev-produto'` ao `payload` de
cada `POST /admin/users` abaixo (mesmo valor que o fallback antigo usava — nenhuma outra asserção
do teste muda):

- `'creates a developer (POST /admin/users)'` (linha ~614): payload vira
  `{ name: 'Nova Dev', email: 'nova@empresa.com', password: 'changeme123', position: 'Backend', squad: 'Core', sectorId: 'sector-dev-produto' }`.
- `'creates a developer with an explicit role (POST /admin/users)'` (linha ~631): payload vira
  `{ name: 'Nova Head', email: 'head@empresa.com', password: 'changeme123', role: 'HEAD', sectorId: 'sector-dev-produto' }`.
- `'creates and edits a user area (POST/PATCH /admin/users)'` (linha ~646): payload do `POST` vira
  `{ name: 'Eng Dev', email: 'engdev@empresa.com', password: 'changeme123', area: 'ENGINEERING', sectorId: 'sector-dev-produto' }`.
- `'rejects a duplicate developer email (409)'` (linha ~680): a variável `payload` compartilhada
  vira `{ name: 'Dup', email: 'dup@empresa.com', password: 'changeme123', sectorId: 'sector-dev-produto' }`.
- `'admin cria e edita teamsWebhookUrl e ele aparece no DTO admin'` (linha ~1451): payload do
  `POST` ganha `sectorId: 'sector-dev-produto'` junto dos campos já existentes.
- `'desliga um colaborador setando leftAt e o readmite limpando'` (linha ~1504): payload vira
  `{ name: 'Ex Lenda', email: 'ex@empresa.com', password: 'changeme123', sectorId: 'sector-dev-produto' }`.
- `'move usuário de setor via PATCH e revalida o papel no setor novo'` (linha ~1774, dentro do
  describe `'sectorId em /admin/users'`): payload do `POST` inicial vira
  `{ name: 'Movida', email: 'movida@empresa.com', password: 'changeme123', role: 'HEAD', sectorId: 'sector-dev-produto' }`.
- `'audita criação e edição de usuário'` (linha ~1905): payload vira
  `{ name: 'Auditada', email: 'auditada@empresa.com', password: 'changeme123', sectorId: 'sector-dev-produto' }`.

Confira que não sobrou nenhum outro `POST /admin/users` via `adminToken(app)` sem `sectorId`:
```bash
grep -n "url: '/admin/users'" apps/api/src/routes/admin.test.ts
```
e para cada ocorrência com `method: 'POST'`, confirme visualmente que o `payload` tem `sectorId`
OU que o token usado é de `subadminToken`/`adminTokenForCompany` (que não passam por este branch
da validação, ou já informam `sectorId` explicitamente).

- [ ] **Step 3: Implementar — `apps/api/src/routes/admin.ts`, handler `POST /admin/users`**

Troque o bloco (linhas 369-410 no estado lido) inteiro por:

```ts
  app.post('/admin/users', adminOrSubadmin, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const isSubadmin = request.user.role === 'SUBADMIN'
    if (isSubadmin && (parsed.data.role === 'ADMIN' || parsed.data.role === 'SUBADMIN')) {
      return reply.code(400).send({ message: 'Subadmin não pode criar contas Admin ou Subadmin.' })
    }
    let sectorId: string
    if (isSubadmin) {
      sectorId = request.user.sectorId
    } else {
      if (!parsed.data.sectorId) {
        return reply.code(400).send({ message: 'Especifique o setor.' })
      }
      sectorId = parsed.data.sectorId
    }
    const effectiveRole = parsed.data.role ?? 'LEGEND'
    const sector = await scopedPrisma(request.user.companyId).sector.findUnique({ where: { id: sectorId }, include: { roles: true } })
    if (!sector) return reply.code(400).send({ message: 'Setor inválido.' })
    if (!MANAGEMENT_ROLES.has(effectiveRole) && !sector.roles.some((r) => r.role === effectiveRole)) {
      return reply.code(400).send({ message: 'Esse papel não está habilitado para o setor selecionado.' })
    }
    try {
      const passwordHash = await hashPassword(parsed.data.password)
      const user = await prisma.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          position: parsed.data.position,
          squad: parsed.data.squad,
          joinedAt: parsed.data.joinedAt,
          role: parsed.data.role,
          area: parsed.data.area,
          teamsWebhookUrl: parsed.data.teamsWebhookUrl || null,
          sectorId,
          companyId: request.user.companyId,
        },
      })
      const { passwordHash: _omit, ...safeUser } = user
      await recordAuditLog({ actorId: request.user.sub, entityType: 'User', entityId: user.id, action: 'CREATE', after: safeUser })
      return reply.code(201).send({ user: toAdminUser(user) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'E-mail já cadastrado.' })
      }
      throw err
    }
  })
```

Note: `DEFAULT_SECTOR_ID` deixa de ser usado neste handler — se o import ficar sem outros usos em
`admin.ts`, confira com `grep -n "DEFAULT_SECTOR_ID" apps/api/src/routes/admin.ts` antes de
remover do import (é usado também em `POST /admin/periods`, então o import continua necessário —
não remova).

- [ ] **Step 4: Confirmar que os 3 novos testes passam, e que os testes existentes de `POST /admin/users` continuam passando**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts
```
Expected: todos os testes do arquivo passam, incluindo os 3 novos e os já existentes (ex.:
`'Subadmin só vê/cria/edita lendas do próprio setor'`, que não informa `sectorId` mas é
`SUBADMIN` — continua funcionando porque o `isSubadmin` branch não exige `sectorId` no body).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "fix: POST /admin/users usa companyId do ator e valida sectorId por empresa"
```

---

### Task 2: Squads — `updateSquad`, `addMember`, `removeMember` recebem `companyId` do ator

**Files:**
- Modify: `apps/api/src/services/squad-service.ts` (`updateSquad`, `addMember`, `removeMember`).
- Modify: `apps/api/src/services/squad-service.test.ts` (todas as chamadas às 3 funções acima
  ganham um novo argumento `companyId`).
- Modify: `apps/api/src/routes/admin.ts` (handlers `PATCH /admin/squads/:id`,
  `POST /admin/squads/:id/members`, `DELETE /admin/squads/:id/members/:userId` — trocar
  `prisma.squad.findUnique` cru por `scopedPrisma(request.user.companyId)` e passar `companyId`
  para o service).
- Modify: `apps/api/src/routes/admin.test.ts` (novo teste de escopo por empresa para squads).

**Interfaces:**
- `updateSquad(id: string, input: {...}, actorId: string, companyId: string): Promise<SquadWithMembers>`
  (era `updateSquad(id, input, actorId)`).
- `addMember(squadId: string, userId: string, actorId: string, companyId: string): Promise<SquadWithMembers>`
  (era sem `companyId`).
- `removeMember(squadId: string, userId: string, actorId: string, companyId: string): Promise<void>`
  (era sem `companyId`).

- [ ] **Step 1: Escrever o teste de service que falha — `updateSquad` de outra empresa vira 404**

Em `apps/api/src/services/squad-service.test.ts`, adicione ao final do arquivo (dentro do
`describe` existente, ou em um novo `describe` se o arquivo não tiver um top-level — confira a
estrutura real do arquivo antes de colar):

```ts
describe('squad-service — escopo por empresa', () => {
  it('updateSquad de uma squad de outra empresa rejeita com 404 (companyId do ator)', async () => {
    const admin = await prisma.user.create({ data: { name: 'Admin', email: `admin-squad-scope-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Squad Scope', slug: 'outra-empresa-squad-scope-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Squad Scope', slug: 'setor-outra-empresa-squad-scope-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherSquad = await prisma.squad.create({ data: { name: 'Squad De Outra Empresa', slug: 'squad-de-outra-empresa-scope-test', sectorId: otherSector.id, companyId: otherCompany.id } })

    await expect(updateSquad(otherSquad.id, { name: 'Invasão' }, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
  })

  it('addMember/removeMember em squad de outra empresa rejeita com 404', async () => {
    const admin = await prisma.user.create({ data: { name: 'Admin', email: `admin-squad-scope2-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Squad Scope 2', slug: 'outra-empresa-squad-scope-2-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Squad Scope 2', slug: 'setor-outra-empresa-squad-scope-2-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherSquad = await prisma.squad.create({ data: { name: 'Squad De Outra Empresa 2', slug: 'squad-de-outra-empresa-2-scope-test', sectorId: otherSector.id, companyId: otherCompany.id } })
    const otherDev = await prisma.user.create({ data: { name: 'Dev Outra', email: `dev-outra-squad-scope@x.com`, passwordHash: 'x', sectorId: otherSector.id, companyId: otherCompany.id } })

    await expect(addMember(otherSquad.id, otherDev.id, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
    // removeMember não lança para squad inexistente hoje (deleteMany é no-op); a asserção correta
    // é que a remoção NÃO afeta a squad de outra empresa mesmo se o service for chamado com o
    // companyId errado — cobrimos isso via ausência de efeito colateral:
    await removeMember(otherSquad.id, otherDev.id, admin.id, DEFAULT_COMPANY_ID)
    const stillMember = await prisma.squadMember.findFirst({ where: { squadId: otherSquad.id, userId: otherDev.id } })
    expect(stillMember).not.toBeNull() // membro de outra empresa não foi removido pelo ator errado
  })
})
```

Adicione o import de `DEFAULT_COMPANY_ID` no topo do arquivo:
```ts
import { DEFAULT_COMPANY_ID } from '@legends/shared'
```

- [ ] **Step 2: Confirmar que os 2 novos testes falham (e que os testes já existentes no arquivo também falham por causa da assinatura nova)**

```bash
pnpm --filter @legends/api exec vitest run src/services/squad-service.test.ts
```
Expected: falhas de tipo/assinatura nos testes existentes (TypeScript vai reclamar de argumentos
faltando assim que a Task 2 Step 3 for aplicada) — ANTES do Step 3, o teste novo de escopo por
empresa deve falhar porque `updateSquad`/`addMember` ainda não recebem `companyId` e ainda leem
`prisma.squad.findUnique` sem filtro, então a squad de outra empresa É encontrada e a chamada não
rejeita com 404.

- [ ] **Step 3: Implementar — `apps/api/src/services/squad-service.ts`**

Substitua `updateSquad`, `addMember`, `removeMember` por:

```ts
export async function updateSquad(
  id: string,
  input: { name?: string; active?: boolean; leaderId?: string | null; sectorId?: string },
  actorId: string,
  companyId: string,
): Promise<SquadWithMembers> {
  const before = await scopedPrisma(companyId).squad.findUnique({ where: { id } })
  if (!before) throw new SquadError('Squad não encontrada.', 404)
  const db = scopedPrisma(companyId)
  const data: Prisma.SquadUpdateInput = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new SquadError('O nome da squad é obrigatório.', 400)
    data.name = name
    data.slug = slugify(name)
  }
  if (input.active !== undefined) data.active = input.active
  if (input.leaderId !== undefined) {
    if (input.leaderId === null) {
      data.leader = { disconnect: true }
    } else {
      const leader = await prisma.user.findUnique({ where: { id: input.leaderId } })
      if (!leader || !leader.active || leader.leftAt) throw new SquadError('Líder inválido.', 400)
      const targetSectorId = input.sectorId ?? before.sectorId
      if (leader.sectorId !== targetSectorId) throw new SquadError('Integrante inválido.', 400)
      data.leader = { connect: { id: input.leaderId } }
    }
  }
  if (input.sectorId !== undefined) {
    const sector = await prisma.sector.findUnique({ where: { id: input.sectorId } })
    if (!sector) throw new SquadError('Setor inválido.', 400)
    if (sector.companyId !== before.companyId) throw new SquadError('Não é possível mover a squad para outra empresa.', 400)
    data.sector = { connect: { id: input.sectorId } }
  }
  try {
    const updated = await db.squad.update({ where: { id }, data })
    await recordAuditLog({ actorId, entityType: 'Squad', entityId: id, action: 'UPDATE', before, after: updated })
    return loadSquad(id, before.companyId)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new SquadError('Squad não encontrada.', 404)
      if (err.code === 'P2002') throw new SquadError('Já existe uma squad com esse nome.', 409)
    }
    throw err
  }
}

export async function addMember(squadId: string, userId: string, actorId: string, companyId: string): Promise<SquadWithMembers> {
  const squad = await scopedPrisma(companyId).squad.findUnique({ where: { id: squadId } })
  if (!squad) throw new SquadError('Squad não encontrada.', 404)
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !user.active || user.leftAt) throw new SquadError('Integrante inválido.', 400)
  if (user.role === 'ADMIN' || user.role === 'SUBADMIN') throw new SquadError('Administradores não entram em squads.', 400)
  if (user.sectorId !== squad.sectorId) throw new SquadError('Integrante inválido.', 400)
  try {
    const member = await prisma.squadMember.create({ data: { squadId, userId } })
    await recordAuditLog({ actorId, entityType: 'SquadMember', entityId: member.id, action: 'CREATE', after: member })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new SquadError('Já é integrante desta squad.', 409)
    }
    throw err
  }
  return loadSquad(squadId, squad.companyId)
}

export async function removeMember(squadId: string, userId: string, actorId: string, companyId: string): Promise<void> {
  const squad = await scopedPrisma(companyId).squad.findUnique({ where: { id: squadId } })
  if (!squad) return
  const before = await prisma.squadMember.findFirst({ where: { squadId, userId } })
  await prisma.squadMember.deleteMany({ where: { squadId, userId } })
  if (before) {
    await recordAuditLog({ actorId, entityType: 'SquadMember', entityId: before.id, action: 'DELETE', before })
  }
}
```

Note (`removeMember`): o comportamento antes era "no-op silencioso se não achar membro" — mantemos
esse espírito para squad de outra empresa (retorna sem lançar, mas SEM apagar nada, porque
`scopedPrisma(companyId).squad.findUnique` já não encontra a squad de outra empresa). A rota (Step
5 abaixo) responde `204` de qualquer jeito, igual já fazia.

- [ ] **Step 4: Atualizar as chamadas existentes em `squad-service.test.ts` com o novo parâmetro `companyId`**

Adicione `DEFAULT_COMPANY_ID` como último argumento em TODAS as chamadas a `updateSquad`,
`addMember`, `removeMember` já existentes no arquivo (as listadas na leitura do código real):
linhas (no estado lido) 22, 25, 36, 37, 40, 41, 49, 51, 52, 59, 66, 67, 70, 79, 82, 91, 94, 103,
104, 105, 124. Exemplo de diff (aplique o mesmo padrão às demais):

```ts
    const renamed = await updateSquad(s.id, { name: 'B2B Plus' }, admin.id, DEFAULT_COMPANY_ID)
    const off = await updateSquad(s.id, { active: false }, admin.id, DEFAULT_COMPANY_ID)
```
```ts
    await addMember(s1.id, dev.id, admin.id, DEFAULT_COMPANY_ID)
    const devAfter = await addMember(s2.id, dev.id, admin.id, DEFAULT_COMPANY_ID)
```
```ts
    await removeMember(s.id, dev.id, admin.id, DEFAULT_COMPANY_ID)
```

Garanta que o import `DEFAULT_COMPANY_ID` de `@legends/shared` (adicionado no Step 1) cobre todos
os usos.

- [ ] **Step 5: Implementar — `apps/api/src/routes/admin.ts`, os 3 handlers de squad**

```ts
  app.patch('/admin/squads/:id', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateSquadSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    if (request.user.role === 'SUBADMIN') {
      const existing = await scopedPrisma(request.user.companyId).squad.findUnique({ where: { id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Squad não encontrada.' })
      }
      if (parsed.data.sectorId !== undefined && parsed.data.sectorId !== request.user.sectorId) {
        return reply.code(400).send({ message: 'Subadmin não pode mover uma squad para outro setor.' })
      }
    }
    try {
      const squad = await updateSquad(id, parsed.data, request.user.sub, request.user.companyId)
      return reply.send({ squad: toSquadWithMembersDTO(squad) })
    } catch (err) {
      if (err instanceof SquadError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/admin/squads/:id/members', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = addSquadMemberSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    if (request.user.role === 'SUBADMIN') {
      const existing = await scopedPrisma(request.user.companyId).squad.findUnique({ where: { id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Squad não encontrada.' })
      }
    }
    try {
      const squad = await addMember(id, parsed.data.userId, request.user.sub, request.user.companyId)
      return reply.code(201).send({ squad: toSquadWithMembersDTO(squad) })
    } catch (err) {
      if (err instanceof SquadError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/admin/squads/:id/members/:userId', adminOrSubadmin, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string }
    if (request.user.role === 'SUBADMIN') {
      const existing = await scopedPrisma(request.user.companyId).squad.findUnique({ where: { id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Squad não encontrada.' })
      }
    }
    await removeMember(id, userId, request.user.sub, request.user.companyId)
    return reply.code(204).send()
  })
```

- [ ] **Step 6: Escrever o teste de rota que falha — `PATCH /admin/squads/:id` de outra empresa vira 404 pra ADMIN**

Em `apps/api/src/routes/admin.test.ts`, dentro do describe `'escopo por empresa (companyId real do
token)'` (após o teste de Sector, linha ~2035), adicione:

```ts
  it('ADMIN de uma empresa não edita/adiciona/remove membro de squad de outra empresa', async () => {
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Squad Admin', slug: 'outra-empresa-squad-admin-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Squad Admin', slug: 'setor-outra-empresa-squad-admin-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherSquad = await prisma.squad.create({ data: { name: 'Squad Outra Empresa Admin', slug: 'squad-outra-empresa-admin-test', sectorId: otherSector.id, companyId: otherCompany.id } })
    const otherDev = await prisma.user.create({ data: { name: 'Dev Outra Empresa Squad', email: 'dev-outra-empresa-squad@x.com', passwordHash: 'x', sectorId: otherSector.id, companyId: otherCompany.id } })
    const tokenDefault = await adminToken(app)

    const patch = await app.inject({
      method: 'PATCH',
      url: `/admin/squads/${otherSquad.id}`,
      headers: { authorization: `Bearer ${tokenDefault}` },
      payload: { name: 'Invasão Squad' },
    })
    expect(patch.statusCode).toBe(404)

    const addMemberRes = await app.inject({
      method: 'POST',
      url: `/admin/squads/${otherSquad.id}/members`,
      headers: { authorization: `Bearer ${tokenDefault}` },
      payload: { userId: otherDev.id },
    })
    expect(addMemberRes.statusCode).toBe(404)

    const removeMemberRes = await app.inject({
      method: 'DELETE',
      url: `/admin/squads/${otherSquad.id}/members/${otherDev.id}`,
      headers: { authorization: `Bearer ${tokenDefault}` },
    })
    expect(removeMemberRes.statusCode).toBe(204) // no-op silencioso, igual ao comportamento pré-existente para membro/squad não encontrado

    await app.close()
  })
```

- [ ] **Step 7: Confirmar que tudo passa**

```bash
pnpm --filter @legends/api exec vitest run src/services/squad-service.test.ts src/routes/admin.test.ts
```
Expected: todos os testes passam.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/squad-service.ts apps/api/src/services/squad-service.test.ts apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "fix: squads escopadas pela empresa do ator (ADMIN, não só SUBADMIN)"
```

---

### Task 3: Períodos de votação + as 4 sub-rotas de highlight

**Files:**
- Modify: `apps/api/src/services/admin-service.ts` (`updateVotingPeriod`, `closeVotingPeriod`).
- Modify: `apps/api/src/services/admin-service.test.ts` (chamadas existentes ganham `companyId`).
- Modify: `apps/api/src/services/highlight-service.ts` (`generateHighlightDraft`,
  `updateHighlightText`, `generateHighlightImage`, `publishHighlight`).
- Modify: `apps/api/src/services/highlight-service.orchestration.test.ts` (chamadas existentes
  ganham `companyId`).
- Modify: `apps/api/src/routes/admin.ts` (handlers `PATCH /admin/periods/:id`,
  `POST /admin/periods/:id/close`, `POST /admin/periods/:id/highlight`,
  `PATCH /admin/periods/:id/highlight`, `POST /admin/periods/:id/highlight/image`,
  `POST /admin/periods/:id/highlight/publish`).
- Modify: `apps/api/src/routes/admin.test.ts` (novo teste de escopo por empresa para período +
  highlight; novo teste em `escopo por empresa (companyId real do token)`).

**Interfaces:**
- `updateVotingPeriod(id: string, data: { startsAt: Date; endsAt: Date }, actorId: string, companyId: string): Promise<VotingPeriod>`
  (era sem `companyId`).
- `closeVotingPeriod(id: string, actorId: string, companyId: string): Promise<VotingPeriod>` (era
  sem `companyId`).
- `generateHighlightDraft(periodId: string, actorId: string, companyId: string): Promise<VotingPeriod>`
  (era sem `companyId`).
- `updateHighlightText(periodId: string, text: string, actorId: string, companyId: string, highlightMonthRef?: string): Promise<VotingPeriod>`
  (era `updateHighlightText(periodId, text, actorId, highlightMonthRef?)` — `companyId` entra
  ANTES do parâmetro opcional `highlightMonthRef`, senão vira ambíguo passar só `highlightMonthRef`
  sem `companyId`).
- `generateHighlightImage(periodId: string, actorId: string, companyId: string): Promise<VotingPeriod>`
  (era sem `companyId`).
- `publishHighlight(periodId: string, actorId: string, companyId: string): Promise<VotingPeriod>`
  (era sem `companyId`).
- `scheduleVotingPeriod` e `electWinner`/`listPublishedHighlights` **não mudam** — já recebem
  `companyId` corretamente (`scheduleVotingPeriod` deriva de `sector.companyId`, que já é
  implicitamente o do ator porque o setor foi validado contra a empresa do ator na rota — ver nota
  abaixo).

Nota sobre `POST /admin/periods` (`scheduleVotingPeriod`): a spec NÃO lista essa rota entre as
afetadas (ela já busca o setor com `prisma.sector.findUniqueOrThrow` cru — um gap possível, mas
fora dos "2 piores" escolhidos para esta fatia; documentado aqui para não ser confundido com um
esquecimento). Não tocar em `scheduleVotingPeriod` nesta task.

- [ ] **Step 1: Escrever o teste de service que falha — `updateVotingPeriod`/`closeVotingPeriod` de outra empresa**

Em `apps/api/src/services/admin-service.test.ts`, adicione ao final do `describe('admin service')`:

```ts
  it('updateVotingPeriod/closeVotingPeriod de um período de outra empresa rejeitam (P2025, tratado como 404 na rota)', async () => {
    const actorId = await createActor()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Periodo', slug: 'outra-empresa-periodo-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Periodo', slug: 'setor-outra-empresa-periodo-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherPeriod = await prisma.votingPeriod.create({
      data: { monthRef: '2026-09', startsAt: new Date(Date.now() + 1000), endsAt: new Date(Date.now() + 100000), status: 'OPEN', sectorId: otherSector.id, companyId: otherCompany.id },
    })

    await expect(
      updateVotingPeriod(otherPeriod.id, { startsAt: new Date(Date.now() + 2000), endsAt: new Date(Date.now() + 200000) }, actorId, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({ code: 'P2025' })
    await expect(closeVotingPeriod(otherPeriod.id, actorId, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ code: 'P2025' })
  })
```

Adicione o import `import { DEFAULT_COMPANY_ID } from '@legends/shared'` (o arquivo já importa
`DEFAULT_SECTOR_ID` do mesmo pacote — só acrescente ao destructuring existente).

- [ ] **Step 2: Confirmar que o teste falha**

```bash
pnpm --filter @legends/api exec vitest run src/services/admin-service.test.ts -t "updateVotingPeriod/closeVotingPeriod"
```
Expected: falha — hoje `prisma.votingPeriod.findUniqueOrThrow` cru ENCONTRA o período de outra
empresa e a chamada NÃO rejeita com P2025 (ela atualiza/fecha com sucesso).

- [ ] **Step 3: Implementar — `apps/api/src/services/admin-service.ts`**

```ts
export async function updateVotingPeriod(
  id: string,
  data: { startsAt: Date; endsAt: Date },
  actorId: string,
  companyId: string,
): Promise<VotingPeriod> {
  const db = scopedPrisma(companyId)
  const before = await db.votingPeriod.findUniqueOrThrow({ where: { id } })
  const updated = await db.votingPeriod.update({ where: { id }, data: { ...data, status: 'OPEN' } })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: id, action: 'UPDATE', before, after: updated })
  return updated
}

export async function closeVotingPeriod(id: string, actorId: string, companyId: string): Promise<VotingPeriod> {
  const db = scopedPrisma(companyId)
  const before = await db.votingPeriod.findUniqueOrThrow({ where: { id } })
  const updated = await db.votingPeriod.update({ where: { id }, data: { status: 'CLOSED' } })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: id, action: 'UPDATE', before, after: updated })
  return updated
}
```

`prisma` (import cru) deixa de ser usado por essas duas funções, mas `scheduleVotingPeriod` ainda
usa `prisma.sector.findUniqueOrThrow` — não remova o import `prisma` do arquivo.

- [ ] **Step 4: Atualizar as chamadas existentes em `admin-service.test.ts`**

Em TODAS as chamadas existentes a `updateVotingPeriod`/`closeVotingPeriod` (linhas 54-55, 78, 88,
89, no estado lido), acrescente `DEFAULT_COMPANY_ID` como último argumento:

```ts
    await closeVotingPeriod(period.id, actorId, DEFAULT_COMPANY_ID)
    const updated = await updateVotingPeriod(
      period.id,
      { startsAt: new Date(...), endsAt: new Date(...) },
      actorId,
      DEFAULT_COMPANY_ID,
    )
```
(e o mesmo padrão nas linhas 78, 88, 89.)

- [ ] **Step 5: Rodar o service de período isolado, confirmar que passa**

```bash
pnpm --filter @legends/api exec vitest run src/services/admin-service.test.ts
```
Expected: todos os testes passam.

- [ ] **Step 6: Escrever o teste de service que falha — as 4 funções de highlight de outra empresa**

Em `apps/api/src/services/highlight-service.orchestration.test.ts`, adicione ao final:

```ts
describe('highlight-service — escopo por empresa', () => {
  it('generateHighlightDraft/updateHighlightText/generateHighlightImage/publishHighlight rejeitam período de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Highlight Scope', slug: 'outra-empresa-highlight-scope-test' } })
    const otherSector = await prisma.sector.create({ data: { name: 'Setor Outra Empresa Highlight Scope', slug: 'setor-outra-empresa-highlight-scope-test', companyId: otherCompany.id } })
    const category = await prisma.category.create({ data: { name: 'Cat Highlight Scope', slug: 'cat-highlight-scope-test' } })
    const ana = await prisma.user.create({ data: { name: 'Ana Outra', email: 'ana-outra-highlight-scope@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id } })
    const voter = await prisma.user.create({ data: { name: 'Voter Outra', email: 'voter-outra-highlight-scope@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id } })
    const period = await prisma.votingPeriod.create({
      data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30'), status: 'CLOSED', companyId: otherCompany.id, sectorId: otherSector.id },
    })
    await prisma.vote.create({
      data: { voterId: voter.id, votedId: ana.id, periodId: period.id, justification: 'ótimo trabalho', companyId: otherCompany.id, categories: { create: [{ categoryId: category.id }] } },
    })
    await prisma.badge.create({ data: { slug: 'destaque-do-mes', name: 'Destaque do Mês', description: 'x', kind: 'HIGHLIGHT', iconKey: 'trophy', threshold: 0 } })
    const actor = await prisma.user.create({ data: { name: 'Actor Default', email: `actor-default-highlight-scope-${Date.now()}@e.com`, passwordHash: 'x', role: 'ADMIN' } })

    await expect(generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toBeInstanceOf(HighlightError)
  })
})
```

Adicione o import `import { DEFAULT_COMPANY_ID } from '@legends/shared'` no topo do arquivo.

Nota: só `generateHighlightDraft` precisa de um teste próprio aqui porque `updateHighlightText`/
`generateHighlightImage`/`publishHighlight` já exigem o período estar em `DRAFT`/etc — como
`generateHighlightDraft` já rejeita corretamente após o fix (o período nem existe no escopo do
ator), as outras 3 seguem o mesmo padrão de implementação (`scopedPrisma(companyId)` pra achar o
`before`) e uma cobertura direta redundaria; a Task 6 (verificação final, suíte completa) garante
que nada quebrou.

- [ ] **Step 7: Confirmar que o teste falha**

```bash
pnpm --filter @legends/api exec vitest run src/services/highlight-service.orchestration.test.ts -t "escopo por empresa"
```
Expected: falha — `generateHighlightDraft` hoje acha o período de outra empresa via
`prisma.votingPeriod.findUnique` cru e gera o draft normalmente, não lançando `HighlightError`.

- [ ] **Step 8: Implementar — `apps/api/src/services/highlight-service.ts`**

Substitua as 4 funções por:

```ts
export async function generateHighlightDraft(periodId: string, actorId: string, companyId: string): Promise<VotingPeriod> {
  const db = scopedPrisma(companyId)
  const before = await db.votingPeriod.findUnique({ where: { id: periodId } })
  if (!before) throw new HighlightError('Período não encontrado.', 404)
  if (before.highlightStatus !== 'NONE') {
    throw new HighlightError('O destaque deste período já foi gerado.', 409)
  }

  const election = await electWinner(periodId, companyId)
  if (!election) throw new HighlightError('Não há votos neste período para apurar o destaque.', 422)

  const winner = await db.user.findUniqueOrThrow({ where: { id: election.winnerId } })

  const votes = await db.vote.findMany({
    where: { periodId, votedId: winner.id },
    select: { justification: true },
    orderBy: { createdAt: 'asc' },
  })
  const justifications = votes.map((v) => v.justification)
  const highlightMonthRef = highlightMonthRefOf(before)

  const text = await buildCongratsText({
    winnerName: winner.name,
    monthLabel: monthLabel(highlightMonthRef),
    justifications,
  })

  const after = await db.votingPeriod.update({
    where: { id: periodId },
    data: {
      winnerId: winner.id,
      winnerVotes: election.winnerVotes,
      highlightMonthRef,
      highlightText: text,
      highlightImagePath: null,
      highlightStatus: 'DRAFT',
    },
  })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: periodId, action: 'UPDATE', before, after })
  return after
}

/** Edita o mês/texto do destaque em DRAFT (sem Gemini e sem re-renderizar a imagem). */
export async function updateHighlightText(
  periodId: string,
  text: string,
  actorId: string,
  companyId: string,
  highlightMonthRef?: string,
): Promise<VotingPeriod> {
  const db = scopedPrisma(companyId)
  const before = await db.votingPeriod.findUnique({ where: { id: periodId } })
  if (!before) throw new HighlightError('Período não encontrado.', 404)
  if (before.highlightStatus !== 'DRAFT') {
    throw new HighlightError('Só é possível editar um destaque em rascunho.', 409)
  }
  const effectiveMonthRef = highlightMonthRef ?? highlightMonthRefOf(before)

  const after = await db.votingPeriod.update({
    where: { id: periodId },
    data: { highlightMonthRef: effectiveMonthRef, highlightText: text, highlightImagePath: null },
  })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: periodId, action: 'UPDATE', before, after })
  return after
}

/** Renderiza/atualiza a imagem do destaque em DRAFT, sem publicar. */
export async function generateHighlightImage(periodId: string, actorId: string, companyId: string): Promise<VotingPeriod> {
  const db = scopedPrisma(companyId)
  const before = await db.votingPeriod.findUnique({ where: { id: periodId } })
  if (!before) throw new HighlightError('Período não encontrado.', 404)
  if (before.highlightStatus !== 'DRAFT') {
    throw new HighlightError('Só é possível gerar a imagem de um destaque em rascunho.', 409)
  }
  if (!before.winnerId || !before.highlightText) {
    throw new HighlightError('Gere o destaque e revise o texto antes de gerar a imagem.', 409)
  }
  const winner = await db.user.findUniqueOrThrow({ where: { id: before.winnerId } })

  const png = await renderCard({
    name: winner.name,
    monthName: monthName(highlightMonthRefOf(before)),
    position: winner.position,
    text: before.highlightText,
    photoDataUri: photoDataUriFor(winner.email),
    initials: initialsOf(winner.name),
  })
  const imagePath = await saveCardPng(highlightMonthRefOf(before), png)

  const after = await db.votingPeriod.update({
    where: { id: periodId },
    data: { highlightImagePath: imagePath },
  })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: periodId, action: 'UPDATE', before, after })
  return after
}

/** Publica o destaque (DRAFT → PUBLISHED) e concede o selo ao vencedor. */
export async function publishHighlight(periodId: string, actorId: string, companyId: string): Promise<VotingPeriod> {
  const db = scopedPrisma(companyId)
  const before = await db.votingPeriod.findUnique({ where: { id: periodId } })
  if (!before) throw new HighlightError('Período não encontrado.', 404)
  if (before.highlightStatus !== 'DRAFT') {
    throw new HighlightError('Só é possível publicar um destaque em rascunho.', 409)
  }
  if (!before.highlightImagePath) {
    throw new HighlightError('Gere a imagem do destaque antes de publicar.', 409)
  }
  const badge = await db.badge.findUnique({ where: { slug: 'destaque-do-mes' } })
  if (!badge) throw new HighlightError('Selo "destaque-do-mes" não encontrado (rode o seed).', 500)

  const updated = await db.$transaction(async (tx) => {
    const period = await tx.votingPeriod.update({ where: { id: periodId }, data: { highlightStatus: 'PUBLISHED' } })
    const existingBadge = await tx.userBadge.findUnique({
      where: { userId_badgeId_periodId: { userId: before.winnerId!, badgeId: badge.id, periodId } },
    })
    if (!existingBadge) {
      await tx.userBadge.create({ data: { userId: before.winnerId!, badgeId: badge.id, periodId } })
    }
    await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: periodId, action: 'UPDATE', before, after: period, tx: tx as unknown as Prisma.TransactionClient })
    return period
  })
  return updated
}
```

Note: `prisma` (import cru) deixa de ser usado dentro dessas 4 funções, mas continua usado em
`electWinner`/`listPublishedHighlights` (que já recebem `companyId` corretamente) — não remova o
import do arquivo.

- [ ] **Step 9: Atualizar as chamadas existentes em `highlight-service.orchestration.test.ts`**

Adicione `DEFAULT_COMPANY_ID` como argumento nas chamadas existentes (respeitando a nova ordem:
`companyId` antes de `highlightMonthRef` em `updateHighlightText`):

```ts
    const result = await generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)
    // ...
    await expect(generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toBeInstanceOf(HighlightError)
    // ...
    await expect(generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 422 })
    // ...
    const updated = await updateHighlightText(period.id, 'Texto editado pelo admin', actor.id, DEFAULT_COMPANY_ID)
    // ...
    const updated2 = await updateHighlightText(period.id, 'Texto editado pelo admin', actor.id, DEFAULT_COMPANY_ID, '2026-05')
    // ...
    await expect(updateHighlightText(period.id, 'x', actor.id, DEFAULT_COMPANY_ID)).rejects.toBeInstanceOf(HighlightError)
    // ...
    const updated3 = await generateHighlightImage(period.id, actor.id, DEFAULT_COMPANY_ID)
    // ...
    await expect(generateHighlightImage(period.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toBeInstanceOf(HighlightError)
    // ...
    const published = await publishHighlight(period.id, actor.id, DEFAULT_COMPANY_ID)
    // ...
    await expect(publishHighlight(period.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toBeInstanceOf(HighlightError)
    // ...
    await expect(publishHighlight(period.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 409 })
```

Aplique o mesmo padrão a TODAS as ocorrências das 4 funções no arquivo (confira com
`grep -n "generateHighlightDraft(\|updateHighlightText(\|generateHighlightImage(\|publishHighlight("
apps/api/src/services/highlight-service.orchestration.test.ts` antes e depois da edição, pra não
deixar nenhuma chamada com a assinatura antiga). Adicione o import
`import { DEFAULT_COMPANY_ID } from '@legends/shared'` no topo do arquivo.

- [ ] **Step 10: Confirmar que o service passa**

```bash
pnpm --filter @legends/api exec vitest run src/services/highlight-service.orchestration.test.ts src/services/highlight-service.test.ts
```
Expected: todos os testes passam.

- [ ] **Step 11: Implementar — `apps/api/src/routes/admin.ts`, os 6 handlers de período/highlight**

```ts
  app.patch('/admin/periods/:id', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = periodWindowSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos (use startsAt e endsAt)' })
    }
    const existing = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ message: 'Período não encontrado' })
    if (request.user.role === 'SUBADMIN' && existing.sectorId !== request.user.sectorId) {
      return reply.code(404).send({ message: 'Período não encontrado' })
    }
    if (!isPeriodEditable(existing.monthRef, new Date())) {
      return reply.code(409).send({ message: 'Não é possível editar um período de um mês que já passou.' })
    }
    const { startsAt, endsAt } = parsed.data
    const invalid = windowError(startsAt, endsAt)
    if (invalid) return reply.code(400).send({ message: invalid })
    const period = await updateVotingPeriod(id, { startsAt, endsAt }, request.user.sub, request.user.companyId)
    return reply.send({ period: toPeriodDTO(period) })
  })

  app.post('/admin/periods/:id/close', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (request.user.role === 'SUBADMIN') {
      const existing = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
    }
    try {
      const period = await closeVotingPeriod(id, request.user.sub, request.user.companyId)
      try {
        await notifyPeriodClosed({ monthRef: period.monthRef, sectorId: period.sectorId, companyId: period.companyId })
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      return reply.send({ period: toPeriodDTO(period) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
      throw err
    }
  })
```

Note: em `PATCH /admin/periods/:id` a busca de `existing` já precisa acontecer ANTES de chamar
`updateVotingPeriod` (pra checar `isPeriodEditable` e o `sectorId` do `SUBADMIN`), então o service
faz uma segunda busca interna com `scopedPrisma` — pequena duplicação aceitável (mesmo padrão já
usado em `PATCH /admin/sectors/:id` → `updateSector`, que também recarrega o `before` dentro do
service depois da rota já ter buscado por outro motivo).

```ts
  app.post('/admin/periods/:id/highlight', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (request.user.role === 'SUBADMIN') {
      const period = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
      if (!period || period.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
    }
    try {
      const period = await generateHighlightDraft(id, request.user.sub, request.user.companyId)
      return reply.code(201).send({ highlight: toHighlightDTO({ period, winner: period.winnerId ? await prisma.user.findUnique({ where: { id: period.winnerId } }) : null }) })
    } catch (err) {
      return sendHighlightError(reply, err)
    }
  })

  app.patch('/admin/periods/:id/highlight', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (request.user.role === 'SUBADMIN') {
      const period = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
      if (!period || period.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
    }
    const parsed = highlightTextSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Texto inválido (1 a 600 caracteres).' })
    try {
      const period = await updateHighlightText(id, parsed.data.text, request.user.sub, request.user.companyId, parsed.data.highlightMonthRef)
      return reply.send({ highlight: toHighlightDTO({ period, winner: period.winnerId ? await prisma.user.findUnique({ where: { id: period.winnerId } }) : null }) })
    } catch (err) {
      return sendHighlightError(reply, err)
    }
  })

  app.post('/admin/periods/:id/highlight/image', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (request.user.role === 'SUBADMIN') {
      const period = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
      if (!period || period.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
    }
    try {
      const period = await generateHighlightImage(id, request.user.sub, request.user.companyId)
      return reply.send({ highlight: toHighlightDTO({ period, winner: period.winnerId ? await prisma.user.findUnique({ where: { id: period.winnerId } }) : null }) })
    } catch (err) {
      return sendHighlightError(reply, err)
    }
  })

  app.post('/admin/periods/:id/highlight/publish', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (request.user.role === 'SUBADMIN') {
      const period = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
      if (!period || period.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
    }
    try {
      const period = await publishHighlight(id, request.user.sub, request.user.companyId)
      return reply.send({ highlight: toHighlightDTO({ period, winner: period.winnerId ? await prisma.user.findUnique({ where: { id: period.winnerId } }) : null }) })
    } catch (err) {
      return sendHighlightError(reply, err)
    }
  })
```

Também troque, no handler de leitura `GET /admin/periods/:id/highlight` (que não muda estado mas
já lê cru), o `prisma.votingPeriod.findUnique` por `scopedPrisma(request.user.companyId)` — por
consistência e para o teste de escopo abaixo cobrir leitura também:

```ts
  app.get('/admin/periods/:id/highlight', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const period = await scopedPrisma(request.user.companyId).votingPeriod.findUnique({ where: { id } })
    if (!period) return reply.code(404).send({ message: 'Período não encontrado' })
    if (request.user.role === 'SUBADMIN' && period.sectorId !== request.user.sectorId) {
      return reply.code(404).send({ message: 'Período não encontrado' })
    }
    const winner = period.winnerId ? await prisma.user.findUnique({ where: { id: period.winnerId } }) : null
    return reply.send({ highlight: toHighlightDTO({ period, winner }) })
  })
```

- [ ] **Step 12: Escrever o teste de rota que falha — escopo por empresa pra período/highlight**

Em `apps/api/src/routes/admin.test.ts`, dentro do describe `'escopo por empresa (companyId real do
token)'`:

```ts
  it('ADMIN de uma empresa não edita/fecha/gera destaque de período de outra empresa', async () => {
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Periodo Admin', slug: 'outra-empresa-periodo-admin-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Periodo Admin', slug: 'setor-outra-empresa-periodo-admin-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherPeriod = await prisma.votingPeriod.create({
      data: { monthRef: '2026-11', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 2 * 86400000), status: 'OPEN', sectorId: otherSector.id, companyId: otherCompany.id },
    })
    const tokenDefault = await adminToken(app)

    const patch = await app.inject({
      method: 'PATCH',
      url: `/admin/periods/${otherPeriod.id}`,
      headers: { authorization: `Bearer ${tokenDefault}` },
      payload: { startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 3 * 86400000).toISOString() },
    })
    expect(patch.statusCode).toBe(404)

    const close = await app.inject({ method: 'POST', url: `/admin/periods/${otherPeriod.id}/close`, headers: { authorization: `Bearer ${tokenDefault}` } })
    expect(close.statusCode).toBe(404)

    const draft = await app.inject({ method: 'POST', url: `/admin/periods/${otherPeriod.id}/highlight`, headers: { authorization: `Bearer ${tokenDefault}` } })
    expect(draft.statusCode).toBe(404)

    const getHighlight = await app.inject({ method: 'GET', url: `/admin/periods/${otherPeriod.id}/highlight`, headers: { authorization: `Bearer ${tokenDefault}` } })
    expect(getHighlight.statusCode).toBe(404)

    await app.close()
  })
```

- [ ] **Step 13: Confirmar que os 2 novos testes falham antes da implementação, e passam depois**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts
```
Expected (antes do Step 11): 404 esperado falha porque hoje `prisma.votingPeriod.findUnique` cru
enxerga o período de outra empresa e o `ADMIN` (sem checagem de `sectorId`) segue em frente.
Depois do Step 11 aplicado: todos os testes do arquivo passam.

- [ ] **Step 14: Rodar tudo desta task**

```bash
pnpm --filter @legends/api exec vitest run src/services/admin-service.test.ts src/services/highlight-service.test.ts src/services/highlight-service.orchestration.test.ts src/routes/admin.ts src/routes/admin.test.ts src/routes/admin.highlight.test.ts
```
Expected: todos os testes passam (inclui `admin.highlight.test.ts`, que não muda mas precisa
continuar verde — ele chama as rotas via HTTP, então a mudança de assinatura dos services é
transparente pra ele).

- [ ] **Step 15: Commit**

```bash
git add apps/api/src/services/admin-service.ts apps/api/src/services/admin-service.test.ts apps/api/src/services/highlight-service.ts apps/api/src/services/highlight-service.orchestration.test.ts apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "fix: períodos de votação e as 4 sub-rotas de highlight escopados pela empresa do ator"
```

---

### Task 4: `DELETE /admin/votes/:id` — escopo pela empresa do ator

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (handlers `GET /admin/votes` e `DELETE /admin/votes/:id`
  — não há service dedicado, ver nota na seção "Decisão de leitura" acima).
- Modify: `apps/api/src/routes/admin.test.ts` (novo teste de escopo por empresa).

**Interfaces:** nenhuma assinatura de service — ajuste inline na rota.

- [ ] **Step 1: Escrever o teste de rota que falha**

Em `apps/api/src/routes/admin.test.ts`, dentro do describe `'escopo por empresa (companyId real do
token)'`:

```ts
  it('ADMIN de uma empresa não vê nem apaga voto de outra empresa (DELETE /admin/votes/:id)', async () => {
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Voto Admin', slug: 'outra-empresa-voto-admin-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Voto Admin', slug: 'setor-outra-empresa-voto-admin-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherVoter = await prisma.user.create({ data: { name: 'Voter Outra Empresa Voto', email: 'voter-outra-empresa-voto@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id } })
    const otherVoted = await prisma.user.create({ data: { name: 'Voted Outra Empresa Voto', email: 'voted-outra-empresa-voto@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id } })
    const otherPeriod = await prisma.votingPeriod.create({
      data: { monthRef: '2026-12', startsAt: new Date('2026-12-01'), endsAt: new Date('2026-12-31'), status: 'OPEN', sectorId: otherSector.id, companyId: otherCompany.id },
    })
    const otherVote = await prisma.vote.create({
      data: { voterId: otherVoter.id, votedId: otherVoted.id, periodId: otherPeriod.id, justification: 'justificativa válida', companyId: otherCompany.id },
    })
    const tokenDefault = await adminToken(app)

    const list = await app.inject({ method: 'GET', url: '/admin/votes', headers: { authorization: `Bearer ${tokenDefault}` } })
    expect(list.json().votes.map((v: { id: string }) => v.id)).not.toContain(otherVote.id)

    const del = await app.inject({ method: 'DELETE', url: `/admin/votes/${otherVote.id}`, headers: { authorization: `Bearer ${tokenDefault}` } })
    expect(del.statusCode).toBe(404)

    await app.close()
  })
```

- [ ] **Step 2: Confirmar que o teste falha**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "não vê nem apaga voto de outra empresa"
```
Expected: falha no `del.statusCode` — hoje `prisma.vote.findUnique` cru acha o voto de outra
empresa (a checagem de escopo hoje só existe pra `SUBADMIN`) e apaga com sucesso (204).

- [ ] **Step 3: Implementar — `apps/api/src/routes/admin.ts`**

```ts
  app.get('/admin/votes', adminOrSubadmin, async (request, reply) => {
    const votes = await scopedPrisma(request.user.companyId).vote.findMany({
      include: voteInclude,
      where: request.user.role === 'SUBADMIN' ? { period: { sectorId: request.user.sectorId } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return reply.send({ votes: votes.map(toVoteDTO) })
  })

  app.delete('/admin/votes/:id', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const before = await scopedPrisma(request.user.companyId).vote.findUnique({ where: { id }, include: { period: true } })
    if (!before) return reply.code(404).send({ message: 'Voto não encontrado' })
    if (request.user.role === 'SUBADMIN' && before.period.sectorId !== request.user.sectorId) {
      return reply.code(404).send({ message: 'Voto não encontrado' })
    }
    try {
      await scopedPrisma(request.user.companyId).vote.delete({ where: { id } })
      await recordAuditLog({ actorId: request.user.sub, entityType: 'Vote', entityId: id, action: 'DELETE', before })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ message: 'Voto não encontrado' })
      }
      throw err
    }
  })
```

Note: `scopedPrisma(companyId).vote.findUnique({ where: { id }, include: { period: true } })` —
confira que `include: { period: true }` continua funcionando por cima da extensão do Prisma Client
(a extensão só intercepta o `where` no nível do model raiz da query, `include` de uma relação não
tenant-scoped como `VotingPeriod.period` não é afetado — `VotingPeriod` também está na allowlist,
mas o filtro por `companyId` da extensão só se aplica à query de nível superior, não a
`include`/`select` aninhados; isso já é o padrão usado em outros pontos do arquivo, ex.
`GET /admin/votes` com `include: voteInclude`).

- [ ] **Step 4: Confirmar que passa**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts
```
Expected: todos os testes passam, incluindo os já existentes
`'deletes a vote for moderation (204), then 404'` e
`'Subadmin só vê/remove votos do período do próprio setor'`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "fix: GET/DELETE /admin/votes escopados pela empresa do ator"
```

---

### Task 5: Revogação de selo manual + revogação de convite terceirizado

**Files:**
- Modify: `apps/api/src/services/badge-service.ts` (`revokeManualBadge`).
- Modify: `apps/api/src/services/badge-service.test.ts` (chamadas existentes ganham `companyId`).
- Modify: `apps/api/src/services/third-party-invite-service.ts` (`revokeThirdPartyInvite`,
  `deleteThirdPartyInvite`).
- Modify: `apps/api/src/services/third-party-invite-service.test.ts` (chamadas existentes ganham
  `companyId`).
- Modify: `apps/api/src/routes/admin.ts` (handler `DELETE /admin/users/:userId/badges/:userBadgeId`).
- Modify: `apps/api/src/routes/third-party-invites.ts` (handlers
  `POST /admin/third-party-invites/:id/revoke`, `DELETE /admin/third-party-invites/:id`).
- Modify: `apps/api/src/routes/admin.test.ts` e
  `apps/api/src/routes/third-party-invites.test.ts` (novos testes de escopo por empresa).

**Interfaces:**
- `revokeManualBadge(userId: string, userBadgeId: string, actorId: string, companyId: string): Promise<void>`
  (era sem `companyId`).
- `revokeThirdPartyInvite(id: string, actorId: string, companyId: string): Promise<void>` (era sem
  `companyId`).
- `deleteThirdPartyInvite(id: string, actorId: string, companyId: string): Promise<void>` (era sem
  `companyId`).

- [ ] **Step 1: Escrever o teste de service que falha — `revokeManualBadge` de usuário de outra empresa**

Em `apps/api/src/services/badge-service.test.ts`, adicione próximo aos testes de
`revokeManualBadge` já existentes (após `'errors when revoking an award that does not belong to
the member (404)'`):

```ts
  it('revokeManualBadge rejeita quando o companyId do ator não bate com o do membro (404)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Revoke Badge', slug: 'outra-empresa-revoke-badge-test' } })
    const otherSector = await prisma.sector.create({ data: { name: 'Setor Outra Empresa Revoke Badge', slug: 'setor-outra-empresa-revoke-badge-test', companyId: otherCompany.id } })
    const member = await prisma.user.create({ data: { name: 'Membro Outra', email: 'membro-outra-revoke-badge@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id } })
    const admin = await makeUser('Admin')
    const badge = await prisma.badge.create({
      data: { slug: 'honra-outra-empresa', name: 'Honra Outra Empresa', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    const awarded = await prisma.userBadge.create({ data: { userId: member.id, badgeId: badge.id, source: 'MANUAL', awardedById: admin.id } })

    await expect(revokeManualBadge(member.id, awarded.id, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
  })
```

Confira se o arquivo já importa `DEFAULT_COMPANY_ID` de `@legends/shared` — se não, adicione.

- [ ] **Step 2: Confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/services/badge-service.test.ts -t "companyId do ator não bate"
```
Expected: falha — hoje `revokeManualBadge` só checa `award.userId !== userId`, não a empresa, e
revoga com sucesso.

- [ ] **Step 3: Implementar — `apps/api/src/services/badge-service.ts`**

```ts
/** Revoga uma concessão MANUAL do membro. Recusa selos automáticos. */
export async function revokeManualBadge(userId: string, userBadgeId: string, actorId: string, companyId: string): Promise<void> {
  const user = await scopedPrisma(companyId).user.findUnique({ where: { id: userId } })
  if (!user) throw new BadgeError('Concessão não encontrada.', 404)
  const award = await prisma.userBadge.findUnique({ where: { id: userBadgeId } })
  if (!award || award.userId !== userId) {
    throw new BadgeError('Concessão não encontrada.', 404)
  }
  if (award.source !== 'MANUAL') {
    throw new BadgeError('Selos automáticos não podem ser revogados manualmente.', 409)
  }
  await prisma.userBadge.delete({ where: { id: userBadgeId } })
  await recordAuditLog({ actorId, entityType: 'UserBadge', entityId: userBadgeId, action: 'DELETE', before: award })
}
```

- [ ] **Step 4: Atualizar as chamadas existentes em `badge-service.test.ts`**

Adicione `DEFAULT_COMPANY_ID` como último argumento em todas as chamadas existentes a
`revokeManualBadge` (linhas 184, 194, 205 no estado lido):

```ts
    await revokeManualBadge(member.id, awarded.id, admin.id, DEFAULT_COMPANY_ID)
    // ...
    await expect(revokeManualBadge(member.id, auto.id, member.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 409 })
    // ...
    await expect(revokeManualBadge(other.id, awarded.id, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
```

- [ ] **Step 5: Implementar — `apps/api/src/routes/admin.ts`, handler de revogação de selo**

```ts
  app.delete('/admin/users/:userId/badges/:userBadgeId', adminOnly, async (request, reply) => {
    const { userId, userBadgeId } = request.params as { userId: string; userBadgeId: string }
    try {
      await revokeManualBadge(userId, userBadgeId, request.user.sub, request.user.companyId)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof BadgeError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 6: Escrever o teste de rota que falha — revogação de selo de usuário de outra empresa**

Em `apps/api/src/routes/admin.test.ts`, dentro do describe `'escopo por empresa (companyId real do
token)'`:

```ts
  it('ADMIN de uma empresa não revoga selo manual de usuário de outra empresa', async () => {
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Revoke Selo Rota', slug: 'outra-empresa-revoke-selo-rota-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Revoke Selo Rota', slug: 'setor-outra-empresa-revoke-selo-rota-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherMember = await prisma.user.create({ data: { name: 'Membro Outra Rota', email: 'membro-outra-revoke-rota@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id } })
    const otherAdmin = await prisma.user.create({ data: { name: 'Admin Outra Rota', email: 'admin-outra-revoke-rota@x.com', passwordHash: 'x', role: 'ADMIN', companyId: otherCompany.id, sectorId: otherSector.id } })
    const badge = await prisma.badge.create({
      data: { slug: 'honra-rota-outra-empresa', name: 'Honra Rota Outra Empresa', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    const awarded = await prisma.userBadge.create({ data: { userId: otherMember.id, badgeId: badge.id, source: 'MANUAL', awardedById: otherAdmin.id } })
    const tokenDefault = await adminToken(app)

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${otherMember.id}/badges/${awarded.id}`,
      headers: { authorization: `Bearer ${tokenDefault}` },
    })
    expect(res.statusCode).toBe(404)

    await app.close()
  })
```

- [ ] **Step 7: Confirmar que passa (badge)**

```bash
pnpm --filter @legends/api exec vitest run src/services/badge-service.test.ts src/routes/admin.test.ts
```
Expected: todos os testes passam.

- [ ] **Step 8: Escrever o teste de service que falha — revogação/exclusão de convite de outra empresa**

Em `apps/api/src/services/third-party-invite-service.test.ts`, adicione:

```ts
  it('revokeThirdPartyInvite/deleteThirdPartyInvite rejeitam quando o companyId do ator não bate com o do convite', async () => {
    const admin = await prisma.user.create({ data: { name: 'AdminOutraInvite', email: `admin-outra-invite-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Revoke Invite', slug: 'outra-empresa-revoke-invite-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Revoke Invite', slug: 'setor-outra-empresa-revoke-invite-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const { invite } = await createThirdPartyInvite(admin.id, 60, [], otherSector.id)
    expect(invite.companyId).toBe(otherCompany.id)

    // ator "de fora" tentando revogar/apagar usando o companyId default (não o da empresa do convite)
    await expect(revokeThirdPartyInvite(invite.id, admin.id, DEFAULT_COMPANY_ID)).resolves.toBeUndefined()
    const stillPending = await prisma.thirdPartyInvite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(stillPending.revokedAt).toBeNull() // no-op: não revogou, porque o convite não existe no escopo do ator

    await expect(deleteThirdPartyInvite(invite.id, admin.id, DEFAULT_COMPANY_ID)).rejects.toThrow(ThirdPartyInviteError)
    const stillExists = await prisma.thirdPartyInvite.findUnique({ where: { id: invite.id } })
    expect(stillExists).not.toBeNull()
  })
```

- [ ] **Step 9: Confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/services/third-party-invite-service.test.ts -t "companyId do ator não bate"
```
Expected: falha — hoje `revokeThirdPartyInvite`/`deleteThirdPartyInvite` buscam com `prisma`
cru, então acham e revogam/apagam o convite de outra empresa mesmo passando `DEFAULT_COMPANY_ID`
(que hoje nem é aceito como parâmetro — erro de tipo assim que a assinatura mudar no Step 10, ou
comportamento incorreto se testado contra a assinatura antiga).

- [ ] **Step 10: Implementar — `apps/api/src/services/third-party-invite-service.ts`**

```ts
export async function revokeThirdPartyInvite(id: string, actorId: string, companyId: string): Promise<void> {
  const db = scopedPrisma(companyId)
  const before = await db.thirdPartyInvite.findUnique({ where: { id } })
  if (!before || before.usedAt || before.revokedAt) return
  const after = await db.thirdPartyInvite.update({ where: { id }, data: { revokedAt: new Date() } })
  await recordAuditLog({ actorId, entityType: 'ThirdPartyInvite', entityId: id, action: 'UPDATE', before, after })
}

export async function deleteThirdPartyInvite(id: string, actorId: string, companyId: string): Promise<void> {
  const db = scopedPrisma(companyId)
  const invite = await db.thirdPartyInvite.findUnique({ where: { id } })
  if (!invite) throw new ThirdPartyInviteError('Convite não encontrado', 404)
  await db.thirdPartyInvite.delete({ where: { id } })
  await recordAuditLog({ actorId, entityType: 'ThirdPartyInvite', entityId: id, action: 'DELETE', before: invite })
}
```

- [ ] **Step 11: Atualizar as chamadas existentes em `third-party-invite-service.test.ts`**

Adicione `DEFAULT_COMPANY_ID` como último argumento em TODAS as chamadas existentes a
`revokeThirdPartyInvite`/`deleteThirdPartyInvite` (linhas 34, 43, 47, 48, 56, 64, 67, 71, 82, 85 no
estado lido). O import `DEFAULT_COMPANY_ID` já existe no topo do arquivo (usado em outro teste) —
confirme com `grep -n "DEFAULT_COMPANY_ID" apps/api/src/services/third-party-invite-service.test.ts`.

Exemplo de diff (aplique o mesmo padrão a todas as ocorrências):
```ts
    await revokeThirdPartyInvite(invite.id, admin.id, DEFAULT_COMPANY_ID)
    // ...
    await deleteThirdPartyInvite(pending.id, admin.id, DEFAULT_COMPANY_ID)
    // ...
    await expect(deleteThirdPartyInvite('inexistente', admin.id, DEFAULT_COMPANY_ID)).rejects.toThrow(ThirdPartyInviteError)
    // ...
    await expect(revokeThirdPartyInvite(invite.id, admin.id, DEFAULT_COMPANY_ID)).resolves.toBeUndefined()
    // ...
    await expect(revokeThirdPartyInvite('inexistente', admin.id, DEFAULT_COMPANY_ID)).resolves.toBeUndefined()
```

- [ ] **Step 12: Confirmar que o service passa**

```bash
pnpm --filter @legends/api exec vitest run src/services/third-party-invite-service.test.ts
```
Expected: todos os testes passam.

- [ ] **Step 13: Implementar — `apps/api/src/routes/third-party-invites.ts`**

```ts
  app.post('/admin/third-party-invites/:id/revoke', adminOrSubadmin, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    if (request.user.role === 'SUBADMIN') {
      const existing = await scopedPrisma(request.user.companyId).thirdPartyInvite.findUnique({ where: { id: parsed.data.id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Convite não encontrado' })
      }
    }
    await revokeThirdPartyInvite(parsed.data.id, request.user.sub, request.user.companyId)
    return reply.code(204).send()
  })

  app.delete('/admin/third-party-invites/:id', adminOrSubadmin, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    if (request.user.role === 'SUBADMIN') {
      const existing = await scopedPrisma(request.user.companyId).thirdPartyInvite.findUnique({ where: { id: parsed.data.id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Convite não encontrado' })
      }
    }
    try {
      await deleteThirdPartyInvite(parsed.data.id, request.user.sub, request.user.companyId)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof ThirdPartyInviteError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })
```

Adicione o import de `scopedPrisma` no topo de `third-party-invites.ts` (o arquivo já importa
`prisma`, mas não `scopedPrisma` — confira e acrescente `import { scopedPrisma } from
'../lib/tenant-scope'`).

Note: com `revokeThirdPartyInvite` agora escopado por `companyId`, o POST `/revoke` de um convite
de outra empresa vira um no-op silencioso que retorna 204 (igual já acontecia para convite
inexistente/já usado) — não um 404. Isso é consistente com o comportamento idempotente já
documentado no service (`revokeThirdPartyInvite` sempre resolve, nunca lança). Já
`DELETE /admin/third-party-invites/:id` lança `ThirdPartyInviteError` 404 quando o convite não
existe no escopo — esse SIM vira 404 visível.

- [ ] **Step 14: Escrever o teste de rota que falha — revoke/delete de convite de outra empresa**

Em `apps/api/src/routes/third-party-invites.test.ts`, adicione ao final do describe
`'third-party invites'`:

```ts
  it('ADMIN de uma empresa não revoga nem apaga convite de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    const adminTokenDefault = await makeToken(app, 'ADMIN')

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Invite Rota', slug: 'outra-empresa-invite-rota-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Invite Rota', slug: 'setor-outra-empresa-invite-rota-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherAdmin = await prisma.user.create({ data: { name: 'Admin Outra Invite', email: `admin-outra-invite-rota-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN', companyId: otherCompany.id, sectorId: otherSector.id } })
    const otherInvite = await prisma.thirdPartyInvite.create({
      data: { tokenHash: 'hash-outra-empresa-invite-rota', createdById: otherAdmin.id, enabledFeatures: [], sectorId: otherSector.id, companyId: otherCompany.id, expiresAt: new Date(Date.now() + 3600_000) },
    })

    const revoke = await app.inject({
      method: 'POST',
      url: `/admin/third-party-invites/${otherInvite.id}/revoke`,
      headers: { authorization: `Bearer ${adminTokenDefault}` },
    })
    expect(revoke.statusCode).toBe(204) // no-op silencioso: convite não existe no escopo do ator

    const stillPending = await prisma.thirdPartyInvite.findUniqueOrThrow({ where: { id: otherInvite.id } })
    expect(stillPending.revokedAt).toBeNull()

    const del = await app.inject({
      method: 'DELETE',
      url: `/admin/third-party-invites/${otherInvite.id}`,
      headers: { authorization: `Bearer ${adminTokenDefault}` },
    })
    expect(del.statusCode).toBe(404)

    await app.close()
  })
```

- [ ] **Step 15: Confirmar que tudo passa**

```bash
pnpm --filter @legends/api exec vitest run src/services/third-party-invite-service.test.ts src/routes/third-party-invites.test.ts src/services/badge-service.test.ts src/routes/admin.test.ts
```
Expected: todos os testes passam.

- [ ] **Step 16: Commit**

```bash
git add apps/api/src/services/badge-service.ts apps/api/src/services/badge-service.test.ts apps/api/src/services/third-party-invite-service.ts apps/api/src/services/third-party-invite-service.test.ts apps/api/src/routes/admin.ts apps/api/src/routes/third-party-invites.ts apps/api/src/routes/admin.test.ts apps/api/src/routes/third-party-invites.test.ts
git commit -m "fix: revogação de selo manual e de convite terceirizado escopadas pela empresa do ator"
```

---

### Task 6: Verificação final

**Files:** nenhum (só comandos).

- [ ] **Step 1: Typecheck da API inteira (pega qualquer chamada de service esquecida com a assinatura antiga)**

```bash
pnpm --filter @legends/api exec tsc --noEmit
```
Expected: sem erros. Se aparecer erro de "Expected N arguments, but got M" em algum arquivo não
listado nas tasks acima, é uma chamada às funções alteradas que passou despercebida — procure com:
```bash
grep -rn "updateSquad(\|addMember(\|removeMember(\|updateVotingPeriod(\|closeVotingPeriod(\|generateHighlightDraft(\|updateHighlightText(\|generateHighlightImage(\|publishHighlight(\|revokeManualBadge(\|revokeThirdPartyInvite(\|deleteThirdPartyInvite(" apps/api/src --include="*.ts"
```
e corrija cada chamada restante com o `companyId` correto antes de prosseguir.

- [ ] **Step 2: Suíte completa da API**

```bash
pnpm db:up
pnpm --filter @legends/api test
```
Expected: todos os testes passam (0 failures).

- [ ] **Step 3: Suíte completa do monorepo (web + shared, garante que nada no contrato quebrou)**

```bash
pnpm test
```
Expected: todos os testes passam em todos os workspaces.

- [ ] **Step 4: Build completo**

```bash
pnpm build
```
Expected: build de `@legends/shared`, `@legends/api` e `@legends/web` sem erros.

- [ ] **Step 5: Commit final (se o Step 1 tiver corrigido algo fora das tasks anteriores)**

```bash
git status
```
Se houver mudanças não commitadas (correções do Step 1), commit:
```bash
git add -A
git commit -m "fix: corrige chamadas remanescentes às assinaturas de service atualizadas"
```

---

## Auto-revisão

**Cobertura da spec** — os 2 gaps da spec (`POST /admin/users` e "ADMIN nunca checado contra
empresa do alvo") viram, respectivamente: Task 1 (companyId + validação de sectorId + fallback
removido) e Tasks 2-5 (squads, período+highlight, votos, badges+convites — as 7 rotas/operações
listadas na seção "Testes" da spec estão todas cobertas: squad update/addMember/removeMember,
período update/close, as 4 sub-rotas de highlight, voto delete, badge revoke, convite
revoke/delete). Os 3 testes específicos de `POST /admin/users` pedidos na spec (companyId correto,
sectorId de outra empresa 400, ADMIN sem sectorId 400) estão na Task 1.

**Scan de placeholders** — nenhum "TBD"/"similar to Task N"/trecho sem código completo; todo bloco
de implementação tem o arquivo inteiro da função afetada, não um diff parcial ambíguo.

**Consistência de tipos entre tasks** — `companyId: string` é sempre o parâmetro que o service
recebe do `request.user.companyId` do ator (nunca do alvo já carregado); em `updateHighlightText`
o `companyId` foi colocado ANTES do parâmetro opcional `highlightMonthRef` (senão a assinatura
ficaria ambígua para chamadas que hoje omitem o opcional). Os testes que chamam as funções
alteradas diretamente (fora de HTTP) foram todos atualizados na mesma task que muda a assinatura —
nenhuma task deixa uma chamada de teste desatualizada para uma task futura consertar. A Task 6
(`tsc --noEmit` + grep) é a rede de segurança para qualquer chamada indireta não coberta
explicitamente (ex.: um outro service/rota fora do escopo desta fatia que porventura chame uma
dessas funções — não identificado na leitura, mas o `tsc` pegaria).

**Ponto de atenção documentado inline:** `scheduleVotingPeriod` (POST /admin/periods) e a leitura
`GET /admin/periods` continuam usando busca crua/sem companyId explícito — fora do escopo desta
fatia por decisão da spec (só os 2 piores gaps). Documentado na Task 3 para não ser confundido com
um esquecimento numa futura auditoria.
