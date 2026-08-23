# Acesso administrativo delegado

**Data:** 2026-08-15
**Status:** aprovado

## Problema

Hoje "poder de admin" e "papel na empresa" são a mesma coisa: quem administra a
plataforma tem `role = ADMIN` (ou `SUBADMIN`). Isso força uma escolha ruim quando
alguém precisa administrar **sem deixar de ser colaborador**:

- Promover a `ADMIN` tira a pessoa do produto. Admin não vota
  (`voting-service.ts:63`), não entra em squad (`squad-service.ts:112`), não
  participa de retrospectiva (`retro-service.ts:154`) nem de 1:1
  (`one-on-one-service.ts:159`), some de `GET /admin/users`
  (`admin.ts:427`) e cai direto em `/admin` ao abrir a home (`App.tsx:201`).
  Um líder de setor promovido a ADMIN perde o time e o próprio perfil.
- `SUBADMIN` não resolve: é admin restrito ao setor **e** também sai do produto
  pelos mesmos checks.

O que falta é ortogonal ao papel: **dar a uma conta específica o acesso ao painel
de administração, sem mexer no que ela é na empresa.**

## Decisão

Um flag por conta — `User.adminAccess` — que concede poder de **ADMIN pleno**
dentro do `/admin`, e **nada mais**. A `role` continua intacta e continua
mandando em tudo que não é administração.

### A distinção que sustenta o desenho

As checagens de `role === 'ADMIN'` espalhadas pelo repo respondem a **duas
perguntas diferentes**, hoje confundidas porque a resposta vinha do mesmo campo:

| Pergunta | Exemplo | `adminAccess` conta? |
|---|---|---|
| **"Pode administrar?"** | `requireAdmin`, moderar feedback, editar post de qualquer autor, publicar mapa do escritório | **Sim** |
| **"É conta de administrador, logo não participa?"** | não vota, não entra em squad, não participa de retro/1:1, não tem férias, não aparece na lista de colaboradores | **Não** |

O segundo grupo continua lendo `role` cru, de propósito. É o que faz o delegado
"continuar vendo o que a role dele permite ver/acessar": ele vota, tem perfil,
entra em retro e aparece no organograma como sempre — e ainda assim abre o
painel.

Há uma exceção deliberada do lado de cá da tabela: **`requireFeature` não olha o
flag**. Ele guarda rota de colaborador (votar, retro, 1:1, desafios), e a feature
diz o que o *setor* da pessoa consome — liberar o delegado ali o faria votar e
participar de dinâmicas que o setor dele tem desligadas, que é a expansão de
identidade que este spec existe para evitar. O custo é conhecido e pequeno:
`DELETE /retro/rooms/:id` combina `requireAdmin` com `requireFeature`, então um
delegado cujo setor não tem `retrospectivas` não apaga sala de retro. Prefere-se
um 403 legível a um privilégio silencioso.

Para o primeiro grupo entra um predicado único em `@legends/shared`:

```ts
canAdminister({ role, adminAccess })   // ADMIN | SUBADMIN | adminAccess === true
isFullAdmin({ role, adminAccess })     // ADMIN | adminAccess === true  (não SUBADMIN)
```

`isFullAdmin` é o que substitui `role === 'ADMIN'` nos gates: o delegado tem
poder **pleno**, não de setor. É a fonte única dos dois lados — api e web —, no
mesmo espírito do resto do contrato.

### Propagação: claim no JWT

`adminAccess` vira claim do access token (`lib/jwt.ts`), ao lado de `role` e
`features`. Ligar ou desligar o switch vale **no próximo refresh (≤ 15 min)** ou
no próximo login — exatamente como as features de setor já funcionam
(ver `AGENTS.md`).

A alternativa — ler o banco em cada request de `/admin` — compraria corte
instantâneo ao preço de uma query por request administrativa, para um risco
pequeno: a janela é de 15 minutos, sobre uma conta que alguém acabou de decidir
que não administra mais, dentro do mesmo tenant. Não vale o custo permanente. Se
o corte precisar ser imediato num caso concreto, desativar a conta
(`active: false`) já revoga as sessões pelo caminho que existe hoje.

### Quem concede

Só quem tem `role = ADMIN`. O delegado usa o painel inteiro, mas **não distribui
o poder adiante**: `PATCH /admin/users/:id` recusa `adminAccess` vindo de quem
não é ADMIN por papel. Sem isso o privilégio se propagaria sozinho e a lista de
quem administra deixaria de ter dono.

Pelo mesmo motivo o campo só é aceito sobre papéis de colaborador
(`LEGEND`, `LEAD`, `MANAGER`, `HEAD`). Em `ADMIN`/`SUBADMIN` seria redundante, e
em `THIRD_PARTY`/`SUPER_ADMIN` seria perigoso — terceirizado é justamente a conta
de fora, com allowlist individual.

E se a `role` de um delegado mudar para um papel não elegível, o flag **cai
junto**, na mesma transação. Um flag pendurado numa conta que não pode mais
recebê-lo é um privilégio invisível esperando a próxima promoção.

### Onde aparece

- **Topbar** — o item **Admin** entra no mesmo grupo solto da **Liderança**, ao
  lado dela para quem lidera, sozinho para quem não. O delegado mantém a
  navegação de colaborador inteira (Home, Escritório, Votar, os cinco grupos por
  assunto): `AppLayout` continua decidindo o layout por `role`, e só a navegação
  ganha o item. Trocar a árvore para a de admin apagaria o produto da pessoa, que
  é exatamente o que este spec existe para evitar.
- **Administração › Colaboradores** — um switch na edição do colaborador,
  visível apenas para ADMIN. É onde já se edita papel, setor e líder.
- **Administração › Administradores** — os delegados aparecem numa lista à parte,
  marcada como acesso delegado, com ação de revogar. Quem administra precisa
  conseguir responder "quem tem poder aqui?" numa tela só; se o delegado
  aparecesse apenas escondido na ficha de um colaborador, a resposta exigiria
  abrir 200 fichas.

### Auditoria

Nada novo é preciso: conceder e revogar passam por `PATCH /admin/users/:id`, que
já grava `AdminAuditLog` com `before`/`after` do usuário (`admin.ts:588`) — a
mudança do flag aparece no diff, com ator e data. E toda ação que o delegado
fizer dentro do `/admin` é auditada pelo mesmo caminho de sempre, com o
`actorId` dele: o poder muda, o rastro não.

## Contrato (`@legends/shared`)

- `PublicUser.adminAccess: boolean` (e, por herança, `AdminUserDTO`).
- `packages/shared/src/permissions.ts`: `canAdminister`, `isFullAdmin`,
  `ADMIN_ACCESS_ELIGIBLE_ROLES`.
- `UpdateUserRequest` aceita `adminAccess?: boolean`.

## Fora de escopo

- **Poder parcial** (delegar só um bloco do admin). Quem precisa de recorte por
  setor já tem `SUBADMIN`; misturar as duas dimensões multiplicaria os estados
  sem demanda real.
- **Validade / expiração do acesso.** Concede e revoga na mão.
- **Delegar acesso ao console de super admin.** Aquilo é da equipe interna e
  atravessa tenants; não é a mesma pergunta.
