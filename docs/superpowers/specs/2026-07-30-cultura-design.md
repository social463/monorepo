# Cultura (Manifesto, Manuais, Benefícios) — Design Spec

- **Data:** 2026-07-30
- **Autor:** matheus.mota
- **Status:** aprovado
- **PBI:** 22226 (tasks 22227 formulário, 22228 visão colaborador, 22229 manuais internos)

## Resumo

**Cultura** é a área de conteúdo institucional do Legends: o **Manifesto cultural**, os
**Manuais internos** (PDF + leitura no app) e os **Benefícios** (canais de apoio e programas
de bem-estar). Tudo vem do banco e é editado pela área administrativa — **nada hardcoded**.

O colaborador entra por um item novo do menu, "Cultura", que abre `/cultura` — um hub com três
abas. A área fica atrás da feature `cultura`, ligável por setor como as demais.

A referência de conteúdo e UX são os screenshots do protótipo Lovable "Portal EMR" anexados ao
PBI. Do menu `Cultura` daquele protótipo entram três telas; **Kit visual** e **Galeria de
eventos** ficam fora deste ciclo.

## Decisões

- **Conteúdo em Markdown, não schema estruturado.** O manifesto do protótipo tem ~15 seções de
  formatos muito diferentes (hero, grid de valores, comportamentos aninhados por valor ×
  audiência × listas "nos aproximam"/"nos afastam", quote do CEO). Modelar isso campo a campo
  criaria um formulário gigante e um contrato que quebra a cada ajuste editorial do G&G. Um
  corpo em Markdown por página aceita qualquer reescrita sem migration. Custo aceito: o texto
  não é consultável (não dá para reaproveitar "os 6 valores" em outra tela do app sem
  remodelar).
- **Renderer de Markdown próprio, emitindo elementos React.** `apps/web` tem só 6 dependências
  de runtime; `marked` + `dompurify` seriam duas novas mais uma superfície de XSS para
  gerenciar. Um parser de subset fechado (~150 linhas) devolve nós React — `dangerouslySetInnerHTML`
  nunca entra no caminho, então o XSS morre por construção. Se depois aparecer necessidade de
  tabela/imagem inline, troca-se pelo `marked` sem mexer nas telas.
- **`CulturePage` genérico por slug**, não uma tabela `Manifesto`. Kit visual e Galeria entram
  depois como novos slugs, sem model novo.
- **Hub com abas em vez de submenu no menu lateral.** O menu é flat e vira rail de ícones quando
  recolhido (`AppLayout.tsx`); submenu ali exigiria mexer em `AppLayout`, `MobileNav` e
  `nav-items` — três arquivos com teste — e ainda decidir o comportamento no rail. O hub
  `/cultura` com abas (padrão de `LegendsPage.tsx`) resolve a navegação dentro da própria página
  e adiciona só um item flat ao menu.
- **PDF de manual não é URL pública.** As imagens da Resenha vão para um bucket público com URL
  adivinhável só pelo UUID. Manual interno (código de ética, política de bonificação) não pode
  seguir esse caminho: o banco guarda `fileKey`, e o download passa por
  `GET /culture/manuals/:id/download`, que exige sessão + feature antes de redirecionar para um
  presign de curta duração.
- **Permissões assimétricas.** Manifesto e Benefícios são documento da empresa inteira →
  `requireAdmin`. Manuais o subadmin gerencia (`requireAdminOrSubadmin`), como o PBI pede — e
  subadmin é escopado a setor, o que não combina com conteúdo institucional.
- **Rotas de admin em `routes/culture.ts`**, não em `admin.ts` (já com 42 KB).
- **Conteúdo inicial no seed.** Manifesto e os 7 benefícios do protótipo entram transcritos, para
  a feature nascer demonstrável. O texto é do protótipo; o G&G substitui pela versão final pela
  própria tela de admin, sem deploy.

## Modelo de dados (Prisma)

Três models novos, todos com `companyId` (default `company-emr`) e índice por empresa:

- **`CulturePage`** — `slug` (`@@unique([slug, companyId])`), `title`, `subtitle?`, `body` (markdown),
  `published`, `updatedById?`.
- **`CultureManual`** — `title`, `description`, `body?` (markdown), `fileKey?`/`fileName?`/`fileSize?`,
  `referenceLabel?` ("Atualizado em junho/2024" — texto livre, como no print), `order`, `published`.
- **`CultureBenefit`** — `title`, `summary`, `icon?` (Material Symbol), `body` (markdown do modal),
  `order`, `published`.

Os três entram em `TENANT_SCOPED_MODELS` (`lib/tenant-scope.ts`) — esse registro é manual e é o
que garante o isolamento por empresa — e no truncate de `test/setup.ts`.

Duas migrations: DDL das tabelas e uma migration de dados que liga `'cultura'` em
`Sector.enabledFeatures` e no `User.enabledFeatures` dos `THIRD_PARTY`, espelhando
`20260730120500_enable_corporate_mural_where_resenha`. Sem ela a área nasce invisível.

## Contrato (`packages/shared/src/culture.ts`)

