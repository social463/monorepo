# Plan — Ajustes do Documento 4, Lote E (Campanhas)

Spec: `docs/superpowers/specs/2026-08-26-ajustes-doc4-lote-e-design.md`

Branch empilhada sobre `feat/ajustes-doc4-lote-d` — cadeia A → D → E.

Os quatro passos são independentes entre si.

## 1. Modelo padrão de comunicado (§13.4)

- [x] `packages/shared/src/campaign.ts`: `SMART_BREVITY_PROMPT` (texto oficial,
      literal) e `applyTemplate?: boolean` em `GenerateCampaignRequest`.
- [x] `apps/api/src/services/campaign-settings-service.ts`: lê/grava
      `campaign_prompt_template` em `AppSetting`; sem valor, devolve o oficial.
- [x] `campaign-prompt.ts`: `buildCampaignPrompt` recebe `template` e o injeta
      antes das REGRAS quando `applyTemplate`.
- [x] `corporate-post-prompt.ts`: mesmo modelo, no lugar do `TODO(tom-de-voz)`.
- [x] Rotas `GET`/`PUT /admin/campaign-prompt-template`.
- [x] Testes: `campaign-prompt.test.ts`, `campaign-settings-service.test.ts`,
      `corporate-post-prompt.test.ts`.

## 2. Publicar comunicado dentro de Campanhas (§13.1)

- [x] `CampaignsSection.tsx`: terceira aba **Publicar** com o
      `CorporatePostComposer` do Feed — o componente, não uma cópia.
- [x] Ligação por `useCreateCorporatePost` + `canPublishCorporatePostDirectly`,
      igual ao `MuralCorporativoFeed`.
- [x] Teste: `CampaignsSection.test.tsx`.

## 3. Calendário editorial no calendário organizacional (§13.2)

- [x] `calendar-event-service.ts`: a listagem da janela passa a devolver também
      os `CampaignPost` do período, recortados pela mesma regra de
      `canSeeInternalCalendarEvents`.
- [x] `packages/shared`: `campaignPosts` na resposta da listagem.
- [x] Front do calendário: `CampaignPostsStrip`, faixa acima da grade, somente
      leitura, com link para Administração › Campanhas. Faixa e não barra dentro
      da grade: item de campanha é comunicado agendado, não evento que ocupa o
      dia — e assim vale igual nas três visões (mês, semana, dia).
- [x] Testes: rota (item na janela; some para quem não é G&G) e tela.

## 4. Painel do modelo padrão (§13.4, tela)

- [x] `CampaignPromptPanel.tsx` em Administração › Campanhas: textarea com o
      modelo, botão de salvar e de restaurar o oficial.
- [x] `CampaignGenerator.tsx`: toggle "Aplicar o modelo padrão (Brevidade
      Inteligente)", ligado por padrão, viajando no corpo do request.
- [x] Testes: em `CampaignsSection.test.tsx` — o gerador só renderiza dentro
      dela, e é o caminho inteiro (abrir a aba, ver o painel, ver o toggle
      ligado) que interessa provar.

## Fechamento

- [ ] `pnpm test` completo, lendo a SAÍDA e o exit code do `vitest`/`tsc` — não
      o de um pipeline (ver a correção do Lote A).
- [ ] Commit único e PR alvo `feat/ajustes-doc4-lote-d`.
- [ ] Levar ao G&G a pergunta da §13.3 (os campos já existem — o que faltou?).
