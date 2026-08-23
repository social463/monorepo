# Feedback de Compartilhamento de Tela — Design

**Data:** 2026-07-16
**Status:** Aprovado

## Objetivo

Hoje, quem compartilha a tela no escritório virtual não recebe nenhum feedback
visual disso — nem dentro da sala de reunião (o grid não inclui a própria
tela), nem andando pela área aberta do mapa (não existe UI alguma para tela
compartilhada fora de sala formal), nem fora do escritório (o PiP só mostra
câmeras). Esta feature fecha essas três lacunas, reaproveitando ao máximo a
infraestrutura de mídia já existente (LiveKit via `useOfficeMedia`).

## Decisões de produto

### 1. Dentro da sala de reunião (zona formal)

- O grid expandido (`MediaTiles`) passa a incluir também a **própria tela**
  do usuário quando ele está compartilhando, com o mesmo tratamento visual dos
  demais tiles: label "Tela de `<seu nome>`", podendo virar o tile em destaque
  se for a única tela ativa — não é um caso especial, é só mais uma fonte de
  tile no mesmo grid.

### 2. Área aberta do mapa (fora de sala formal)

- Compartilhar tela na área aberta já funciona no nível de transporte (LiveKit
  publica a track normalmente); falta só a UI. Quem está dentro do raio de
  proximidade de alguém compartilhando tela vê um **indicador clicável
  flutuante** próximo ao personagem dessa pessoa — um indicador por pessoa
  compartilhando (não agregado).
- O indicador **não pode sobrepor nem disputar espaço** com a bolha de câmera
  já existente acima do personagem (`CharacterVideoBubble`); posiciona-se ao
  lado/canto dela.
- O indicador não abre nada sozinho — só abre o grid quando clicado
  (diferente do comportamento dentro de sala, que auto-abre).
- Clicar abre o mesmo `MediaTiles`, mas:
  - **Sem** os painéis de chat (`RoomChatPanel`) e pessoas (`RoomPeoplePanel`)
    — não existe conceito de "sala"/roomId na área aberta hoje, e a feature
    não introduz um.
  - Tiles mostrados: a(s) tela(s) compartilhada(s) + câmeras de quem está
    dentro do raio de proximidade (a mesma lista já usada pela assinatura
    LiveKit via `applyProximity`) — sem tiles vazios de avatar
    (`showAllPresent=false`, mesmo comportamento que hoje já vale fora de
    sala).
  - Fechar o grid volta a andar pelo mapa normalmente (não desconecta nada).

### 3. PiP (fora do `/escritorio`, em outras páginas do app)

- Quando há uma tela compartilhada ativa (sua ou de alguém dentro do
  contexto de mídia atual), o PiP pequeno e arrastável passa a mostrar
  **essa tela no lugar do grid de câmeras**, mesmo tamanho/formato de janela
  de hoje, com label "Tela de `<nome>`".
- Sem tela compartilhada ativa, o PiP volta ao comportamento atual (grid de
  câmeras/avatares).

### 4. Destaque com múltiplas telas simultâneas

- Regra única, aplicada em todos os três contextos acima: quando mais de uma
  pessoa está compartilhando tela ao mesmo tempo, o destaque vai para quem
  **começou a compartilhar primeiro** (ordem cronológica de início, não
  ordem de chegada no array nem prioridade do usuário local).

## Arquitetura

### Expor a screen track local

`useOfficeMedia` (`apps/web/src/office/media/useOfficeMedia.ts`) hoje só
expõe `screenShareEnabled: boolean` para o próprio usuário — nenhuma
referência à `LocalVideoTrack` em si. Passa a expor também a track local de
tela (análogo ao que já existe para os remotos em `RemoteMedia`), capturada
via `LocalTrackPublished`/`LocalTrackUnpublished` filtrando
`Track.Source.ScreenShare` (o hook já escuta esses eventos para atualizar
`screenShareEnabled`/`screenShareError`).

### Ordem de início (destaque)

Nenhum lugar do código rastreia hoje *quando* cada compartilhamento começou —
o destaque em `MediaTiles.resolveFeatured()` pega a primeira tela encontrada
na lista, sem noção de tempo. Passa a existir um registro simples (mapa
`participantId -> timestamp de início`, populado nos eventos
`TrackPublished`/`LocalTrackPublished` de `Track.Source.ScreenShare` e limpo
no unpublish) em `useOfficeMedia`, exposto junto com `remotes`/tela local.
`MediaTiles`, o novo grid da área aberta e o `OfficePipWindow` usam esse
registro para decidir o destaque — mesma fonte de verdade nos três lugares.

