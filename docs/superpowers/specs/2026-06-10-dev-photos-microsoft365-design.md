# Design — Fotos dos desenvolvedores via Microsoft 365 (one-time)

**Data:** 2026-06-10
**Status:** Aprovado para implementação (pendente revisão do spec escrito)

## Objetivo

Popular o campo `User.photoUrl` de cada desenvolvedor com a foto oficial vinda do
Microsoft 365 / Entra ID (Azure AD), exibida na UI que já consome `photoUrl` via
`<img src>`. Abordagem **one-time**: a foto é buscada uma vez (via conector MCP
Microsoft 365, nesta sessão), os arquivos são versionados no repositório, e o seed
passa a gravar o `photoUrl` de forma reproduzível e portável entre ambientes.

## Decisões (travadas no brainstorming)

- **Modelo de sync:** one-time via MCP, com as fotos versionadas no repo. Sync
  repetível via Graph/app-registration fica como evolução futura.
- **Storage:** arquivos estáticos servidos pela própria API (Opção A). Em produção o
  conjunto viaja com o deploy (versionado no git), dispensando Azure Files para este
  caso. Se virar sync repetível, troca-se a origem por Azure Files sem alterar o resto.
- **Escopo do pull:** **apenas fotos**, para os emails já curados no seed. `name`,
  `position` e `squad` permanecem como estão (metadados curados em PT).
- **Identidade:** quem entra é definido pela lista do seed
  (`apps/api/prisma/seed.ts`), não por descoberta no Entra. TL/Head/GPM seguem fora.

## Estratégia de URL (portabilidade)

`photoUrl` passa a ser **relativo e derivado do email do seed**:

```
photoUrl = `/api/avatars/{handle}.jpg`     // handle = parte local do email
# ex.: matheus.mota@eumedicoresidente.com.br  ->  /api/avatars/matheus.mota.jpg
```

Por quê funciona em dev e prod sem env var:

- O app já roteia `/api` → API (proxy do Vite em dev: `/api` → `localhost:3333` com
  rewrite removendo `/api`; reverse proxy equivalente em prod). Toda chamada do front
  (`apiFetch` em `apps/web/src/lib/api.ts`) já depende desse prefixo.
- A API serve `/avatars/*` (sem o `/api`, que é responsabilidade do gateway).
- Logo, `/api/avatars/x.jpg` resolve contra a origem da página e é roteado para a API
  em qualquer ambiente. **O front não muda** — `<img src={photoUrl}>` continua igual.
- O valor é **relativo** → a mesma linha do banco funciona em dev e prod, inclusive
  populando o banco de produção via `db:seed`.

## Onde os arquivos moram

- Caminho no repo: `apps/api/assets/avatars/{handle}.jpg` (**versionado no git**).
- Servidos por `@fastify/static` (nova dependência), montado com prefixo `/avatars/`
  e `Cache-Control` longo (imagens raramente mudam).
- Como estão no repo, são incluídos no build/deploy — **sem Azure Files** para este
  conjunto estático.

## Chave de armazenamento × identidade do Entra (reconciliação)

Ponto de atenção: o domínio do seed (`@eumedicoresidente.com.br`) provavelmente
**difere** do UPN/mail no Entra (o domínio corporativo aparenta ser `@eumedicoresidente.com.br`).
Para que isso não quebre nada:

- **A chave de armazenamento e o `photoUrl` derivam SEMPRE do email/handle do SEED**
  (fonte de verdade do app). O nome do arquivo nunca depende do email no Azure.
- **O lookup no Graph pode usar outra identidade.** Como o fetch é one-time e
  interativo, a reconciliação é feita por pessoa, nesta ordem:
  1. busca por email exato (como `userPrincipalName` e como `mail`);
  2. se não achar, busca por `displayName` (nome do seed);
  3. confirma a correspondência antes de baixar a foto.
- **Não-casados ou ambíguos** são **reportados ao usuário** para confirmação manual.
  Nada é adivinhado. Enquanto não confirmado, a pessoa fica sem arquivo e mantém o
  fallback de iniciais já existente na UI.

O resultado do fetch é um conjunto de arquivos `assets/avatars/{handle}.jpg` cujas
chaves são os handles do seed, independente de como a pessoa foi localizada no Entra.

## Como o `photoUrl` entra no banco (durável)

- O seed (`apps/api/prisma/seed.ts`) deriva `photoUrl` do email de cada dev e o seta
  **tanto no `create` quanto no `update`** do upsert, **somente quando o arquivo
  correspondente existir** em `assets/avatars`. Quando não existir, mantém `null`.
- Sem migration: a coluna `photoUrl` já existe no schema.
- Reproduzível: rodar `db:seed` em qualquer ambiente recompõe os `photoUrl` corretos.

## Componentes e interfaces

- `avatarPathFor(email: string)` — helper puro que deriva o handle e devolve o caminho
  público (`/api/avatars/{handle}.jpg`) e/ou o caminho de arquivo em disco. Fonte única
  da convenção de naming. Testável isoladamente.
- Registro do `@fastify/static` em `apps/api/src/app.ts`, servindo `assets/avatars` sob
  `/avatars/`.
- Ajuste no seed para usar `avatarPathFor` + checagem de existência do arquivo.
- (Fora deste spec, executado por mim na sessão) o passo de fetch one-time via MCP.

## Fluxo de dados

```
[MCP Microsoft 365 / Graph]  --(one-time, interativo)-->  arquivos em assets/avatars/{handle}.jpg  (commit)
                                                                  |
db:seed  --upsert User.photoUrl = /api/avatars/{handle}.jpg (se arquivo existe)--> [Postgres]
                                                                  |
front <img src={photoUrl}>  --> GET /api/avatars/{handle}.jpg  --(gateway /api)--> @fastify/static
```

## Tratamento de erros / bordas

- Pessoa sem foto no Entra ou não reconciliada → sem arquivo → `photoUrl` null →
  fallback de iniciais (comportamento atual).
- Arquivo ausente em runtime → `@fastify/static` responde 404; a UI já lida com isso
  porque o fallback depende do valor de `photoUrl`, não do sucesso do GET. (Observação:
  se `photoUrl` estiver setado mas o arquivo sumir, a imagem quebra — por isso o seed só
  seta quando o arquivo existe no repo.)

## Testes

- Rota: `GET /avatars/<arquivo-existente>` → 200 + content-type de imagem;
  `GET /avatars/<inexistente>` → 404.
- Unit: `avatarPathFor(email)` deriva handle e caminho corretos (incl. emails com
  pontos e maiúsculas).
- Seed/integração: `photoUrl` é setado quando o arquivo existe e fica `null` quando não.

## Fora de escopo (evoluções futuras)

- Sync repetível via Microsoft Graph com app registration (`User.Read.All`).
- Sobrescrever `position`/`squad` com `jobTitle`/`department` do Entra.
- Descobrir o time a partir de grupo/departamento do Entra.
- Upload/troca de foto pela UI.
- Migração para Azure Files / Blob + CDN quando houver escrita em runtime ou múltiplas
  réplicas.
