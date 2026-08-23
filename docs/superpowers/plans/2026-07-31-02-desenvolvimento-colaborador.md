# Plano — Desenvolvimento: visão do colaborador (PBI #22238)

Spec: [`2026-07-31-desenvolvimento-colaborador-design.md`](../specs/2026-07-31-desenvolvimento-colaborador-design.md)

## Fatias

| # | Fatia | Status |
| --- | --- | --- |
| 1 | Contrato + schema (`learning.ts`, `pdi.ts`, models, migrations) | feito |
| 2 | Catálogo + inscrição | feito |
| 3 | Player + progresso derivado + certificado | feito |
| 4 | PDI: planos e ações | feito |
| 5 | Conclusão guiada com evidência e reflexão | feito |
| 6 | Validação do líder (fila, aprovar, pedir ajustes, notificações) | feito |
| 7 | Vitrine do perfil com visibilidade | feito |
| 8 | Link externo ImpulseUP + configuração no admin | feito |
| 9 | Autoria de curso no admin (módulos, aulas, link de vídeo, publicar) | feito |
| 10 | Selos de Aprendizado e de PDI no sistema de selos existente | feito |
| 11 | MentorIA | **bloqueada** — depende do #22281 (`AgentConversation`) |

## O que entrou

**Contrato (`packages/shared`)**
- `learning.ts` — níveis, tipos de aula, status de inscrição, `CourseCardDTO`,
  `CourseDetailDTO`, `EnrollmentDTO`, `LearningTrackDTO`, `CertificateDTO`,
  `PublicCertificateDTO`, `LearningSummaryDTO`, `certificateHoursFor`.
- `pdi.ts` — enums + rótulos pt-BR, `PDI_REFLECTION_FIELDS`, limites,
  `PdiPlanDTO`/`PdiActionDTO`/`PdiShowcaseDTO`, `pdiProgressOf`,
  `isPdiReflectionComplete`.
- `third-party.ts` — chaves `aprendizado` e `pdi`.
- `notification.ts` — `PDI_ACTION_AWAITING_REVIEW`, `PDI_ACTION_APPROVED`,
  `PDI_ACTION_CHANGES_REQUESTED`, `MANDATORY_COURSE_ASSIGNED`.

**API (`apps/api`)**
- Migrations `20260731210000_add_learning_and_pdi` e
  `20260731213000_enable_development_features`; todos os models novos entraram em
  `TENANT_SCOPED_MODELS` e na truncagem do `test/setup.ts`.
- `services/learning-service.ts`, `services/pdi-service.ts`,
  `services/development-settings-service.ts`.
- `lib/serialize-learning.ts`, `lib/serialize-pdi.ts`, `lib/certificate-renderer.ts`,
  `lib/certificate-storage.ts`, `lib/svg-fonts.ts` (fontes do resvg, extraídas do
  `card-renderer` para os dois renders compartilharem).
- `routes/learning.ts`, `routes/pdi.ts`, `routes/development.ts`.

**Web (`apps/web`)**
- `pages/learning/` — hub com 5 abas, player, card de curso, página pública do
  certificado.
- `pages/pdi/` — hub com 4 abas, wizard de conclusão, fila do líder, card de ação.
- `pages/admin/DevelopmentSection.tsx` — validação do líder e URL do ImpulseUP.
- Menu: itens Aprendizado / Meu PDI / Avaliações (externo) em `nav-items.ts`,
  renderização de item externo em `AppLayout` e `MobileNav`.

## Testes

- `learning-service.test.ts` (14) — progresso derivado, idempotência da aula,
  rascunho invisível, certificado só para inscrição concluída e com o mesmo código,
  nota 1–5 única por pessoa, resumo do mês, isolamento por empresa.
- `pdi-service.test.ts` (18) — cada combinação de autorização, aprovação do líder
  ligada/desligada, plano sem líder, exigência de evidência+reflexão, aprovar/pedir
  ajustes, histórico, visibilidade da vitrine nos quatro valores.
- `learning.test.ts` / `pdi.test.ts` de rota (14) — 401, feature gate, fluxo completo,
  certificado público sem login, 404 entre empresas, configuração do ImpulseUP.
- `badge-development.test.ts` (12) — concessão e revogação nos dois fluxos, PDI só após aprovação, selo do dono do plano, manual intocado, progresso no catálogo.
- `courses-admin.test.ts` (9) — gate de admin, rascunho invisível, slug único, publicar exige aula, duração somada, 404 entre empresas.
- `packages/shared` (12) e web (`nav-items`, `CompleteActionWizard`, `LearningPage`).

## Fatias 9 e 10 (entraram depois do recorte original)

**Autoria de curso** — `services/course-admin-service.ts`, `routes/courses-admin.ts`
e `pages/admin/CoursesSection.tsx`. Migration `20260801110000_course_duration_derived`
remove `Course.durationMinutes` (a duração passa a ser a soma das aulas).
`toVideoEmbedUrl` em `@legends/shared` normaliza o link de vídeo para a forma
embutível; o formulário mostra a pré-visualização convertida.

**Selos** — `BadgeKind` ganhou `COURSE` e `PDI` (migration
`20260801120000_badge_kinds_development`). `syncFeedbackBadgesForUser` virou o
genérico `syncThresholdBadges`, com `syncCourseBadgesForUser` e
`syncPdiBadgesForUser` por cima. Gatilhos em `setLessonCompletion`, `completeAction`
e `reviewAction`, todos best-effort. Seed traz 4 faixas de cada.

## Pendências conhecidas

1. **MentorIA** — reabrir quando o #22281 entrar; o prompt deve ser função pura
   testável (padrão de `buildCongratsPrompt`) e responder só com base no conteúdo do
   curso enviado como contexto.
2. **Notificação de curso obrigatório** — `notifyMandatoryCourseAssigned` já existe,
   mas quem atribui curso obrigatório é o CMS do #22272; o gatilho entra lá.
3. **Seed de curso** é semente de desenvolvimento (`prisma/learning-seed-content.ts`),
   substituída pelo conteúdo real quando a Central de Cursos publicar.
