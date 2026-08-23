# Escritório — karts posicionáveis e interação por proximidade

**Data:** 2026-07-30
**Status:** aprovado
**Branch:** `sala-de-voz-math.random-kart`
**Work item:** `#22253`

## Problema

O primeiro incremento do kart liga/desliga a montaria com a tecla `K` em
qualquer ponto do mapa. O veículo surge sob o personagem sem existir antes no
escritório, portanto não se comporta como o kart do Gather nem como os demais
assets do editor.

## Experiência

- A paleta de mobília ganha a categoria `Veículo` e o asset `Kart vermelho`.
- Editores podem colocar, mover, girar, apagar e publicar qualquer quantidade
  de karts com o mesmo fluxo dos demais assets atômicos.
- Fora da edição, um kart estacionado mostra a dica `Aperte E para dirigir`
  quando o usuário está no próprio tile ou em um dos oito tiles vizinhos.
- `E` monta no kart livre mais próximo. Enquanto montado, a dica muda para
  `Aperte E para estacionar`.
- Se houver também um link ao alcance, o kart tem prioridade sobre a ação do
  link para que uma única tecla nunca dispare duas interações.
- Ao estacionar, o kart permanece na posição e direção atuais.

## Asset e mapa

O kart entra no catálogo nomeado como um `tile-object` de uma célula, com
variantes builtin de 16, 32 e 48 px. A categoria `Veículo` não cria colisão
estática pareada: a ocupação muda durante a sessão e é validada pelo hub.

O helper compartilhado identifica karts pelo `assetId`
`builtin:office/kart-<tileSize>` e converte os objetos publicados em estados
iniciais `{ id, x, y, dir }`. A rotação do `tile-object` define a direção
inicial.

## Estado de runtime

`OfficeKart` é efêmero e autoritativo no `OfficeHub`:

```ts
interface OfficeKart {
  id: string
  x: number
  y: number
  dir: Direction
  riderUserId?: string
}
```

`OfficeOccupant.ridingKartId` aponta para o veículo em uso. O `welcome` carrega
o snapshot de karts; `kart-ride` sincroniza montar/estacionar; `karts-updated`
substitui o conjunto quando uma publicação de decoração adiciona ou remove
veículos.

Ao mover ou girar um piloto, o hub atualiza o estado do kart. Um kart
estacionado bloqueia movimento no próprio tile e não pode ser ocupado por duas
pessoas. Desconexão definitiva estaciona o veículo na última posição do
usuário; reconexão dentro do período de graça preserva a montaria.

## Renderização

O `tile-object` continua sendo a âncora editável do mapa. Em runtime, a cena
renderiza o mesmo sprite na posição dinâmica do `OfficeKart`; durante edição,
mostra a posição publicada para que arrastar e girar editem o ponto inicial, não
o estacionamento efêmero da sessão.

O personagem montado mantém o recorte e os offsets direcionais já calibrados.
O atalho global `K` e o spawn remoto de kart são removidos.

## Testes

- catálogo/tilesets: variantes e categoria canônica;
- runtime compartilhado: extração de posição e rotação dos karts;
- hub: proximidade, exclusividade, movimento, estacionamento, welcome,
  desconexão e publicação;
- bridge/socket: redução e replay dos snapshots;
- hook/UI: prioridade sobre links, `E` e textos das duas ações;
- cena: parked/mounted, posição dinâmica e modo de edição;
- build completo do monorepo.

## Fora de escopo

Persistir no banco onde um kart foi estacionado, combustível, dano, corrida,
passageiros, cores adicionais e controles analógicos.
