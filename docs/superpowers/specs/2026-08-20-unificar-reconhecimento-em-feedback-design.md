# Unificar reconhecimento em feedback — Design Spec

- **Data:** 2026-08-20
- **Autor:** lucca.secco
- **Status:** em implementação

## Resumo

Hoje o produto tem **dois vocabulários paralelos para a mesma coisa**:

| | Reconhecimento | Feedback |
|---|---|---|
| Entidade | `Vote` (+ `VoteCategory`) | `Feedback` (+ `FeedbackRecognitionCategory`) |
| Catálogo | `Category` (slug, setor, 9 linhas na EMR) | `RecognitionCategory` (13 competências da G&G, por empresa) |
| Onde escreve | `/votar` — "Faça seu reconhecimento" | `/mural-feedbacks` e o perfil |
| Onde aparece | aba **Reconhecimentos** do perfil | aba **Feedbacks** do perfil |
| Administração | Administração › Categorias | Administração › Reconhecimento |
| Selos | `CATEGORY`, `IMPACT`, `RECURRENCE` contam **voto** | `FEEDBACK` conta feedback **escrito** |

Duas telas para escrever a mesma frase sobre um colega, dois catálogos de
categoria para dizer a mesma coisa, e um perfil com um seletor para alternar
entre as duas listas. A entrega funde tudo em **feedback**:

1. **Um catálogo só.** `Category` é aposentado; o catálogo administrável da G&G
   (`RecognitionCategory`) passa a valer para o voto também, e ganha `slug`
   (que os selos de categoria e os ícones já usavam).
2. **Voto vira feedback.** O texto do voto é materializado como `Feedback` do
   votante para o votado. Votos antigos são migrados; os novos passam a nascer
   junto.
3. **Selos por feedback recebido.** `CATEGORY`, `IMPACT` e `RECURRENCE` deixam
   de contar voto e passam a contar **feedback recebido**. Nenhum selo é
   aposentado e nenhum selo já concedido é revogado.
4. **A aba Reconhecimentos do perfil some.** Sobram os selos e os feedbacks.
5. **A palavra "reconhecimento" sai das telas.** Fica "feedback" em toda copy
   voltada ao usuário e nas rotas de administração.

## Decisões

### 1. O catálogo que sobrevive é o da G&G

A pergunta era qual das duas tabelas morre. Fica `RecognitionCategory`:

- é **provisionado por empresa** (`provisionRecognitionCategories`), enquanto
  `Category.slug` é `@unique` global — dois clientes não conseguiriam ter
  "Liderança" cada um. Migrar as competências para lá exigiria antes consertar
  o índice;
- é o que a G&G já administra como vocabulário oficial;
- `Category` tem 9 linhas na EMR, todas `global`, e **zero** `CategorySector` —
  o recorte por setor existe no código e nunca foi usado.

O preço: o catálogo unificado não tem recorte por setor. Se um cliente quiser
categoria só de um setor, isso volta como `RecognitionCategorySector`, espelhando
o que `Category` tinha. Nada no banco de hoje depende disso.

As 9 categorias de voto são **migradas** para o catálogo (nome, slug e
descrição), então os 27 selos `CATEGORY` continuam apontando para um slug que
existe.

### 2. O feedback do voto nasce **junto com o voto**

> Revisto depois da primeira implementação. A entrega original materializava na
> publicação do destaque, preservando o embargo do voto; a decisão do produto foi
> soltar. O texto abaixo é o comportamento final.

`createVote` grava voto e `Feedback` na **mesma transação**: quem recebeu vê no
perfil na hora, com a votação ainda aberta. O raciocínio é o da unificação —
aquilo é feedback, e feedback não espera fechamento de mês para chegar em quem
recebeu.

O que continua embargado é **quem foi o Destaque do Mês**: a apuração
(`winnerId`) só sai na publicação, e o aviso da publicação fala do quadro do mês,
não de "seus reconhecimentos". O preço aceito é que, somando os feedbacks
visíveis, dá para adivinhar a apuração antes da hora — o produto trocou esse
sigilo pela chegada imediata do feedback.

