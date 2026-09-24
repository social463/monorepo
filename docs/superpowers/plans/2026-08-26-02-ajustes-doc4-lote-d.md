# Plan — Ajustes do Documento 4, Lote D (Selos e Emblemas)

Spec: `docs/superpowers/specs/2026-08-26-ajustes-doc4-lote-d-design.md`

Branch empilhada sobre `feat/ajustes-doc4-lote-a` — os dois lotes editam
`BadgesSection.tsx`.

Ordem: 1 (schema) é pré-requisito de tudo. 2 → 5 dependem dele; 6 e 7 são de
tela e fecham por cima.

## 1. Schema e migration

- [x] `BadgeCategory` (`name`, `slug`, `order`, `active`, `companyId`,
      `@@unique([companyId, slug])`).
- [x] `Badge`: `badgeCategoryId String?` (FK, `onDelete: SetNull`),
      `rewardPoints Int?`, `rewardCoins Int?`.
- [x] `BadgeClaim` + enum `BadgeClaimStatus`.
- [x] `BADGE_EARNED` em `CoinEvent` e `XpEvent`.
- [x] Migration: as cinco categorias (Feedback, Social, Desenvolvimento, Clima,
      Cultura) por `INSERT … SELECT id FROM "Company"`, e o índice único
      **parcial** de `BadgeClaim` escrito à mão no SQL.
- [x] `db:seed` cria as cinco para empresa nova.

## 2. Recompensa em duas moedas

- [x] `apps/api/src/services/xp-service.ts`: `awardFixedXp`, espelho de
      `awardFixedCoins` (inclusive `tx` e `P2002` → `DUPLICATE`).
- [x] `apps/api/src/services/badge-reward-service.ts`: `creditBadgeRewards` e
      `settleBadgesEarned(userId, badgeIds, companyId)` — credita e então
      notifica; dedupe por `BADGE_EARNED:<badgeId>`; best-effort.
- [x] Trocar os 11 call sites de `notifyBadgesEarned` por `settleBadgesEarned`
      (`admin.ts`, `votes.ts`, `mood.ts`, `feedback.ts` ×2,
      `development-thursday.ts`, `profile.ts`, `pdi-service.ts`,
      `highlight-service.ts`, `learning-service.ts`).
- [x] `grantBadgeManually` credita também — de graça: a rota de concessão
      manual (`admin.ts`) já passa pelo funil, então não houve gancho novo.
- [x] `packages/shared`: `rewardPoints`/`rewardCoins` no `BadgeDTO`; rótulos dos
      eventos novos em `COIN_EVENT_LABELS` e `XP_EVENT_LABELS`.
- [x] Testes: `badge-reward-service.test.ts`.

## 3. Tema do selo (`BadgeCategory`)

- [x] `badge-category-service.ts`: listar, criar, renomear, desativar.
- [x] Rotas `/admin/badge-categories` (GET, POST, PATCH) e `/badge-categories`
      (GET, para a galeria).
- [x] `BadgeCategoryDTO` em `@legends/shared`.
- [x] `Badge` aceita `badgeCategoryId` no create/update; DTO devolve.
- [x] Testes: `badge-category-service.test.ts`.

## 4. Reivindicação de selo (API)

- [x] Chave de anexo `buildBadgeClaimKey(userId, contentType)` em `s3-client.ts`
      (imagem **ou** PDF) e presign `/uploads/badge-claim/presign`.
- [x] `badge-claim-service.ts`: `createBadgeClaim`, `listBadgeClaims`,
      `approveBadgeClaim`, `rejectBadgeClaim`, `listMyBadgeClaims`.
      Aprovar = `updateMany` condicional + `UserBadge` + crédito, tudo no mesmo `tx`.
- [x] DTO com **URL assinada** do anexo, nunca a chave.
- [x] Rotas: `POST /badges/:id/claims`, `GET /me/badge-claims`,
      `GET /admin/badge-claims`, `POST /admin/badge-claims/:id/approve`,
      `POST /admin/badge-claims/:id/reject`.
- [x] Notificação de aprovada/recusada para quem pediu.
- [x] Testes: `badge-claim-service.test.ts` e rotas.

## 5. Planilha de selos

- [x] `packages/shared/src/badge-import.ts`: colunas, aliases, limites,
      template de exemplo, tipos de preview/resultado.
- [x] `badge-import-service.ts`: `template`, `preview`, `commit` pelo mesmo
      `resolveImport`; reconciliação por `slug`; export CSV de todas as colunas.
- [x] Rotas `/admin/badges/import/template`, `/preview`, `/commit`, `/export`.
- [x] Testes: `badge-import-service.test.ts`.

## 6. Painel de Emblemas (admin)

- [x] `BadgesSection.tsx`: agrupar por tema com contador; chip de setor no item;
      ações **Atribuir** (seletor de pessoa do selo) e **Excluir**.
- [x] Campos novos no formulário: tema, Pontos e EMR Coins (os dois opcionais).
- [x] Gestão de temas (criar/renomear/desativar) na mesma tela.
- [x] Fila de reivindicações com abas Pendentes / Aprovadas / Recusadas.
- [x] Botões de importar e exportar planilha.
- [x] Testes: `BadgesSection.test.tsx`.

## 7. Reivindicar na galeria (colaborador)

- [x] `BadgeClaimDialog.tsx` com os textos oficiais, relato obrigatório
      (≤ 1.000), anexo (imagem ou PDF) e link opcional.
- [x] `BadgesGallery.tsx`: botão "Reivindicar" no selo ainda não conquistado; o
      estado da solicitação aparece no lugar dele depois de enviada.
- [x] Testes: em `BadgesGallery.test.tsx` — o modal é testado por lá, junto do
      botão que o abre, em vez de num arquivo próprio: o que interessa provar é
      o caminho inteiro (quando o botão aparece, o que o modal escreve).

## Fechamento

- [ ] `pnpm test` completo.
- [ ] Commit único e PR alvo `feat/ajustes-doc4-lote-a`.
