# Comunicado dirigido à liderança — design

**Origem:** pedido da G&G sobre o Feed Corporativo — "adicionar as opções de
público Líder e Todos; a ideia é conseguir enviar comunicado para Líder ou para
todos".

## O que já existe e o que falta

O campo "Direcionar para o Setor" tem dois valores:

| Escopo | Alcance |
|---|---|
| `ALL` — "Toda a empresa" | todo mundo |
| `SECTORS` — "Setores específicos" | quem está nos setores marcados |

**"Todos" já existe** — é o `ALL`, rotulado "Toda a empresa" e já é o padrão do
composer. O que falta é um só: **a liderança**.

Hoje, para falar com os líderes, quem publica teria de marcar todos os setores
um a um — e ainda assim alcançaria o setor inteiro, não os líderes dele. Não há
recorte por papel.

## O escopo novo

`LEADERS`, rotulado **"Liderança"**. Alcança quem tem papel de liderança —
`LEAD`, `MANAGER`, `HEAD`, o mesmo `LEADER_ROLES` que já define a "visão de
líder" no resto do produto (humor do time, retrospectivas, área de Liderança).

Reusar `LEADER_ROLES` não é economia de código: é a garantia de que "líder" quer
dizer a mesma coisa em todo lugar. Uma segunda definição aqui faria o comunicado
alcançar um conjunto diferente do que a área de Liderança mostra.

**ADMIN e SUBADMIN ficam de fora do alcance**, e isso é deliberado: eles
administram a plataforma, não lideram ninguém no organograma — é a razão pela
qual já estão fora de `LEADER_ROLES`. Quem modera continua **vendo** todo
comunicado (`canModerateCorporatePost`), como sempre viu; o que não acontece é
receberem a notificação de um comunicado que não é para eles.

**Sem cruzamento com setor.** `LEADERS` é a liderança inteira da empresa, não a
liderança de um setor. O documento pede "enviar comunicado para Líder"; um
recorte por papel *e* por setor seria outra feature, e o composer não tem onde
expressá-la sem virar dois campos que se contradizem.

## Os cinco pontos que o escopo toca

Um escopo de público não é um campo: é uma regra que aparece em cinco lugares, e
esquecer um deles produz defeito silencioso.

1. **Visibilidade do feed** (`audienceWhere`) — o líder passa a alcançar o post
   `LEADERS`. Sem isto o comunicado não apareceria para ninguém.
2. **Notificação** (`notifyCorporatePostPublished`) — o sininho precisa recortar
   por papel, não por setor. `broadcastToActive` só sabia filtrar por setor;
   ganha um filtro de papéis.
3. **Resolução do público** (`resolveAudienceSectors`) — `LEADERS` não tem setor,
   como `ALL`. Sem isto, publicar exigiria escolher um setor que não significa
   nada nesse escopo.
4. **Denominador do alcance** (`getPostReach`) — a taxa de leitura de um
   comunicado da liderança é sobre os líderes, não sobre a empresa. Contra o
   total da empresa, um post lido por todos os líderes marcaria ~10%.
5. **Filtro do painel de Comunicação Interna** — recortar por setor precisa
   continuar trazendo o post da liderança, pelo mesmo motivo que já traz o de
   público `ALL`: ele alcança gente daquele setor.

## Migration

`ALTER TYPE "CorporatePostAudience" ADD VALUE 'LEADERS'`. Postgres 15 aceita
dentro de transação desde que o valor não seja usado no mesmo bloco — e não é.

Nada de backfill: o escopo é novo, nenhum post existente vira `LEADERS`.

## Permissões

Não muda quem publica. Quem já podia publicar no Feed escolhe o escopo, e o
recorte por papel não dá poder novo a ninguém — só direciona o que já era
publicável.

## O que fica de fora

**Contar quantos líderes serão alcançados no composer.** Seria útil ("este
comunicado vai para 12 pessoas"), mas exige uma consulta por mudança de escopo e
não foi pedido. Fica registrado.
