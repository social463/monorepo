# Plan — Ajustes do Documento 4, Lote A

Spec: `docs/superpowers/specs/2026-08-26-ajustes-doc4-lote-a-design.md`

Os passos 1 a 10 são independentes entre si — cada um é um item do documento e
pode ser commitado sozinho. Os que mexem em schema (3 e 9) geram migration
própria.

## 1. Seção 2 — textos da tela de login

- [x] `apps/web/src/pages/LoginPage.tsx`: `HIGHLIGHTS` passa a carregar emoji
      (📣 🤝 📊) em vez de nome de ícone Material; o `<Icon>` da lista dá lugar a
      um `<span aria-hidden>`.
- [x] Kicker `Feedback entre pares` → `PORTAL EMR`; headline → `Conecte-se com a
      nossa cultura, engaje e evolua.`; parágrafo → `Sua central de informações e
      cultura na EMR.`
- [x] `E muito mais!` abaixo da lista, em `text-body-sm text-on-surface-variant`.
- [x] `LoginPage.test.tsx`: asserção dos cinco textos.

## 2. Seção 5 — 1:1 e PDI apontam para a ImpulseUp

- [x] `apps/web/src/pages/LeadershipPage.tsx`: `ShortcutCard` aceita destino
      externo (`external?: boolean`) e renderiza `<a target="_blank"
      rel="noreferrer">` com afixo `open_in_new`.
- [x] `TeamTab` lê `useDevelopmentSettings()` (mesma query de `AppLayout`) e usa
      `settings.impulseUpUrl` nos cards de 1:1 e PDI.
- [x] Sem URL cadastrada, os dois cards não são renderizados.
- [x] `LeadershipPage.test.tsx`: com URL, os dois `href` apontam para ela; sem
      URL, nenhum dos dois aparece.

## 3. Seção 7 — Peças para baixar em duas abas

- [x] `apps/api/prisma/schema.prisma`: enum `CultureVisualAssetBrand
      { CURRENT, NEW }` e `CultureVisualAsset.brand` com `@default(CURRENT)`.
      Migration por `pnpm db:migrate`.
- [x] `packages/shared/src/culture.ts`: `CULTURE_VISUAL_ASSET_BRANDS`,
      o tipo, os rótulos e as legendas de uso; campo `brand` em
      `CultureVisualAssetDTO`.
- [x] `apps/api/src/lib/serialize*`: `brand` no DTO. Rotas de criar/editar peça
      aceitam o campo no Zod.
- [x] `apps/web/src/pages/admin/culture/VisualAssetsSection.tsx`: `<select>` de
      marca no formulário, obrigatório.
- [x] `apps/web/src/pages/culture/KitVisualTab.tsx`: a seção "Peças para baixar"
      vira duas abas; legenda fixa acima da grade; aba vazia mostra estado vazio.
- [x] Testes: `KitVisualTab.test.tsx` (abas, legenda, peça na aba certa) e
      `VisualAssetsSection.test.tsx` (marca enviada no POST).

## 4. Seção 8 — Comunidade INOVA

- [x] API: `inovaSupportUrl` em `development-settings-service.ts` (chave nova em
      `AppSetting`), no Zod de `routes/development.ts` e no DTO.
- [x] `apps/web/src/pages/admin/DevelopmentSection.tsx`: campo "Contato de
      suporte da Comunidade INOVA (Teams)".
- [x] Página nova `apps/web/src/pages/ComunidadeInovaPage.tsx` com a copy
      oficial, botão **Começar agora** (`inovaCommunityUrl`) e botão **Quero
      redefinir minha senha** (`inovaSupportUrl`, some sem URL).
- [x] `apps/web/src/App.tsx`: rota `/comunidade-inova`.
- [x] `apps/web/src/components/nav-items.ts`: `inovaCommunityItem` sai do grupo
      Desenvolvimento e vira **grupo próprio** logo depois dele, com
      `to: '/comunidade-inova'` (interno, não `external`). Vale para os dois
      ramos (admin e colaborador).
- [x] Testes: `ComunidadeInovaPage.test.tsx` e `nav-items.test.ts`.

## 5. Seção 9.3 — solicitar certificado ao concluir

- [x] `packages/shared/src/learning.ts`: `certificateRequest: { status,
      rejectionReason } | null` em `CourseDetailDTO`.
- [x] `apps/api/src/services/learning-service.ts`: `requestCertificate(viewer,
      courseId)` — 400 sem inscrição `COMPLETED`, no-op com certificado emitido,
      senão `ensureCertificateRequestForEnrollment`. O detalhe do curso passa a
      carregar a solicitação.
