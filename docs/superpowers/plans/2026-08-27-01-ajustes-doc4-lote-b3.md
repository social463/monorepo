# Ajustes do Documento 4 — Lote B3 (blocos empilháveis na aula)

**Spec:** `docs/superpowers/specs/2026-08-26-ajustes-doc4-lote-b-design.md`, sub-lote B3
(Documento 4, seção 9.1).

Primeiro sub-lote do Lote B a sair. Empilhado sobre a branch do spec
(`docs/ajustes-doc4-lote-b-spec`, PR 11029), com `origin/main` mesclado por dentro:
a branch do spec nasceu antes do Lote C entrar, e continuar sobre ela sem
sincronizar era construir em cima de base velha.

## O problema

> "Não há opção de mesclar tipos de conteúdo dentro da mesma aula. Por exemplo,
> não é possível colocar um texto e, logo abaixo, uma imagem — o editor aceita
> apenas um formato por aula."

Confere, e o modelo explicava: `CourseLessonType` tinha dois valores, e a aula
guardava `videoUrl` **e** `contentHtml` com a tela escolhendo qual campo
mostrar. Um formato por aula, literalmente.

## Tarefas

### 1. O formato do bloco, no contrato compartilhado ✅

`packages/shared/src/course-lesson-block.ts` — catorze tipos, com o payload de
cada um saído da fonte do protótipo. O schema **Zod** mora aqui porque é o mesmo
que a rota usa para validar e que o web usa para tipar; `@legends/shared` já
depende de `zod`, então não houve dependência nova.

Três coisas que o módulo resolve além dos tipos:

- **`isSafeBlockUrl`** — allowlist de `http`/`https`. O renderer é React e não
  injeta marcação, mas `href` e `src` aceitariam `javascript:` e `data:`, e aí o
  clique do aluno vira execução. URL vazia passa: é bloco em edição.
- **`parseCourseLessonBlocks`** — leitura tolerante. `contentBlocks` é `Json`, e
  bloco que não casa com o formato é descartado em vez de derrubar a aula
  inteira do aluno.
- **`lessonKindOf`** — o formato da aula deixou de ser coluna e virou derivação.
  Uma aula com vídeo E texto não cabia numa coluna sem escolher uma mentira; o
  vídeo manda, porque é o que muda como a pessoa consome a aula.

### 2. Migration, com o conteúdo publicado convertido ✅

`20260827100000_blocos_empilhaveis_na_aula`. A ordem importa: coluna nova →
backfill → só então as velhas caem.

`CourseLesson.contentBlocks Json @default("[]")`; `type`, `videoUrl` e
`contentHtml` saem, e o enum `CourseLessonType` é dropado junto.

O backfill vira cada aula numa aula de um ou dois blocos, **vídeo antes de
texto** — que era a ordem do editor antigo. A origem do vídeo sai da URL
(youtube/vimeo/loom, e `upload` para o resto).

Validado num banco descartável: a cadeia inteira aplica, e a expressão do
backfill foi conferida caso a caso (YouTube, Vimeo, Loom, arquivo direto, só
texto, e a linha em branco que vira `[]`).

**Sobre o `contentHtml`:** o nome é herdado. O campo era um `<textarea>` cru, e o
que está gravado na HML é texto com quebras de linha, sem marcação — vira bloco
de texto, renderizado com `whitespace-pre-wrap`. Se alguma aula tiver HTML
colado, as tags aparecem literais: visível e corrigível no editor novo, ao
contrário de sumir em silêncio.

### 3. API ✅

- `serialize-learning.ts` e `course-admin-service.ts` passam a devolver `blocks`,
  lidos por `parseCourseLessonBlocks`.
- A escrita **regrava a lista inteira**: o editor manda o documento da aula, não
  um patch de bloco. `[]` é apagar o conteúdo, e é intenção legítima.
- `routes/courses-admin.ts` valida com `courseLessonBlocksSchema`.

Teste novo em `courses-admin.test.ts`: a rota recusa (400) bloco com
`javascript:` na URL — é o que prova que a rota usa o schema, e não só que o
schema existe.

### 4. Editor de blocos (admin) ✅

`apps/web/src/pages/admin/CourseBlockEditor.tsx`, ligado no `LessonForm` do
`CoursesSection.tsx`.

**A ordem se muda por botão, não por arrasto.** O protótipo usa `@dnd-kit`; o
repo não tem lib de drag, e não vale trazer uma por causa desta tela — mover por
↑/↓ chega ao mesmo lugar, funciona no teclado sem nada a mais e sobrevive ao
leitor de tela.

Imagem, PDF, anexo e vídeo por upload sobem pela rota que já existe
(`/uploads/media/presign`, via `uploadFeedMedia`): mesma allowlist, mesmos
limites e o mesmo `kind` derivado no servidor. Rota nova só duplicaria isso.

O bloco de Quiz lista os quizzes do curso e guarda o id — não duplica o
`CourseQuiz`, que é o que evitaria duas notas para a mesma aula.

### 5. Renderização para o aluno ✅

`apps/web/src/pages/learning/LessonBlocks.tsx`, no `CoursePlayerPage`.

**Sumiu um `dangerouslySetInnerHTML`.** O `contentHtml` era injetado como
marcação; o bloco de texto é texto. A superfície de XSS da aula deixou de
existir, e o que sobrou de risco (`href`/`src`) está fechado pela allowlist de
protocolo.

O PDF é embutido direto no `<iframe>`, que o navegador renderiza nativamente —
o protótipo usa o visualizador do Google, que mandaria a URL do material da
empresa para fora.

O checklist é marcável, mas o estado é **da sessão do aluno**: não volta para a
API nem conta progresso. Quem conta progresso continua sendo concluir a aula.

### 6. Seed ✅

`learning-seed-content.ts` monta as aulas em blocos, na mesma ordem que a
migration usa — seed e dado migrado saem iguais. Ids de bloco derivados do
título, para o seed rodar de novo sem inventar bloco novo.

## O que NÃO entra

- **O tipo `audio`.** Existe no union da fonte do protótipo, com renderer, mas
  fora do menu — dá para renderizar, não dá para criar. O documento lista
  catorze e são esses catorze. Implementar sem pedido seria inventar escopo.
- **Arrastar para reordenar.** Ver a tarefa 4.
- **B1 (colagem com formatação).** O bloco de texto herda o que o B1 resolver;
  como ele ainda não saiu, o bloco é `<textarea>` por ora — que é exatamente o
  que a aula já tinha, sem regressão.

## Verificação

| Suíte | Resultado |
|---|---|
| `@legends/shared` (completa) | 779 testes ✅ |
| API — learning, courses-admin, quiz, sector | 141 testes ✅ |
| Web — learning + editores de curso | 55 testes ✅ |
| `tsc --noEmit` (api e web) | limpo ✅ |
