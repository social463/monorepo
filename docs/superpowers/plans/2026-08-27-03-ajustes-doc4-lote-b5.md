# Ajustes do Documento 4 — Lote B5 (público-alvo e matrícula automática)

**Spec:** `docs/superpowers/specs/2026-08-26-ajustes-doc4-lote-b-design.md`, sub-lote B5
(Documento 4, seção 9.2).

Empilhado sobre o **B4** (PR 11063), que é de quem ele depende.

## O que já existia

`Course.sectorId` restringia a **um** setor e `Course.mandatory` já era o toggle
"Curso obrigatório" que o documento pede — o Lote C já conta em cima dele.

## O que entra

### 1. A categoria do cargo, em `User` ✅

O campo que a G&G confirmou existir na planilha, em coluna própria: a lista
fechada (Auxiliar, Assistente, Analista…). **Não é derivável do título** —
`Desenvolvedor(a)` é Analista (14 pessoas), `Tech Lead` é Team Leader, `CAO` é
Diretor —, então vem importada.

`User.position` fica como está: o título completo, 80 valores distintos, que não
serve para segmentar.

A coluna nova entra **no fim** do template de importação. O casamento é por nome
de cabeçalho, então a posição não muda comportamento — mas anexar mantém a ordem
que quem já baixou o modelo conhece. (A primeira versão a inseriu no meio e
deslocou 44 testes, que é a demonstração prática do argumento.)

Valor fora da lista é recusado na prévia, dizendo quais valem: aceitar viraria
segmentação que nunca casa com ninguém — e sem erro visível, porque o curso
restrito sumiria de todo mundo.

### 2. Público-alvo do curso ✅

`Course.sectorId` continua sendo o setor **dono** — quem administra, e o recorte
que o SUBADMIN escreve. O que entra soma a ele:

| Campo | O que faz |
|---|---|
| `CourseAudienceSector` | outros setores que também enxergam |
| `audiencePositionCategories` | categorias de cargo que enxergam; vazio = todas |
| `recommendedFor` | **rótulo**, não restringe acesso |
| `autoEnroll` | matricula sozinho quem está no público |

Dono é um, público é vários — por isso `sectorId` continua singular. E
`visibleCourseWhere` era ponto único de visibilidade, então estender foi contido.

**Pegadinha registrada em três lugares** (schema, service e tela): curso restrito
por cargo fica **invisível** para quem está sem `positionCategory` — que é todo
mundo até a importação rodar com a coluna nova. É a mesma armadilha do
`managerId` com os painéis da Liderança, e é comportamento correto: quem não tem
o atributo não casa com a restrição. Tem teste.

### 3. Matrícula automática ✅

**O público-alvo É a regra.** O protótipo guarda um JSON de regras à parte
(`[{"setor":"Comercial"}]`), o que cria uma segunda definição de "quem" ao lado
do escopo de visibilidade — e duas definições divergem. Aqui existe uma só: quem
é matriculado é exatamente quem enxerga. Tem teste provando os dois lados juntos.

- **Idempotente** pelo `@@unique([userId, courseId])` com `skipDuplicates`: o
  tick roda de hora em hora e nunca duplica nem toca em quem já começou.
- **Em lote** de 200 — a importação de Lendas em HML já ensinou que transação
  longa estoura.
- **Só matricula, nunca desmatricula.** Quem muda de setor e sai do público
  mantém a inscrição: pode ter feito metade do curso, e apagar progresso por
  causa de um remanejamento é o pior tipo de automação.
- Roda no **save** do curso, além do tick: ligar a matrícula e só ver efeito no
  dia seguinte confundiria quem acabou de configurar.

### 4. Tela ✅

Bloco próprio no formulário do curso, separado por borda porque é o único que
muda **quem vê**. Com categoria de cargo marcada, aparece o aviso da pegadinha.

## Verificação

| Suíte | Resultado |
|---|---|
| `@legends/shared` | 784 ✅ |
| `@legends/api` | 3250, com as 8 falhas conhecidas de `TEAMS_NOTIFICATIONS_ENABLED=false` — verdes com a flag ligada |
| `@legends/web` | 2791, com 1 flake conhecido do `RoomAudioPlayer` — verde isolado |
| `tsc --noEmit` (api e web) | limpo ✅ |
