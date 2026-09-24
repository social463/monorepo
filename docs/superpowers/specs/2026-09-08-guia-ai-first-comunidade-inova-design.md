# Guia AI First dentro da Comunidade INOVA

Data: 2026-09-08

## Contexto

O spec `2026-09-03-comunidade-inova-nativa-design.md` trouxe o núcleo funcional
do projeto original (projetos, fases, diário de bordo, tarefas) para dentro do
Legends e deixou de fora, de propósito, o "conteúdo institucional do projeto
original (Cultura, Trilhas, Explicação do Ranking, Responsabilidades, Como
Usar)" — candidato a fundir com Manifesto/Manuais.

Esse conteúdo já foi parcialmente resolvido: `InovaHowToPage`,
`InovaResourcesPage`, `InovaResponsabilidadesPage` e
`InovaRankingExplicacaoPage` existem hoje em `apps/web/src/pages/inova/`. O que
ficou de fora é maior e mais específico: o **Guia "Bússola AI First"**, um
submódulo autocontido do projeto original (`src/guia/` no
`codigo-fonte-inova-emr.zip`, 11 páginas, ~4.700 linhas), com conteúdo próprio
sobre como usar IA no trabalho — não é institucional (não fala da EMR como
empresa), é um guia de referência e prática.

Este spec cobre só o Guia. Ele não depende de Supabase/backend no original —
tudo é conteúdo estático (arrays TS) + estado local de navegador
(`localStorage` para favoritos e progresso do quiz de maturidade).

## O que o Guia original tem

Fonte: `src/guia/` no zip. Sem chamada de rede — roteado sob `/guia-ai-first`
com um shim que reproduz a API do `@tanstack/react-router` sobre
`react-router-dom` (o projeto original já tinha portado esse módulo de outro
router para dentro de si mesmo).

- **Início** — porta de entrada, com dois caminhos: "não sei por onde
  começar" (leva à Bússola) e "tenho uma situação específica" (leva a
  Situações).
- **Bússola** (`CompassWizard`) — três perguntas guiadas que apontam um de
  três caminhos (`ia`, `ia-pessoa`, `pessoa`) para a situação da pessoa.
- **Situações** — catálogo pesquisável de situações de trabalho, cada uma com
  papel da IA, papel humano, risco e caminho recomendado; abre um modal de
  detalhe com prompt e FAQ relacionados.
- **Na Prática** — abas: ciclo de uso, comportamentos (fazer/não fazer +
  quiz), exercícios, e conteúdo por área (`areas`/`areaName`).
- **Vídeos** — biblioteca de vídeos curtos (reaproveita a seção de vídeos de
  Na Prática).
- **Prompts** — catálogo de prompts prontos por categoria, com framework
  PCTFR (Papel/Contexto/Tarefa/Formato/Restrições), busca e favoritos.
- **Maturidade** — questionário de autoavaliação (`maturityQuestions`) que
  calcula um nível (1–5) e mostra o que fazer para evoluir
  (`maturityLevels`/`exerciseById`).
- **Liderança** — blocos de conteúdo + checklist para quem lidera equipes.
- **Segurança** — semáforo do que pode/precisa validação/não pode fazer com
  dados sensíveis.
- **Casos** — vitrine de cases reais da comunidade (começa vazia no original,
  com um link de cadastro externo).
- **Guia Completo / FAQ** — glossário, convicções, princípios e FAQ com busca
  e filtro por categoria.

Cada página dispara eventos (`track(...)`) e algumas guardam estado em
`localStorage` (favoritos de prompts/situações, respostas do quiz de
maturidade).

## Decisão de escopo

Módulo inteiro, como aba nova dentro do board da Comunidade INOVA, aberta a
qualquer usuário com o módulo habilitado (mesma trava de duas camadas —
slug `emr` + `inova_module_enabled` — do resto do INOVA; não é ação
administrativa, é conteúdo de referência para quem usa). Visual reescrito do
zero com os componentes e tokens do Legends — nada do `guia.css`/classes tipo
`emr-container`/`surface-dark` do original é reaproveitado como está.

O cadastro externo de cases do projeto original não entra: a vitrine de Casos
mantém a mensagem "começa vazia de propósito", sem link de formulário externo.