### Área aberta: reaproveitar `MediaTiles` sem gating de sala

Hoje `OfficePage.tsx` restringe grid, auto-abertura, `roomOccupants` e
`roomId` do chat atrás de `inMeetingRoom`. Isso não muda para o fluxo de
sala formal. O que se adiciona é um **segundo estado de abertura do grid**,
independente de `inMeetingRoom`, acionado pelo clique no indicador flutuante:

- Mesmo componente `MediaTiles`, chamado com `roomPanel` sempre `null` (sem
  prop de abrir chat/pessoas disponível nesse modo) e `showAllPresent=false`.
- Tiles vêm de `media.remotes` (já filtrado por proximidade pela assinatura
  LiveKit existente) + tela local, sem depender de `roomOccupants`/`roomId`.
- Fechar volta ao estado de "andando pelo mapa" (mesmo botão/ícone
  `fullscreen_exit` já usado dentro de sala).

### Indicador flutuante na área aberta

Novo elemento, posicionado pelo mesmo mecanismo de
`useCharacterScreenPositions` que já posiciona `CharacterVideoBubble` (segue
as coordenadas de tela do sprite Phaser), mas como um badge separado e
menor, ancorado num canto da bolha de câmera existente (ou ao lado, quando
não há bolha de câmera) para nunca sobrepor. Renderizado para cada
`RemoteMedia` com `screenTrack` ativo (dentro da lista já filtrada por
proximidade) e para a tela local quando o próprio usuário compartilha (nesse
caso não teria motivo de "clicar para abrir" o próprio compartilhamento a
partir do próprio personagem — o indicador de tela local no HUD do próprio
personagem é opcional/decorativo; o gatilho de negócio é o indicador sobre
os *outros*). Clique chama o novo estado de abertura de grid da área aberta.

### PiP prioriza tela compartilhada

`OfficePipWindow.tsx` hoje monta até `MAX_TILES` tiles de câmera
(`cameraTrack`). Passa a checar primeiro se existe alguma `screenTrack` ativa
(local ou remota, via o mesmo registro de "quem começou primeiro"); havendo,
renderiza um único tile com essa tela (label "Tela de `<nome>`") no lugar do
grid de câmeras, mantendo tamanho/posição/arrastabilidade da janela como
hoje. Sem tela ativa, comportamento atual sem mudanças.

## Casos de borda

- Compartilhamento termina enquanto o grid da área aberta está aberto: o
  tile correspondente desaparece do grid (mesmo comportamento reativo que já
  existe hoje dentro de sala); se não sobrar nenhuma tela/câmera ativa, o
  grid fecha sozinho (mesma lógica de `hasVisible` já existente).
- Usuário sai do raio de proximidade de quem está compartilhando: o indicador
  some (a assinatura LiveKit já cancela a inscrição na track fora do raio) e,
  se o grid da área aberta estiver aberto, aquele tile some.
- Troca de "quem começou primeiro" nunca acontece dinamicamente: uma vez
  estabelecida a ordem de início, o destaque não pula de uma tela pra outra
  enquanto ambas continuarem ativas — só muda se a atual em destaque parar de
  compartilhar.
- Usuário entra numa sala de reunião formal enquanto o grid da área aberta
  está aberto (por estar andando com o grid aberto): mesmo tratamento que já
  existe hoje ao entrar em sala (`inMeetingRoom` passa a `true`), o grid
  simplesmente ganha os recursos de sala (chat/pessoas voltam a ficar
  disponíveis).

## Testes

Vitest + Testing Library (jsdom), arquivos colocados ao lado do código:

- `useOfficeMedia`: expõe track local de tela; registra timestamp de início
  de compartilhamento (local e remoto); limpa o registro no unpublish.
- `MediaTiles`: inclui tile da própria tela quando compartilhando; destaque
  segue ordem de início quando há múltiplas telas (não mais "primeira
  encontrada na lista").
- Novo componente do indicador flutuante da área aberta: aparece só quando
  há `screenTrack` de alguém dentro da proximidade; não aparece sobrepondo a
  bolha de câmera; clique abre o grid da área aberta.
- Grid da área aberta (via `MediaTiles` sem `roomPanel`): não renderiza
  botões de chat/pessoas; fecha automaticamente quando não sobra mídia ativa.
- `OfficePipWindow`: prioriza tile de tela compartilhada sobre câmeras
  quando existe uma ativa; label correta; volta a mostrar câmeras quando o
  compartilhamento termina.
