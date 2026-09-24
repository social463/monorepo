# Comunidade INOVA nativa no Legends

Data: 2026-09-03

## Contexto

Hoje o menu do Legends tem um item "Comunidade INOVA" que só aparece quando a
empresa tem `inovaCommunityUrl` configurada (Administração › Desenvolvimento,
`development-settings-service.ts`). A rota interna `/comunidade-inova`
(`ComunidadeInovaPage.tsx`) é só uma tela explicativa com um botão "Começar
agora" que abre esse link **externo** — hoje uma plataforma própria (Lovable +
Supabase) da EMR de gestão de projetos de inovação.

Objetivo: trazer o **núcleo funcional** dessa plataforma para dentro do
Legends, como módulo nativo, restrito à EMR. O conteúdo institucional do
projeto original (Cultura, Trilhas, Explicação do Ranking, Responsabilidades,
Como Usar) **não** entra como páginas novas — é candidato a fundir com o que já
existe em Manifesto/Manuais, fora do escopo deste spec.

Fora de escopo nesta leva (decisão do usuário): chat de IA analítica do painel
admin original e a sincronização de allowlist de e-mails via planilha do
Google — quem já acessa o Legends na EMR pode usar o módulo.

## O que o projeto original faz

Fonte: `codigo-fonte-inova-emr.zip` (Vite + React + Supabase, ~17k linhas,
gerado via Lovable). É um tracker leve de iniciativas de inovação/IA, não um
feed social:

- **Projeto** — título, categoria, setor (texto livre, sem FK), descrição,
  responsáveis, representante do setor, prazo, prioridade, desafio de
  liderança, métricas de impacto (horas economizadas, redução de custo,
  outras), custos, ferramentas usadas, fase atual (kanban), arquivado.
- **Fase** — enum fixo de 6 estágios, com peso: Ideia do Projeto → Explorando
  a Solução → Testando a Solução → Usando na Rotina → Expandindo para Mais
  Pessoas → Concluído. Toda mudança de fase grava um registro de histórico.
- **Diário de bordo** — por projeto, entradas com título, descrição,
  aprendizados, ferramentas, tipo (manual/automático), evidências (imagens,
  vídeos, links externos).
- **Tarefas** — checklist simples por projeto (título, descrição,
  responsável, prazo, status).
- **Atividade** — feed de auditoria por projeto, gravado pela aplicação (não
  trigger SQL) a cada criação/edição/mudança de fase/tarefa.
- **Painel admin** — métricas agregadas (horas economizadas, redução de
  custo etc.) sobre os projetos.

No original, criar/editar projeto e mudar fase é restrito a `admin`; diário de
bordo e tarefas são abertos a qualquer membro autenticado.

## Restrição à EMR

Duas camadas, deliberadamente redundantes (reforço explícito do usuário, não
"config normal de feature por empresa"):

1. **Trava fixa no código.** `agent-service.ts` já tem o precedente exato: uma
   constante `EMR_SLUG = 'emr'` gateando o bloco de acolhimento emocional,
   documentada como provisória até existir uma camada de feature-por-empresa
   acima do bloco de setor. O módulo INOVA segue o mesmo padrão — uma
   constante equivalente (`INOVA_ALLOWED_COMPANY_SLUG` ou reaproveitando
   `EMR_SLUG` se for movida para um lugar compartilhado) checada no service,
   recusando qualquer empresa cujo `slug` não seja `emr`, **mesmo que** a
   config abaixo esteja ligada.
2. **Config por empresa**, para permitir desligar o módulo sem deploy: uma
   chave nova em `AppSetting` (`inova_module_enabled`), no mesmo
   `development-settings-service.ts` que já guarda `inovaCommunityUrl`/
   `inovaSupportUrl`. `inovaSupportUrl` continua existindo do jeito que está
   (link de suporte no Teams); `inovaCommunityUrl` deixa de ser lido pelo nav
   — quem decide se o item aparece agora é `inova_module_enabled` (e a trava
   de slug, sempre).

Ambas as camadas precisam ser verdadeiras para o módulo responder; a rota
retorna 403 tratado se qualquer uma falhar.

## Modelo de dados (Prisma, `apps/api/prisma/schema.prisma`)

Todos os models levam `companyId` (padrão do repo — mesmo sendo, na prática,
só a EMR quem usa, por causa da trava do slug):

- `InovaProject` — companyId, título, categoria, setor (texto livre),
  descrição, fase atual, métricas, custos, ferramentas, prazo, prioridade,
  desafio de liderança, representante do setor, responsáveis (texto livre,
  como o original — sem FK para `User`), arquivado, `createdById`.