`materializeVoteFeedbacks(periodId)` continua existindo, na publicação, como
**rede de segurança**: pega os votos anteriores a essa mudança e qualquer linha
que tenha escapado. Idempotente por `Feedback.voteId` (único). A migração de
dados materializou só os votos de períodos já publicados; os demais entram por
ela quando o período publicar.

### 3. Selos: o que cada kind conta agora

| Kind | Antes | Agora |
|---|---|---|
| `CATEGORY` | votos recebidos na categoria (período publicado) | **feedbacks recebidos** na categoria de mesmo `slug` |
| `IMPACT` | total de votos recebidos | **total de feedbacks recebidos** |
| `RECURRENCE` | meses distintos com voto | **meses distintos com feedback recebido** |
| `FEEDBACK` | feedbacks escritos | inalterado (é sobre dar, não receber) |
| `TENURE` / `STREAK` / `COURSE` / `PDI` / `HIGHLIGHT` | — | inalterados |

A avaliação passa a rodar **na criação do feedback**, para cada destinatário —
inclusive no voto, que agora cria o feedback junto (decisão 2) —, e de novo na
publicação do destaque, depois da rede de segurança. `publishedVoteWhere` deixou
de existir: não há mais leitura de voto que precise do filtro.

Efeito colateral aceito: quem recebe muito feedback fora da votação passa a
ganhar selo de `IMPACT`/`CATEGORY` sem depender do ciclo mensal. É o ponto da
mudança — o selo passa a medir o que o time diz da pessoa, não o que a apuração
do mês diz.

### 4. Voto continua existindo

Só o **texto** vira feedback. `Vote` continua sendo o que elege o Destaque do
Mês, alimenta ranking, People Analytics e a apuração.

`/votar` continua sendo a tela de **votar no Destaque do Mês** — um voto por
pessoa, por período. O que mudou ali é o vocabulário: o campo do "porquê" é um
**feedback** (que chega em quem recebeu na hora, decisão 2) e as categorias vêm
do catálogo unificado. Feedback solto, sem voto, continua sendo o mural e o
perfil, a qualquer momento — não é o que essa tela faz.

### 5. O que acontece com a aba "Reconhecimentos" do perfil

Some, com o seletor. O que ela mostrava (justificativa + categorias + mês) passa
a estar na lista de feedbacks, porque o voto virou feedback. Os dois blocos
vizinhos continuam, relidos por feedback:

- "Impacto acumulado" → feedbacks recebidos, meses com feedback, selos;
- "Categorias reconhecidas" → **"Categorias dos feedbacks"**, agora agrupando
  `FeedbackRecognitionCategory` em vez de `VoteCategory`.

## Migração de dados

Uma migration, nesta ordem, tudo em transação:

1. `RecognitionCategory` ganha `slug` e `description`; `@@unique([companyId, slug])`.
   Backfill de `slug` por slugify do nome.
2. Para cada `Category`, garantir uma `RecognitionCategory` da mesma empresa com
   o mesmo **nome** (case-insensitive); quando faltar, criar com nome, slug e
   descrição da `Category`. Quando já existir (ex.: "Inovação", "Comunicação"),
   o slug da `Category` prevalece — é o que os selos `CATEGORY` referenciam.
3. `VoteCategory.categoryId` é repontado para a `RecognitionCategory`
   equivalente e a FK passa a apontar para lá.
4. `Feedback.voteId` (nullable, único) + FK para `Vote`.
5. Materializar `Feedback` para todo voto de período **publicado**:
   autor = votante, alvo = votado, mensagem = justificativa, `category = 'ELOGIO'`,
   `createdAt` = data do voto, `sharedAt = NULL` (privado — publicar 25 votos
   antigos no mural de uma vez seria spam), `FeedbackRecipient` do alvo e
   `FeedbackRecognitionCategory` das categorias do voto.
6. `DROP TABLE CategorySector, Category`.

## Fora de escopo

- Renomear `RecognitionCategory`/`FeedbackRecognitionCategory` no banco e no
  código. A decisão foi trocar copy e rotas de administração; renomear modelo é
  outra migration e outro diff.
- Recorte de categoria por setor (ver decisão 1).
- Mexer na apuração do Destaque do Mês, no ranking ou no People Analytics.
