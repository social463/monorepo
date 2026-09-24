# Materiais da chegada no perfil

**Spec:** `docs/superpowers/specs/2026-09-04-materiais-da-chegada-no-perfil-design.md`

## O que já existia

`CulturePersonalAsset` (adendo do spec do kit visual, 2026-08-16): arquivo
dirigido a UMA pessoa, prefixo privado no S3 (`personal-assets/<companyId>/
<recipientId>/`), prévia e download por link assinado, rota de download que
reconfere quem pede e responde 404 — não 403 — para quem não pode.

`User.joinedAt` já é a data de admissão, e o `ProfilePage` já a exibe ("Na equipe
desde").

Nada de onboarding existia.

## O que entra

### 1. Contrato ✅

`packages/shared/src/culture.ts`:

- `ONBOARDING_MATERIALS_WINDOW_DAYS = 90`;
- `CultureOnboardingKitResponse { active, endsAt, daysLeft, assets }`.

`assets` reaproveita `CulturePersonalAssetDTO` — é o mesmo material.

### 2. API ✅

`getOnboardingKitFor(userId, companyId)` em `culture-service.ts`: lê `joinedAt`,
soma os 90 dias, e **só então** lista os materiais. Fora da janela devolve
`{ active: false, endsAt: null, daysLeft: 0, assets: [] }` sem tocar na tabela de
materiais.

`GET /culture/onboarding-kit` em `routes/culture.ts`, com `publicReadGuard` (só
sessão) e recorte pelo `sub` do token — sem parâmetro de pessoa, como
`/culture/personal-assets`.

`daysLeft` arredonda para **cima**: no último dia ainda falta "1 dia". Zero é o
que o front lê como janela fechada.

### 3. Front ✅

- `useMyOnboardingKit()` em `lib/use-culture.ts`, `staleTime` de 2 min pelo mesmo
  motivo do kit pessoal (link assinado de 5 min).
- `pages/profile/OnboardingMaterialsCard.tsx`: some sozinho quando `!active` ou
  sem material. Uma linha por material; download por `<button>` chamando a rota
  autenticada, nunca `<a href>` — o access token vive só em memória.
- Ligado no `ProfilePage` sob `isOwnProfile`, **antes** de `MoodOfDay` e
  `MyVacationSection`.
- `PersonalAssetsSection` (admin) ganhou a frase que explica os 90 dias.

## Testes

- `apps/api/src/routes/culture-admin.test.ts` — três casos: dentro da janela
  (material + `daysLeft`), fora dela (lista vazia, e o material ainda visível em
  `/culture/personal-assets`), e o recorte pelo token (query com id de colega é
  ignorada).
- `apps/web/src/pages/profile/OnboardingMaterialsCard.test.tsx` — cinco casos:
  lista + dias + link para o Kit visual, janela fechada, janela aberta sem
  material, download pelo link assinado, e falha de download virando aviso na
  linha.

## O que ficou de fora

Marcar quais materiais são "de chegada", janela configurável por empresa e aviso
ativo na entrega — os três com o porquê no spec.