Conteúdo (textos, situações, prompts, FAQs, etc.) é portado quase como está —
é catálogo estático de texto, e reescrever à mão introduziria risco de erro de
transcrição sem ganho. Não vira conteúdo editável via admin nesta leva
(diferente de Manifesto/Manuais, que são Markdown gravado no banco) — é
conteúdo curado por dev, como o catálogo de mobília do escritório
(`office-asset-catalog.json`). Revisável depois, se aparecer a necessidade de
edição sem deploy.

## Estrutura e navegação

- `apps/web/src/pages/inova/InovaLayout.tsx` ganha um novo item de nav
  **"Guia"**, mesmo padrão de `NavLink`/`tabCls` dos demais, entre "Recursos"
  e "Como usar".
- Rota `/comunidade-inova/guia/*`, com layout próprio interno
  (`InovaGuiaLayout`) para o sub-menu das 11 seções — mesma ideia do
  `GuiaLayout`/`SiteHeader` original, mas com os componentes do Legends
  (`Icon`, tokens `surface-*`/`on-surface`/`primary`, sem CSS próprio novo).
- Arquivos novos em `apps/web/src/pages/inova/guia/`:
  - `InovaGuiaLayout.tsx` — sub-nav das 11 seções.
  - `pages/` — uma página por seção (`InovaGuiaHomePage.tsx`,
    `InovaGuiaBussolaPage.tsx`, `InovaGuiaSituacoesPage.tsx`,
    `InovaGuiaNaPraticaPage.tsx`, `InovaGuiaVideosPage.tsx`,
    `InovaGuiaPromptsPage.tsx`, `InovaGuiaMaturidadePage.tsx`,
    `InovaGuiaLiderancaPage.tsx`, `InovaGuiaSegurancaPage.tsx`,
    `InovaGuiaCasesPage.tsx`, `InovaGuiaCompletoPage.tsx`).
  - `content/` — `situations.ts`, `prompts.ts`, `faqs.ts`, `library.ts`,
    `videos.ts`, `cases.ts`, `types.ts`, portados do original (ajustando só
    imports/tipos para o padrão do repo, e removendo o link externo de
    cadastro de cases).
  - `components/` — `CompassWizard`, `SectionHeading`, `Chip`,
    `CopyPromptButton`, `PathBadge`, `HelpfulFeedback`, `StatBar`, busca
    global do módulo — reescritos com Tailwind/tokens do Legends.
  - `lib/useGuiaLocalState.ts` — hook novo, pequeno, sobre `localStorage`
    (favoritos de prompts/situações, resposta do quiz de maturidade),
    escopado a este módulo. Não existe utilitário parecido no repo hoje;
    nasce aqui sem generalizar além do necessário.

## Analytics

As chamadas `track(...)` do original viram eventos via `captureFor`/
`apps/web/src/lib/analytics.ts`, com nomes novos adicionados a
`WEB_ANALYTICS_EVENT_NAMES` (`packages/shared/src/analytics.ts`):

- `inova_guia_bussola_completada`
- `inova_guia_situacao_aberta`
- `inova_guia_prompt_copiado`
- `inova_guia_maturidade_respondida`
- `inova_guia_lideranca_aberta`
- `inova_guia_seguranca_aberta`

O teste existente de `analytics.ts` (formato/limites do GA4) cobre os nomes
novos sem mudança de teste.

## Dependências

`lucide-react` é usado pelo original para os ícones do Guia — confirmar se já
é dependência de `apps/web` antes de portar; se não for, adicionar (biblioteca
pequena, sem risco).

## Fora de escopo

- Edição do conteúdo do Guia via admin (fica estático, curado por dev).
- Cadastro externo de cases (removido; vitrine de Casos continua "vazia de
  propósito").
- Chat de IA analítica e allowlist por planilha do Google — já excluídos pelo
  spec da Comunidade INOVA nativa.
- Progresso do quiz de maturidade sincronizado entre dispositivos — fica só em
  `localStorage`, como no original.

## Testes

- `apps/web`: Testing Library cobrindo navegação entre as 11 seções, fluxo da
  Bússola (3 perguntas → caminho), busca e favoritos em Situações/Prompts,
  cálculo de nível no quiz de Maturidade, visibilidade do item "Guia" atrás de
  `inovaModuleEnabled`.
- `packages/shared`: nenhum teste novo necessário além da cobertura já
  existente de `analytics.ts` para os nomes de evento novos.
