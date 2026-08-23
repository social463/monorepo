# Escritório — volume local por usuário na sala

## Problema

Dentro de salas do escritório, todos os participantes remotos chegam com o
mesmo volume. Quando alguém está alto demais, o usuário precisa conseguir
reduzir só aquela pessoa sem afetar a própria saída de áudio nem o volume dos
demais.

## Escopo

**Dentro:** controle local `0-100%` por usuário remoto; persistência em
`localStorage` para sobreviver a reload e troca de sala; slider no card do
personagem; slider nos tiles remotos da grade expandida; aplicação no áudio de
microfone remoto, áudio espacial do espaço aberto e áudio de tela compartilhada
do mesmo usuário.

**Fora:** persistência no backend; sincronização entre navegadores; controle de
volume para o próprio usuário; mudança no protocolo LiveKit/WS.

## Decisões

- A preferência é local para quem ajusta, indexada por `userId`.
- Valor padrão: `100%`; `0%` funciona como mute local daquele usuário.
- O controle usa o ícone Material Symbols de volume e um slider acessível com
  `aria-label="Volume de <nome>"`.
- O áudio do broadcast/alto-falante não entra nessa preferência, porque não é
  áudio de um usuário remoto individual.
- A preferência é best-effort: falha de `localStorage` não quebra o escritório.

## Pontos de implementação

- Hook `useRemoteUserVolumePreferences` no provider da sessão do escritório.
- `RemoteAudio` recebe `volume` e aplica no elemento `<audio>`.
- O grafo de áudio espacial recebe `setUserVolume()` e multiplica o ganho de
  distância pelo volume local.
- `MediaTiles`, `RoomPeoplePanel` e `CharacterCard` consomem o mesmo controle.

## Testes

- Persistência/clamp do hook de volume.
- Aplicação de volume em `RemoteAudio` e no grafo espacial.
- UI do slider na grade, no painel de pessoas e no card.
- Provider aplica o mesmo volume ao mic remoto e ao áudio de tela do usuário.