- `InovaPhaseHistory` — projectId, fase, ocorrido em, nota.
- `InovaDiaryEntry` — projectId, título, descrição, aprendizados, ferramentas,
  tipo (manual/automático), ocorrido em, `imageUrls[]`, `videoLinks[]`,
  `externalLinks[]`, `createdById`.
- `InovaProjectTask` — projectId, título, descrição, responsável (texto
  livre), prazo, status.
- `InovaActivity` — projectId, ação, entidade, resumo, `actorId`, detalhes
  (Json), `createdAt`.

Fase é enum Prisma com os 6 valores fixos do original (sem emoji no valor do
enum — emoji fica só na apresentação do front, como convenção do repo).

Sem paginação nesta leva: volume baixo (é PMO de iniciativas, não feed), como
no original.

## Backend (`apps/api`)

- `src/routes/inova.ts` — CRUD de projeto, mudança de fase, tarefas, diário de
  bordo, listagem de atividade. Validação Zod em toda entrada, `400` em falha.
- `src/services/inova-service.ts` — regra de negócio:
  - Trava de empresa (slug `emr`) + `inova_module_enabled`, checadas em toda
    operação.
  - Criar/editar projeto e mudar fase: `ADMIN`/`SUBADMIN` da empresa.
  - Diário de bordo e tarefas: qualquer usuário autenticado da empresa.
  - Toda ação relevante grava `InovaActivity`; mudança de fase também grava
    `InovaPhaseHistory`.
  - Create/update de projeto dispara `postTeamsNotification` (best-effort,
    erro só loga — mesmo contrato de `lib/teams-client.ts`) para o webhook em
    `inova_teams_webhook_url` (chave nova em `AppSetting`, mesmo padrão de
    `development_thursday_teams_webhook_url` em
    `development-thursday-service.ts`), avisando G&G.
  - Erros de domínio em `InovaError` (classe tipada com `status` HTTP, padrão
    do repo).
- `src/routes/image-uploads.ts` ganha rota de presign para evidências do
  diário (`buildInovaDiaryKey(companyId, userId, contentType)`), reaproveitando
  as constantes de tamanho/tipo já existentes em `@legends/shared`
  (`IMAGE_MAX_BYTES`, `VIDEO_MAX_BYTES`). Sem guard de setor — aberto a quem
  tem o módulo habilitado (as duas camadas acima).
- DTOs, enum de fase e constantes (setores sugeridos, tipos de entrada) em
  `packages/shared/src/inova.ts` — contrato único api/web.

## Frontend (`apps/web`)

- `src/pages/inova/InovaBoardPage.tsx` — substitui o conteúdo de
  `ComunidadeInovaPage.tsx` na rota `/comunidade-inova`: kanban dos projetos
  por fase. É a nova tela de entrada do módulo.
- `src/pages/inova/InovaProjectFormPage.tsx` — criar/editar projeto (ação só
  visível para admin/subadmin).
- `src/pages/inova/InovaProjectDetailPage.tsx` — diário de bordo, tarefas,
  histórico de fase, atividade do projeto.
- Painel de métricas agregadas (sem chat de IA) embutido na board ou como
  aba — a decidir no plano.
- `nav-items.ts`: item "Comunidade INOVA" passa a depender de
  `inovaModuleEnabled` (novo campo do DTO de development settings), não mais
  da presença de `inovaCommunityUrl`.

## Testes

- API (Postgres real, padrão do repo): permissão de criar/editar projeto e
  mudar fase restrita a admin/subadmin; diário/tarefas abertos a qualquer
  membro; mudança de fase grava histórico + atividade; notificação Teams é
  best-effort; módulo responde 403 para empresa que não seja EMR mesmo com a
  config ligada; módulo responde 403 para EMR com a config desligada.
- Web: Testing Library para board/kanban, visibilidade condicional de ações
  por papel, formulário de projeto, página de diário.
- `packages/shared`: teste do enum de fase e dos DTOs.

## Fora de escopo (decisão do usuário, revisitar depois se necessário)

- Chat de IA analítica do painel admin.
- Allowlist de e-mails sincronizada de planilha do Google.
- Páginas institucionais do projeto original (Cultura, Trilhas, Explicação do
  Ranking, Responsabilidades, Como Usar) — candidatas a fundir com
  Manifesto/Manuais existentes, não a entrar como páginas novas.
