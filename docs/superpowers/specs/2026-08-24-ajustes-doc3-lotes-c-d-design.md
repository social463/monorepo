# Ajustes do Documento 3 — Lotes C e D — design

**Origem:** `Ajustes_Portal_EMR_Documento_3.md` (G&G, 3ª rodada), seções 5, 4.8 e 13.

Fecha os dois lotes que sobraram depois de A e B. A ordem importa: a **seção 13**
(tags no Feed) é pré-requisito do filtro por categoria de comunicado da **4.8**.

Restam fora destes lotes: seção 8 (Agente de Benchmarking, esperando material da
G&G), seção 10 (identidade visual, agora desbloqueada) e seção 11 (convite por
nome no calendário, que não entrou em lote nenhum no fatiamento original).

## Lote C — Seção 5: regras de EMR Coins e Pontos

### O que o documento diz e o que o código mostra

> As telas de regras permitem apenas ativar, desativar e excluir regras já
> existentes. Não é possível editar os valores nem criar novas regras pela
> interface.

Três das quatro linhas do checklist **já estão prontas**:

| Linha do checklist | Situação real |
|---|---|
| Permitir editar regras de EMR Coins | **Falta** |
| Permitir inserir novas regras de EMR Coins | Já existe — botão "+ Adicionar regra", `POST /admin/coins/rules` |
| Permitir editar e inserir regras na aba de Pontos | Inserir já existe; editar falta |
| Refletir automaticamente as regras no Manual do Game | Já existe — `GameManualPage` lê `/xp/rules` e `/coins/rules` ao vivo |

A API tem CRUD completo desde sempre (`POST`, `PATCH`, `DELETE`), e o `PATCH`
aceita `amount`, `capWindow` e `capAmount`. O que falta é **só a tela**: a linha
da regra oferece Ativar/Desativar/Excluir, e o `PATCH` só é chamado com
`{ active }`.

### O que entra

Botão **Editar** por regra, abrindo a linha num formulário com **valor** e
**teto** (janela + quantidade) — os mesmos campos do formulário de criação, sem o
evento. Vale igual em `CoinsSection` e `XpSection`.

O evento não é editável, e isso não é limitação de tela: junto com a empresa, ele
é a identidade da regra (`@@unique([companyId, event])`) e é o que liga a regra à
ação que credita. Trocar o evento de uma regra existente seria apagar uma regra e
criar outra por baixo dos panos, com o extrato apontando para a errada.

### Sobre "Nome da regra: texto livre"

A tabela "Campos do cadastro de regra" pede nome livre. **Não dá**, e não é
teimosia de implementação: o crédito acontece quando o código emite um evento do
enum. Uma regra chamada "Participar da reunião de segunda" não seria creditada
por nada — nenhum ponto do sistema emite esse evento.