`CulturePageDTO`, `CultureManualDTO` (com `fileUrl: string | null` apontando para a rota de
download, nunca para o S3), `CultureBenefitDTO`, os requests de create/update/reorder,
`CULTURE_PAGE_SLUGS` e `CULTURE_BODY_MAX_LENGTH`.

Feature key `'cultura'` em `third-party.ts` (`FEATURE_KEYS` + `FEATURE_LABELS`) — `sector.test.ts`
já cobre a paridade entre as duas listas.

Novo `packages/shared/src/document.ts`, espelhando `image.ts`: `ALLOWED_DOCUMENT_CONTENT_TYPES`
(`application/pdf`), `DOCUMENT_MAX_BYTES` (20 MB), `isAllowedDocumentContentType` e os tipos do
presign.

## Backend

`routes/culture.ts` (fina, Zod + `safeParse`) → `services/culture-service.ts` (regra +
`CultureError` com `status`) → Prisma escopado por empresa. Serializers em `lib/serialize.ts`.

| Método | Rota | Guarda |
|---|---|---|
| GET | `/culture/pages/:slug` | `authenticate` + `requireFeature('cultura')` |
| GET | `/culture/manuals` | idem |
| GET | `/culture/benefits` | idem |
| GET | `/culture/manuals/:id/download` | idem (302 → presign GET) |
| GET/PUT | `/admin/culture/pages/:slug` | `requireAdmin` |
| GET/POST | `/admin/culture/manuals` | `requireAdminOrSubadmin` |
| PATCH/DELETE | `/admin/culture/manuals/:id` | `requireAdminOrSubadmin` |
| POST | `/admin/culture/manuals/reorder` | `requireAdminOrSubadmin` |
| GET/POST | `/admin/culture/benefits` | `requireAdmin` |
| PATCH/DELETE | `/admin/culture/benefits/:id` | `requireAdmin` |
| POST | `/admin/culture/benefits/reorder` | `requireAdmin` |
| POST | `/uploads/documents/presign` | `requireAdminOrSubadmin` |

Leitura devolve só o que está `published`; o admin lê o rascunho pela rota de admin. Mutações de
admin gravam `AdminAuditLog`, como as demais telas. Sem S3 configurado (`s3Config() === null`), o
presign responde `503` e a UI esconde o campo de arquivo — o manual segue utilizável só com o
corpo em Markdown.

`lib/s3-client.ts` ganha `buildDocumentKey` (`manuals/<companyId>/<uuid>.pdf`),
`presignDocumentUpload` e `presignDocumentDownload` (GET assinado, 5 min).

## Frontend

`components/Markdown.tsx` — parser próprio. Blocos: `##`/`###`, parágrafo, `-`/`*` (ul), `1.` (ol),
`>` (blockquote), `---` (hr). Inline: `**negrito**`, `*itálico*`, `` `código` ``, `[texto](url)`.
Links aceitam só `http(s)://` e caminhos relativos; qualquer outro esquema (`javascript:`, `data:`)
vira texto puro.

`pages/culture/`: `CultureHubPage` (rota `/cultura` sob a feature, abas refletidas na URL via
`?aba=`), `ManifestoTab` (título, subtítulo, `<Markdown>`), `ManualsTab` (cards com "Ler manual" e
"Baixar PDF"), `BenefitsTab` (grid de cards + modal com `<Markdown>`).

Menu: item "Cultura" (ícone `diversity_3`, `feature: 'cultura'`) em `nav-items.ts`, nas listas de
admin e de não-admin. `AppLayout` e `MobileNav` não mudam.

`pages/admin/culture/`: grupo "Cultura" na `AdminSidebar` com `ManifestoSection` (textarea +
preview ao vivo usando o mesmo `<Markdown>`, publicar/despublicar), `ManualsSection` (CRUD,
subir/descer, upload de PDF) e `BenefitsSection` (CRUD, subir/descer). Seguem o padrão de
`CategoriesSection` (React Query + `apiFetch` + `Panel`/`inputCls` de `admin/shared.tsx`).
`lib/upload.ts` ganha `uploadDocument`, espelhando `uploadImage`.

## Testes

- `routes/culture.test.ts` — leitura publicada/não publicada, 403 sem a feature, isolamento por
  empresa, download exigindo sessão.
- `routes/culture-admin.test.ts` — CRUD e reorder das três entidades, 403 do subadmin em manifesto
  e benefícios contra 200 em manuais, registro de auditoria.
- `routes/image-uploads.test.ts` — presign de documento: aceita `application/pdf`, rejeita imagem e
  tamanho acima do limite, 403 para quem não é admin/subadmin.
- `components/Markdown.test.tsx` — headings, listas, negrito, link válido; e que `<script>`,
  `javascript:` e `data:` não viram HTML nem link ativo.
- `pages/culture/CultureHubPage.test.tsx` — troca de aba pela URL, estados vazios.
- `pages/admin/culture/*.test.tsx` — as três sections.
- `components/nav-items.test.ts` — item Cultura com e sem a feature.

## Fora de escopo

Kit visual, Galeria de eventos, versionamento/histórico do manifesto, agendamento de publicação,
busca dentro do conteúdo, upload de formatos além de PDF, tradução/versão em outro idioma.
