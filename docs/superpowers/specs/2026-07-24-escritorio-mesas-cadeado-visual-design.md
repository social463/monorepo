# Tasks 22046 e 21922 — mesa do escritório, cadeado e visual

**Data:** 2026-07-24
**Status:** proposto

## Contexto

A feature de mesas reivindicáveis já existe: o mapa tem uma layer reservada
`desks`, cada objeto `desk` vira uma `OfficeDesk` na publicação ativa, e o
usuário pode reivindicar uma mesa livre. O cadeado de sala, porém, ainda é
efêmero e coletivo: qualquer pessoa dentro de uma sala de reunião pode trancar
ou destrancar.

## Task 22046 — dono da mesa controla o cadeado da sala da mesa

Quando uma sala de reunião contém uma mesa reivindicada, só o dono dessa mesa
pode trancar ou destrancar a sala pelo cadeado da sessão. A associação entre
mesa e sala segue a geometria do mapa: uma mesa pertence à sala cujo retângulo
ou polígono contém o centro da mesa.

Salas sem mesa reivindicada continuam com o comportamento atual: qualquer pessoa
dentro da sala pode trancar ou destrancar. Salas bloqueadas pelo admin continuam
fora do cadeado efêmero.

## Task 21922 — melhorar visual da layer de mesa padrão

A layer de mesas no runtime hoje aparece como um retângulo translúcido laranja.
O objetivo é deixá-la visualmente parecida com uma mesa de escritório mesmo
quando não há asset decorativo publicado por cima: tampo, sombra, cadeira e
marcador discreto de status/ocupante, mantendo clique e hover no mesmo hitbox.

## Mapa local/default

Para facilitar teste local, o mapa legado/default precisa ter ao menos uma mesa
publicada dentro de uma sala de reunião. Essa mesa deve aparecer no `GET
/office/map`, poder ser reivindicada e, depois de reivindicada, passar a limitar
o cadeado daquela sala ao dono.

## Critérios de aceite

- Usuário que reivindicou uma mesa dentro de uma sala pode trancar e destrancar
  essa sala.
- Outro usuário dentro da mesma sala com mesa reivindicada não consegue mexer no
  cadeado.
- Sala sem mesa reivindicada preserva a regra antiga: qualquer ocupante pode
  mexer no cadeado.
- O botão de cadeado no frontend só fica habilitado para quem pode executar a
  ação.
- O mapa default/local tem uma mesa reivindicável.
- A mesa renderizada no escritório deixa de parecer só um overlay retangular.
