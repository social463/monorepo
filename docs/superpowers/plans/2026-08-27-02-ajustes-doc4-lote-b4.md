# Ajustes do Documento 4 — Lote B4 (catálogo da Central de Cursos)

**Spec:** `docs/superpowers/specs/2026-08-26-ajustes-doc4-lote-b-design.md`, sub-lote B4
(Documento 4, seções 9.6 — abas — e 9.7).

Empilhado sobre o **B3** (PR 11036): os dois mexem no `CoursesSection.tsx`.

## O problema

Categoria, competência e instrutor eram **texto livre na tabela de curso**:
`Course.category` era `String`, `Course.competencies` era um `Json` de strings e
o instrutor eram dois campos soltos. O efeito é o de sempre — e a HML já
mostrava: `"Liderança"` e `"liderança"` como duas categorias diferentes.

## Tarefas

### 1. Três models novos, com as regras do repo ✅

`CourseCategory`, `Competency` e `Instructor`, mais as ligações N:N
`CourseCompetency` e `CourseInstructor`.

- **Slug único por empresa** (`@@unique([companyId, slug])`), como `Badge.slug` e
  `Sector.slug`. E o slug **não** acompanha renomeação: é o identificador
  estável que a importação casa.
- **Desativa-se, não se apaga** — com curso atrás, excluir devolve 409 e o
  caminho é `active: false`.
- **N:N em tabela de ligação**, não array de FK: array não tem integridade
  referencial nem permite consultar "cursos desta competência".

### 2. Migration, com o texto convertido ✅

`20260827160000_catalogo_de_cursos`: tabelas nascem → o texto é convertido → as
colunas caem.

**Um bug apareceu ao testar o backfill com dado real, e vale registrar.** A
primeira versão agrupava por texto distinto, com um comentário afirmando que
colisão era impossível. Não é: `"Liderança"` e `"liderança"` são textos
diferentes que geram o **mesmo slug**, e o `INSERT` batia no índice único — que é
exatamente o problema que o catálogo existe para resolver. Cada passo passou a
agrupar **por slug**, elegendo a grafia mais usada.

O instrutor casa com um `User` de mesmo nome quando há **exatamente um**; com
dois homônimos ele nasce externo, porque escolher no chute ligaria o curso à
pessoa errada — e o vínculo é corrigível na tela.

Validado num banco descartável, semeado no formato antigo: as duas grafias
convergiram, o homônimo virou externo, e o instrutor com duas bios não duplicou
vínculo.

### 3. API ✅

`course-catalog-service.ts` com CRUD dos três, e as rotas geradas por um helper
(três recursos, uma forma). O curso passa a gravar `categoryId`,
`competencyIds` e `instructorIds`.

**Dois achados de teste que eram bugs de verdade:**

1. **Os models novos não estavam em `TENANT_SCOPED_MODELS`.** Sem isso, o
   `findFirst({ where: { id } })` do service alcançava a categoria de **outra
   empresa** — um vazamento entre tenants, pego pelo teste que tentava editar de
   fora.
2. **As opções de filtro do catálogo vazavam setor.** Ao trocar a origem das
   listas de "valores em uso nos cursos visíveis" para "catálogo inteiro da
   empresa", um teste existente falhou: ele garante que o nome da categoria de
   um curso de outro setor não aparece. Voltaram a sair dos cursos visíveis — o
   que também evita oferecer um filtro que não devolveria nada.

De quebra, o filtro por competência **saiu da memória e foi para o `where`**:
como agora é relação, o banco resolve. A busca livre também.

### 4. Telas ✅

`CourseCatalogTabs.tsx` — três abas com a mesma casca (lista, criação, desativar,
excluir). O **contador de cursos** fica ao lado do excluir de propósito: é ele
que explica o 409 antes de a pessoa tentar.

No formulário do curso, os três campos de texto viraram escolha do catálogo. O
`CatalogPicker` mostra a **posição** dos instrutores, porque a ordem importa — o
primeiro é o principal e é o que vai no card.

Item desativado some das escolhas novas, mas **continua listado no curso que já o
usa**: desativar não pode reescrever o que já estava lá.

Criar curso deixou de exigir categoria — exigi-la obrigaria a abrir a aba de
Categorias antes de conseguir criar o primeiro curso.

### 5. Seed ✅

Cadastra categoria, competência e instrutor antes de ligar, na mesma ordem que a
migration usa.

## O que NÃO entra

- **Aba de Modelos e a de Solicitações** (9.8): são do B2.
- **Recompensa por curso, status em cinco estados e o wizard** (9.6, resto): são
  do B6, que depende deste.
- **Foto do instrutor por upload**: o campo existe (`photoUrl`), mas a tela só
  aceita URL. O documento não pede upload, e o interno já herda a foto do
  colaborador.

## Verificação

| Suíte | Resultado |
|---|---|
| `@legends/shared` | 784 ✅ |
| `@legends/web` | 2791, com 2 flakes conhecidos de carga (verdes isolados) |
| `@legends/api` | ver PR |
| `tsc --noEmit` (api e web) | limpo ✅ |