Os exemplos que o próprio documento dá ("Votar no período", "Publicar um
feedback", "Reagir a um comunicado") são, os três, rótulos de eventos que já
existem. O que a G&G enxerga como "nome" já é `COIN_EVENT_LABELS[event]`.

## Lote D — Seção 13: segmentação do Feed por tag

### Modelo

`CorporatePostTag`, no molde de `CalendarEventType` — que é o catálogo por
empresa que o repo já tem e que resolve o mesmo problema:

```prisma
model CorporatePostTag {
  id, name, slug, color, active, companyId
  @@unique([companyId, slug])
}
```

`CorporatePost.tagId String?` — **opcional**, e não obrigatório: todo comunicado
já publicado nasceria inválido, e o analytics precisa mesmo de um balde
"Sem categoria" para não mentir a distribuição.

Cor por tag, como no calendário: no filtro do topo do Feed as tags aparecem lado
a lado, e sem cor a lista vira sete pílulas cinzas indistinguíveis.

### Catálogo inicial

O documento cita dois conjuntos em lugares diferentes — Institucional,
Endomarketing, Benefícios e Eventos EMR (na 4.8) e Avaliação, Benefício e
Treinamento (na 13) —, e a OBS pede uma lista única. Consolidadas em **seis**,
com "Benefício"/"Benefícios" fundidos no singular do formulário:

Institucional · Endomarketing · Benefícios · Eventos EMR · Avaliação · Treinamento

Nasce como seed por empresa e a G&G edita em Administração — que é o que a OBS
pede ("sem depender do time de TI").

### Telas

- **Publicação**: seletor de tag no editor, ao lado do direcionamento por setor
  que já existe.
- **Feed**: filtro por tag no topo, em pílulas. O filtro é do **servidor**, não
  do cliente: o feed é paginado por cursor, e filtrar depois de paginar
  esconderia o comunicado que está na página seguinte — o mesmo motivo pelo qual
  a busca do Mural de Feedbacks é do servidor.
- **Administração**: CRUD do catálogo, no bloco de G&G. Tag é **desativada**,
  nunca apagada — apagar deixaria comunicados órfãos e sumiria com a série
  histórica do analytics, mesma regra de `RecognitionCategory`.

## Lote D — Seção 4.8: painel de Comunicação Interna

### Onde mora

Dentro da aba **Engajamento** de People Analytics, como a seção pede. Ele
**substitui** o bloco "Alcance do Feed Corporativo" que está lá hoje — é
exatamente o que o painel novo supera, e manter os dois seria a mesma
duplicidade que a seção 6 mandou desfazer.

### A telemetria já existe

O bloco ATENÇÃO da seção 4.8 diz:

> A tela atual registra que "não há telemetria de visualização por post". […] É
> necessário instrumentar o registro de visualização e leitura por publicação e
> por usuário antes de construir o painel.

**Está desatualizado.** O model `CorporatePostRead` (`@@unique([postId, userId])`)
grava quem leu cada comunicado, `POST /corporate-posts/:id/read` é chamado ao
abrir o post, e `getPostReach` já calcula alcance por post e por setor. A frase
que a G&G leu na tela era o subtítulo antigo do painel de Engajamento, que ficou
para trás. Não há instrumentação nova neste lote — o dado responde hoje, e
inclusive retroativamente.

### KPIs

| KPI | Definição |
|---|---|
| Taxa média de leitura | média de `leitores ÷ público-alvo` dos comunicados publicados na janela |
| Engajamento total | reações + comentários na janela |
| Comunicado mais lido | título + percentual de alcance |
| **Pontos distribuídos** | `XpTransaction` dos eventos de mural na janela |

O último KPI diverge do documento de propósito. A 4.8 pede "EMR Coins
distribuídas por interações no Mural/Comunicação", mas `CoinEvent` não tem
evento de mural nenhum — as ações do Feed pagam em **XP**
(`CORPORATE_POST_REACTION`, `CORPORATE_POST_COMMENT`, `CORPORATE_POST_READ_FULL`,
todos em `XpEvent`). O card em EMR Coins mostraria zero para sempre. Mostrar
Pontos é o número verdadeiro; se a G&G quiser coins no Feed, isso é decisão de
economia da Loja, não de painel.

O denominador da taxa de leitura é **por post**, não a empresa inteira:
`getPostReach` já faz assim, e com público-alvo por setor um "12 de 48" num
comunicado que só 8 pessoas podiam ler seria mentira.

### Gráficos

- **Linha** — leituras e interações por dia na janela.
- **Barras** — alcance por setor: percentual de cada setor que leu. É o que
  responde "quem está desengajado", que é o pedido literal da seção.
- **Rosca** — distribuição dos tipos de reação. O catálogo do mural tem 17
  emojis; o gráfico mostra os **seis mais usados** e agrupa o resto em "outras",
  senão a rosca vira uma roda de fatias de 1% sem leitura possível.
- **Tabela** — Top 5 comunicados por engajamento (leituras + reações +
  comentários).

### Insights

- **Melhor horário de envio** — agrupa os comunicados por dia da semana e faixa
  de hora da publicação e devolve a combinação com maior taxa média de leitura.
  Exige um mínimo de **três comunicados** naquela combinação; abaixo disso o
  "melhor horário" seria o palpite de um post só, e a tela diz que ainda não há
  base suficiente.
- **Alerta de baixo alcance** — setores sem nenhuma leitura, reação ou comentário
  de comunicado há mais de **15 dias**. O corte vem do documento.

### Filtros

Período (o `PeriodFilter` do Lote B, com personalizável), setor e **categoria de
comunicado** — que é a tag da seção 13, e é por isso que ela vem primeiro.

## Permissões

Nada muda:

| Tela | Quem |
|---|---|
| Regras de Coins e Pontos (editar) | ADMIN pleno — igual ao criar, que já era `adminOnly` |
| Catálogo de tags do Feed | Bloco de G&G |
| Escolher a tag ao publicar | Quem já pode publicar no Feed |
| Filtrar o Feed por tag | Qualquer pessoa que vê o Feed |
| Painel de Comunicação Interna | Bloco de G&G, como o resto de People Analytics |

## Pendências

1. **"Nome da regra" livre (5)** — não entregue; o vínculo é o evento. Se a G&G
   quiser renomear o que o colaborador lê, o caminho é um `label` opcional que
   sobrescreve o rótulo do evento, sem tocar no vínculo.
2. **EMR Coins no Feed (4.8)** — o KPI virou Pontos. Criar eventos de coin para o
   mural é decisão de economia da Loja.
3. **Tag retroativa (13)** — os comunicados já publicados ficam sem categoria. Se
   a G&G quiser classificá-los, é trabalho manual na tela de administração.
