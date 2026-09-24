# Módulo de Treinamentos (T&D) — fase 1

**Spec:** `docs/superpowers/specs/2026-09-12-modulo-de-treinamentos-td-design.md`

## O que já existia

`CertificateRequest` com `origin = EXTERNAL`: nome do curso, `trainingType`,
`sponsor`, `investedAmountCents`, `reasons[]`, `requestedAt`, `attachmentKey` e a
fila `PENDING → APPROVED/REJECTED` em `/admin/certificados`. A tela do
colaborador era `/aprendizado/enviar-certificado`.

Faltavam carga horária, instituição, modalidade, data de conclusão, evento
interno, SLA e qualquer indicador — e é isso que a planilha do T&D tinha.

`training-analytics-service.ts` existe e **não** é isto: ele conta conclusão de
curso do catálogo interno (`CourseEnrollment.completedAt`) para a aba
Desenvolvimento & IA do People Analytics.

## O que entra

### 1. Contrato — `packages/shared/src/training.ts`

Constantes (`TRAINING_LEARNING_TYPES`, `TRAINING_MODALITIES`,
`TRAINING_PROMOTERS`, `TRAINING_DEMAND_ORIGINS`, `TRAINING_PRIORITIES`,
`TRAINING_PARTICIPATION_STATUS`, `TRAINING_SOURCES`,
`TRAINING_DEFAULT_SLA_DAYS`), tipos de anexo, DTOs (`TrainingRecordDTO`,
`TrainingEventDTO`, `TrainingOverviewDTO`, `TrainingFiltersDTO`) e as funções
puras: `trainingYear`, `trainingQuarter`, `trainingSemester`, `trainingSlaDays`,
`trainingSlaStatus`, `computeTrainingKpis`, `groupTrainingBy`,
`trainingMonthlySeries`. Teste ao lado (`training.test.ts`).

### 2. Banco

`TrainingEvent` e `TrainingRecord` no `schema.prisma`, relações em `User` e
`Company`, os dois em `TENANT_SCOPED_MODELS`. Migration
`modulo_treinamentos_td`: cria as tabelas e faz o **backfill** dos
`certificate_requests` com `origin = 'EXTERNAL'` (mapeando status, patrocinador,
motivos e anexo), apagando as linhas copiadas.

### 3. API

- `services/training-service.ts` — snapshot do colaborador, CRUD, escopo
  (próprio / subárvore do líder / empresa), filtros → `where`, validação da G&G e
  agregação do painel.
- `lib/training-error.ts`, DTOs em `lib/serialize.ts`.
- `routes/training.ts` — `GET /training/me`, `GET /training/options`,
  `POST /training/records`, `PATCH /training/records/:id`,
  `DELETE /training/records/:id`, `POST /training/certificates/presign`.
- `routes/training-admin.ts` — `GET /admin/training/records`,
  `GET /admin/training/overview`, `GET /admin/training/filters`,
  `PATCH /admin/training/records/:id`, `POST /admin/training/records/:id/validation`,
  `GET /admin/training/records.csv`, `GET`/`PUT /admin/training/settings`.
  Guarda: `app.requireSectorFeature('gente-gestao')`.
- Registro em `app.ts`.

### 4. Web

- `lib/training-api.ts`.
- `pages/training/TrainingPage.tsx` (abas Meus treinamentos / Registrar),
  `TrainingRecordForm.tsx`, `TrainingRecordList.tsx`.
- `pages/admin/TrainingSection.tsx` (abas Painel / Central) sobre
  `AnalyticsPrimitives`.
- `nav-items.ts` (Desenvolvimento → Treinamentos), `admin-nav-items.ts`
  (`/admin/treinamentos`, `featureKey: 'gente-gestao'`), rotas no `App.tsx` e
  redirect de `/aprendizado/enviar-certificado`.

### 5. O que sai

`SendCertificatePage`, `createExternalCertificateRequest` e
`listMyExternalCertificateRequests` e o braço `EXTERNAL` da fila de
certificados. As colunas externas de `CertificateRequest` continuam no schema —
dropar coluna com enum junto não paga o risco agora, e elas ficam nulas.

## Fora de escopo

Eventos internos (tela), painel da Liderança, insights por IA e Relatórios.
