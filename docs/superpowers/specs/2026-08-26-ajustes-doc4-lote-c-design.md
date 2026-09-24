# Ajustes do Documento 4 — Lote C (Analytics de T&D) — design

**Origem:** `Ajustes_Portal_EMR_Documento_4.md` (G&G, 4ª rodada), seção 9.5.

Quarto lote do Documento 4, empilhado sobre o **Lote E** — a cadeia é
A → D → E → C. Não há sobreposição de arquivo com E; o empilhamento é só para
manter a fila de merge linear.

> "Os dados dos cursos e da usabilidade das páginas precisam alimentar o
> analytics de Treinamento e Desenvolvimento. Essa área ainda não existe e deve
> ser criada."

## Onde a área nasce

A OBS da seção diz que "a área administrativa de analytics passa a ter também a
trilha de **Desenvolvimento & IA**, ao lado de People Analytics e Comunicação
Interna". Comunicação Interna **não é uma tela própria**: é uma aba de
`/admin/pessoas`, que é a área de analytics. Então a trilha nasce onde a
vizinha dela já mora — uma aba **Treinamentos** na mesma seção.

Isso não é economia de trabalho, é o que a lista de filtros da própria seção
pede. Ciclo, De/Até e Setor **já existem** ali, valem para todas as abas ao
mesmo tempo e são exatamente os três primeiros filtros que o documento lista.
Uma tela nova teria de reconstruir os três, e eles divergiriam do resto do
painel no primeiro ajuste.

O que falta é o quarto: **Cargo**.

## Os filtros

| Filtro | De onde vem |
|---|---|
| Ciclo (todos os períodos) | `AnalyticsWindowRequest.range` — os atalhos que já existem |
| De / Até | `range: 'custom'` + `from`/`to`, que já existe |
| Setor | o seletor de setor da seção, já existente |
| **Cargo** | **novo** — `User.position` |

O Cargo entra como `?position=` na query, ao lado de `sectorId`, e vale **só**
para esta aba: os outros painéis não o oferecem, e acrescentá-lo a todos seria
mudar o contrato de quatro telas por causa de uma.

O catálogo de cargos não existe como tabela — `User.position` é texto livre. A
lista do seletor sai dos valores **distintos em uso** na empresa, o que é o
comportamento correto para um campo assim: cargo que ninguém tem não deveria
aparecer como filtro.

## Os números

Tudo recortado pela janela, pelo setor e pelo cargo. A **conclusão** é o fato
contado, e ela é datada por `CourseEnrollment.completedAt` — não por
`createdAt`: quem se inscreveu em janeiro e concluiu em agosto conta em agosto,
que é quando o treinamento aconteceu.

| Card | Como é contado |
|---|---|
| Treinamentos cadastrados | Cursos **publicados** da empresa. Não é recortado pela janela: o catálogo é um estoque, não um fluxo — "quantos treinamentos existem" não muda porque a pessoa filtrou julho. |
| Média de conclusões por colaborador | Conclusões na janela ÷ colaboradores **ativos** no recorte. Zero colaboradores devolve `0`, não `NaN`. |
| Obrigatórios finalizados (%) | Das inscrições em curso `mandatory`, quantas estão `COMPLETED`. |

E os dois blocos:

- **Conclusões por setor** — distribuição das conclusões da janela entre as
  áreas, pelo setor **da pessoa** que concluiu (e não do curso): a pergunta é
  qual área se desenvolveu, não qual área publicou o curso.
- **Cursos com mais conclusões** — curso, se é obrigatório, e quantas
  conclusões na janela.

### Duas decisões que mudam o número na tela

**"Obrigatórios finalizados" é sobre inscrição, não sobre pessoa.** A conta
natural seria "quantas pessoas concluíram todos os obrigatórios". Ela é mais
bonita e mais cara: exigiria cruzar cada colaborador com o catálogo obrigatório
que o alcança (curso tem `sectorId`), e um curso obrigatório publicado ontem
derrubaria o indicador da empresa inteira para perto de zero. A razão sobre
inscrições responde "o que foi começado está sendo terminado?", que é a
pergunta operacional da G&G.

**O percentual de obrigatórios ignora a janela.** É um estado, não um fluxo:
"70% dos obrigatórios estão finalizados" hoje. Recortá-lo por julho responderia
"das inscrições feitas em julho…", que ninguém pergunta.

## "Usabilidade das páginas"

A frase de abertura da seção cita dois insumos: os cursos **e** a usabilidade
das páginas. O segundo já existe e já está na tela: `AccessLog` alimenta
"Telas mais acessadas" na aba **Engajamento** da mesma seção. Duplicá-lo aqui
criaria dois números para a mesma coisa.

O que esta aba acrescenta sobre uso é o recorte de Aprendizado: nada novo é
instrumentado. **Instrumentação nova não entra neste lote** — se a G&G quiser
"quanto tempo a pessoa passou na aula", isso é evento novo e merece decisão
própria.

## O que este lote NÃO faz

- **Não cria** tabela de cargos. `User.position` continua texto livre.
- **Não instrumenta** evento novo de navegação nem de tempo em aula.
- **Não mexe** na Central de Cursos (seção 9.6) — é o Lote B.
- **Não** duplica "Telas mais acessadas", que já existe na aba Engajamento.

## Testes

| Área | O que trava |
|---|---|
| `training-analytics-service.test.ts` | conclusão datada por `completedAt`; recorte por setor e cargo; zero colaboradores não vira `NaN`; obrigatórios ignoram a janela |
| `people-analytics.test.ts` (rotas) | `?position=` filtra; subadmin continua preso ao próprio setor |
| `TrainingAnalyticsTab.test.tsx` | os três cards, os dois blocos e o filtro de cargo |

Sem migration: tudo é leitura do que já está no banco.
