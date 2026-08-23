# Escritório — ordem de camadas da mobília

**Data:** 2026-07-30
**Status:** aprovado
**Branch:** `feat/escritorio-ordem-camadas`

## Problema

A mobília do editor in-place é empilhável, mas a ordem visual só é definida no
momento da colocação: o último grupo acrescentado a `document.objects` aparece
por cima. Para inserir um tapete sob uma mesa já decorada, hoje é necessário
apagar a mesa, colocar o tapete e reconstruir a composição.

## Escopo

Adicionar à barra flutuante da mobília selecionada quatro ações:

1. subir uma camada;
2. trazer para a frente de tudo;
3. descer uma camada;
4. enviar para trás de tudo.

As ações operam sobre o grupo inteiro de mobília. Um asset fatiado em vários
`tile-object` continua atômico, assim como nas operações de mover, girar,
espelhar e apagar.

## Modelo e ordenação

Não há mudança de schema. A ordem dos `tile-object` no array
`MapDocumentV1.objects` já é a ordem de desenho dentro de uma layer visual.

Uma função pura em `decorationDoc.ts` reordena os grupos:

```ts
reorderFurnitureGroup(
  doc,
  groupKey,
  direction: 'forward' | 'front' | 'backward' | 'back',
): { doc: MapDocumentV1; changed: boolean }
```

- `forward` troca o grupo com o próximo grupo visual.
- `backward` troca com o grupo visual anterior.
- `front` move para o fim da ordem visual.
- `back` move para o início.
- Só entram grupos de `tile-object` na mesma `layerKey`.
- Todos os slices do grupo se movem juntos e mantêm sua ordem interna.
- Objetos não visuais, inclusive a colisão pareada, mantêm posição e conteúdo.
- Operação na extremidade ou grupo inexistente é no-op e preserva a referência
  do documento.

## Preview no Phaser

Salvar já redesenha a decoração na ordem do documento, mas a mudança precisa
ser visível imediatamente. A `OfficeScene` ganha uma operação que recebe os ids
visuais em ordem, normaliza sprites publicados e estampas pendentes para o
`zIndex` da layer e reorganiza o display list de baixo para cima.

O hook chama essa sincronização depois da reordenação e depois de girar ou
espelhar, para uma transformação posterior não voltar a estampa selecionada
artificialmente para o topo.

## Merge colaborativo

O endpoint de save usa `mergeDecoration(base, mine, theirs)`. O merge anterior
comparava objetos apenas por conteúdo e reconstruía o array na ordem de
`theirs`, portanto uma mudança exclusiva de ordem seria descartada.

O merge passa a detectar, por layer visual, quando `mine` diverge da ordem
canônica (objetos sobreviventes de `base`, seguidos por objetos novos). Só
nessas layers ele reaplica a ordem de `mine` aos objetos conhecidos pelo
editor. Objetos adicionados simultaneamente em `theirs` são preservados nos
próprios slots, sem serem removidos ou arbitrariamente reordenados.

## UI e permissões

Os quatro botões ficam na `SelectionToolbar`, separados das transformações de
orientação. Reordenar não altera autoria nem conteúdo e segue a mesma garantia
da seleção atual: usuários comuns só chegam a grupos que já passaram pela
checagem de proteção de estruturas do admin.

## Testes

- `decorationDoc.test.ts`: um nível para frente/trás, extremos, grupo fatiado,
  colisão pareada e isolamento por layer.
- `useOfficeMapEditing.test.ts`: ação suja a sessão, entra no undo, persiste no
  payload de save e sincroniza a cena; no-op não cria histórico.
- `SelectionToolbar.test.tsx`: os quatro controles acessíveis disparam a direção
  correta.
- `OfficeScene.test.ts`: a sincronização usa o sprite pendente quando existe,
  restaura o depth da layer e respeita a ordem recebida.
- `office-map-decoration.test.ts`: o merge persiste a ordem, preserva adições
  concorrentes e não sobrescreve uma reordenação exclusiva de outro editor.

## Fora de escopo

Reordenar tile layers estruturais, mover mobília entre layers diferentes,
alterar colisões ou criar um painel geral de layers.
