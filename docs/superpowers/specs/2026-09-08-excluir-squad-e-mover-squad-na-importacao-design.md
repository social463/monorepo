# Excluir squad, e a planilha movendo squad de setor

## Problema

Uma reorganização real bateu num beco sem saída. A squad "Receita" existia no
setor antigo; a planilha de colaboradores passou a colocar a gente dela no setor
novo ("RevOps"). O admin tentou, nesta ordem:

1. **mover a squad** pela tela — não conseguiu, porque o setor de destino ainda
   nem existia: quem ia criá-lo era a própria planilha, que não roda enquanto
   houver linha com erro;
2. **desativar a squad** para tirá-la do caminho — a importação passou a acusar
   `A squad "Receita" está desativada. Reative-a em Administração › Squads.`
   (`user-import-service.ts`, seção 6);
3. **reativar e excluir** — não há como. Não existe `DELETE /admin/squads/:id`.

E mesmo reativando, o passo seguinte é outro erro: `A squad "Receita" é do setor
"X"; esta pessoa está no setor "RevOps"`. A importação sabe **criar** squad, mas
nunca soube **mover** uma. Três becos em sequência, e a única saída era renomear
a squad na planilha — ou seja, inventar uma squad nova e abandonar a antiga
desativada para sempre, segurando o nome (`@@unique([companyId, name])`).

Os dois buracos são independentes e valem a pena separados:

- **squad não se exclui.** Desativar é o certo para uma squad que teve vida
  (retrospectivas, histórico); para uma squad criada por engano ou morta numa
  reorganização, desativar é lixo permanente ocupando nome e slug.
- **a planilha não move squad.** A planilha é fonte da verdade do organograma —
  ela cria setor, cria squad, move pessoa de setor. Não mover a squad junto com
  a gente dela é a única peça faltando, e é justamente a que aparece em toda
  reorganização.

## Entrega

### 1. Excluir squad

`DELETE /admin/squads/:id` e um botão **Excluir** ao lado de Desativar/Ativar em
Administração › Squads, com confirmação que diz quantos integrantes serão
desligados dela.

Recusa com 409 quando a squad tem **retrospectiva** ligada (`RetroRoomSquad`):
aí o histórico é real e o caminho é desativar. `SquadMember` cascateia — sair da
squad não apaga nada de ninguém.

### 2. A planilha move a squad de setor

Quando todas as linhas que citam uma squad existente apontam para um setor
diferente do atual, a importação **move a squad** junto, em vez de recusar. Isso
aparece na pré-visualização, em "Além das pessoas" — a mudança é revisada antes
de gravar, como o resto.

## Decisões

### A squad vai junto com a gente dela, ou não vai

Mover a squad só é honesto se **ninguém ficar para trás**. Um integrante que
continua no setor antigo ficaria numa squad de outro setor — exatamente o estado
que `addMember` recusa na tela (`user.sectorId !== squad.sectorId`) e que
`updateSquad` recusa para o líder. A importação não pode ser a porta dos fundos
para um estado que as outras duas barram.

Então, antes de mover, a importação confere **todo integrante ativo da squad no
banco** (não só quem está na planilha) mais o **líder**. Cada um deles precisa
terminar no setor de destino: ou porque a planilha o move para lá, ou porque já
está lá. Quem a planilha desliga não conta — está saindo. Se sobrar alguém, a
linha vira erro nomeando as pessoas, e o texto diz as duas saídas: incluir a
pessoa na planilha no setor novo, ou tirá-la da squad.

É um erro a mais que a versão antiga não dava — mas é o erro certo. O antigo
recusava **todo** movimento; este só recusa o movimento que deixaria a squad
rachada entre dois setores.

### Desativada continua sendo erro

A tentação era a importação reativar a squad desativada que a planilha cita.
Não: desativar é ato deliberado do admin, e a planilha vem de fora, com nome
digitado por gente. Reativar em silêncio desfaria uma decisão da tela por causa
de uma célula. O erro continua, com o mesmo texto — o que muda é que, depois de
reativar, o caminho agora **termina**, porque o setor diferente deixou de ser
beco.

### A planilha inteira decide o setor da squad, não a primeira linha

Antes, o conflito "a mesma squad em dois setores" só era detectado para squad
que a **própria planilha** estava criando; squad existente batia direto no erro
"é do setor X" e nunca chegava lá. Com o movimento, as duas situações viram a
mesma pergunta — *para que setor esta planilha está mandando esta squad?* — e a
resposta tem de ser única.

Por isso a seção 6 passa a acumular as linhas de cada squad (`squadClaims`)
antes de decidir. Duas linhas discordando é erro nas duas, com o mesmo texto que
já existia para squad nova. Uma squad, um setor.

### O `stuck` da seção 7 passa a olhar para onde a squad vai

A checagem que barra "mudar de setor enquanto é membro de squad do setor antigo"
continua — só deixa de disparar quando a squad em questão é uma das que estão
indo para o mesmo setor de destino da pessoa. Sem isso, o movimento que a seção
6 acabou de planejar seria recusado pela seção seguinte.

### `User.squad` não é mexido

O campo texto `User.squad` (editável à mão em Administração › Lendas, mostrado no
perfil e na busca) é rótulo livre, não o model `Squad`. Excluir uma squad não
apaga esse texto de ninguém: são conceitos vizinhos e independentes, e limpar
texto de perfil como efeito colateral de uma exclusão de catálogo seria surpresa.

### Excluir é do ADMIN e do SUBADMIN do próprio setor

Mesma regra do `PATCH /admin/squads/:id`: o SUBADMIN só enxerga e só mexe na
squad do setor dele, e recebe 404 (não 403) para as demais — é o padrão da rota
vizinha, que não confirma a existência de squad de outro setor.