- [x] `apps/api/src/routes/learning.ts`: `POST /learning/courses/:id/certificate-request`.
- [x] `apps/web/src/lib/use-learning.ts`: mutation.
- [x] `apps/web/src/pages/learning/CoursePlayerPage.tsx`: botão **Solicitar
      certificado** abaixo da conclusão, `disabled` enquanto não concluído; depois
      de solicitar, mostra o estado da fila (Em análise / Recusada + motivo).
- [x] Testes: `learning-service.test.ts` e `CoursePlayerPage.test.tsx`.

## 6. Seção 9.4 — confirmação da avaliação

- [x] `CoursePlayerPage.tsx`, `RatingCard`: rótulo sempre `Enviar avaliação`;
      no `onSuccess`, mensagem `Obrigada pelo seu Feedback!` com `role="status"`.
- [x] Teste no `CoursePlayerPage.test.tsx`.

## 7. Seção 10 — widget de EMR Coins e Pontos

- [x] `apps/web/src/components/CoinPanel.tsx`: `useXpBalance()` ao lado de
      `useCoinBalance()`; saldo de Pontos com 🥇 no bloco do topo.
- [x] `Como ganhar {COIN_CURRENCY_LABEL}` → `Como ganhar e usar suas
      {COIN_CURRENCY_LABEL}`; `Últimos lançamentos` → `Suas últimas atividades`.
- [x] `Atualizado em <dd/mm/aaaa às HH:MM>` a partir do `createdAt` do primeiro
      lançamento do extrato; ausente quando não há lançamento.
- [x] Teste novo `CoinPanel.test.tsx`.

## 8. Seção 11.1 — galeria de ícones do selo

- [x] `apps/web/src/components/BadgeArtPicker.tsx`: grade recolhida por padrão,
      com botão-gatilho mostrando a arte escolhida; painel aberto com
      `max-h` + rolagem própria; células menores e mais colunas.
- [x] Botão **Aleatório**: normaliza o `title` recebido por prop e os rótulos de
      `BADGE_ART`, casa por palavra, sorteia entre os que casaram (ou entre todos).
- [x] `apps/web/src/pages/admin/BadgesSection.tsx`: passa `title={badgeForm.name}`
      para o picker.
- [x] `BadgeArtPicker.test.tsx`: recolhida por padrão; abre no clique;
      "Aleatório" com título "Fogo" escolhe arte de fogo.

## 9. Seção 12 — agendar comunicado

- [x] `schema.prisma`: `SCHEDULED` em `CorporatePostStatus` e
      `CorporatePost.publishAt DateTime?`. Migration por `pnpm db:migrate`.
- [x] `packages/shared/src/corporate-mural.ts`: status novo e `publishAt` no DTO.
- [x] `apps/api/src/routes/corporate-mural.ts`: `publishAt` opcional no
      `postSchema`; instante no passado → 400. `announcePublished` sai da rota e
      vira `announceCorporatePostPublished(post, companyId, log)` no service — a
      rota de criar e a de aprovar passam a chamá-la.
- [x] `corporate-mural-service.ts`: `createPost` grava `SCHEDULED` + `publishAt`
      quando o autor publicaria direto; ignora `publishAt` quando o post nasceria
      `PENDING`. As listagens do feed excluem `SCHEDULED`.
- [x] `apps/api/src/scheduler/scheduled-posts.ts`: tick de 60 s, publica os
      vencidos e chama `announceCorporatePostPublished`. Registrado em `server.ts`.
- [x] `apps/web/src/pages/mural-corporativo/CorporatePostComposer.tsx`: toggle
      **Agendar publicação** + `datetime-local`.
- [x] Feed de quem administra mostra os agendados com a data marcada.
- [x] Testes: `corporate-mural.test.ts` e `scheduled-posts.test.ts`.

## 10. Seção 13.2 — comunicado apagado sai do calendário

- [x] `apps/api/src/services/corporate-mural-service.ts` (`deletePost`): na mesma
      transação, `campaignPost.deleteMany({ where: { publishedPostId: id } })`.
- [x] Comentário no `schema.prisma` registrando por que o `onDelete: SetNull` do
      `CampaignPost.publishedPost` deixou de ser suficiente.
- [x] Teste em `campaign-service.test.ts`: comunicado publicado por campanha,
      apagado, some do calendário.

## Fechamento

- [x] `pnpm test` completo (com `LEGENDS_DB_PORT=5442 pnpm db:up` antes).
      Shared 719/719, API 3083/3083, web 2707/2707. Dois testes vizinhos
      precisaram acompanhar o contrato novo: o `toEqual` exato de
      `pdi.test.ts` (campo `inovaSupportUrl`) e o rótulo do link em
      `CoinIndicator.test.tsx`. `RoomAudioPlayer.test.tsx` falha por relógio
      de parede sob carga e passa isolado — não é deste lote.
- [ ] Marcar no checklist da seção 15 do documento os itens entregues.
