# Escritório — Card de personagem (chamar, seguir, ver perfil)

**Data:** 2026-07-14
**Status:** design aprovado (aguardando review do spec)
**Depende de:** `2026-07-14-escritorio-alto-falante-design.md` (branch `feat/escritorio-alto-falante`)

## Problema

No escritório os personagens são só bonecos com nome: não há como interagir com
uma pessoa específica. Clicar em alguém deve abrir o **mesmo card da tela
/lendas** (avatar, cargo, selos, reconhecimentos) com três ações:

- **Chamar** — a pessoa recebe um popup (aceitar/recusar) com aviso sonoro;
- **Seguir** — seu personagem anda sozinho até onde ela está;
- **Ver perfil** — abre o perfil dela numa nova aba.

## Escopo do v1

**Dentro:** clique no personagem (Phaser) → card overlay na página; card reusa
o `LegendCard` de /lendas (extraído para `components/`); ações chamar (popup +
beep + aceitar/recusar), seguir (BFS + caminhada automática) e ver perfil
(nova aba); aceitar uma chamada = andar automaticamente até o chamador;
feedback ao chamador (aceitou/recusou/offline).

**Fora (deliberadamente):** chamada em grupo; estado "ocupado/não perturbe";
seguir contínuo (modo cola); som customizável; histórico de chamadas; card ao
clicar em tile vazio.

## Decisões de design

- **Clicar no próprio personagem** mostra o card só com "ver perfil" (chamar e
  seguir a si mesmo não fazem sentido).
- **Card = `LegendCard` extraído**, não copiado. O componente hoje vive dentro
  de `LegendsPage.tsx` (não exportado); ele é movido para
  `apps/web/src/components/LegendCard.tsx` e a LegendsPage passa a importá-lo.
  Zero duplicação; os testes existentes da LegendsPage continuam valendo.
- **Dados do card via `/users/showcase`** (React Query, cache compartilhado,
  indexado por `userId`). O `OfficeOccupant` só tem id+nome — avatar completo,
  cargo, selos e reconhecimentos vêm do showcase. Ocupante ausente da resposta
  → card degrada para avatar de iniciais + nome, sem selos (nunca quebra).
- **A cena não decide nada**: o clique emite apenas `userId` pelo bridge
  (padrão `onMoveIntent`); card, popup, som e follow são todos React/lib.
  Hit area do container é um retângulo LOCAL explícito (container Phaser não
  tem tamanho implícito); o hit-test do Phaser já compensa zoom/câmera.
- **Chamada é relay puro, sem estado no servidor.** O hub retransmite
  mensagens; quem controla o ciclo (popup aberto, timeout) é o cliente.
  Sem estado de "ocupado" no v1: chamadas simultâneas ao mesmo alvo são
  enfileiradas no cliente (uma por vez na tela). Timeout de 30 s sem resposta
  → auto-recusa (o chamador recebe recusa).
- **Rate limit de chamada no hub**: 1 chamada a cada 3 s por usuário
  (bucket próprio, independente do de movimento). Excesso → `call-failed`
  com razão `rate-limited` (feedback, não drop silencioso).
- **Beep sem asset binário**: Web Audio (OscillatorNode + envelope), helper
  em `apps/web/src/lib/beep.ts`, `AudioContext` singleton lazy com `resume()`
  no primeiro gesto. Navegador bloqueou autoplay (F5 direto na página, sem
  gesto) → popup aparece sem som, silenciosamente. Coerente com a convenção
  do escritório de gerar assets em runtime.
- **Seguir = BFS no shared** (`findPath` ao lado de `isWalkable` — o mapa
  continua fonte única; grid 25×18 com custo uniforme não justifica A*).
  Destino é **tile adjacente** ao alvo (nunca em cima), com early-exit do BFS
  em "qualquer vizinho andável do alvo". Ao chegar, vira para encarar o alvo.
- **FollowController confirma cada passo.** O rate limit do servidor descarta
  moves EM SILÊNCIO (sem `moved` nem `sync`), então o controlador: emite um
  passo; espera o próprio `moved` confirmar; silêncio de ~500 ms → reenvia/
  recalcula; `sync` (parede) → re-ancora e recalcula; alvo se moveu →
  recalcula do ponto atual; alvo saiu (`left`) → cancela; **qualquer tecla de
  movimento cancela o follow** (o humano sempre vence).
- **Aceitar chamada reusa o follow**: o aceite dispara o mesmo controlador com
  destino no chamador. O chamador recebe `call-result` e vê toast
  "Fulano aceitou — está indo até você" (ou "recusou").
- **Ver perfil em nova aba** é seguro no modelo de auth: cookie de refresh é
  same-origin e o `AuthContext` faz bootstrap na aba nova (mesmo fluxo de um
  reload). Janela rara de corrida de rotação de refresh entre abas: aceita
  (já existe hoje em reload duplo).

## Arquitetura

### 1. Contrato (`packages/shared/src/office.ts` e `office-media.ts` intocado)

Extensões em `office.ts` (mesmo arquivo do protocolo existente):

```ts
// Pathfinding
export function findPath(
  from: TilePosition,
  to: TilePosition,          // alvo (a parada é ADJACENTE a ele)
): Direction[] | null        // [] = já está adjacente; null = sem caminho

// Protocolo de chamada
export type OfficeClientMessage =
  | { type: 'move'; dir: Direction }
  | { type: 'call'; targetUserId: string }
  | { type: 'call-response'; callerId: string; accepted: boolean }

export type OfficeServerMessage =
  | ... (existentes)
  | { type: 'incoming-call'; from: { userId: string; name: string } }
  | { type: 'call-result'; targetUserId: string; accepted: boolean }
  | { type: 'call-failed'; targetUserId: string; reason: 'offline' | 'rate-limited' }
```

### 2. Backend (`apps/api`)

- **`office-hub.ts`**:
  - método público `sendToUser(userId, message)` (todas as abas do usuário);
  - `call(callerSocket, callerId, targetUserId)`: bucket de chamada
    (1 por 3 s por usuário) → `call-failed rate-limited`; alvo fora do hub →
    `call-failed offline`; ok → `incoming-call` para o alvo (com nome do
    chamador, que o hub já tem no occupant);
  - `callResponse(socket, responderId, callerId, accepted)`: chamador ainda
    presente → `call-result` para ele; ausente → descarta em silêncio.
- **`office-ws.ts`**: dois cases novos no switch de mensagens, com validação
  de shape à mão (padrão do arquivo: mensagem malformada é ignorada, socket
  não cai). Nada de Zod aqui (consistente com o `move`).

### 3. Frontend (`apps/web`)

- **`office/OfficeBridge.ts`**: `onCharacterClick(handler)` /
  `emitCharacterClick(userId)` — mesmo padrão dos handlers existentes.
- **`office/scenes/OfficeScene.ts`**: no `spawn()`, container ganha
  `setInteractive(new Phaser.Geom.Rectangle(...), Contains)` +
  `pointerdown → bridge.emitCharacterClick(userId)` (respawn do welcome já
  recria o interactive; destroy limpa).
- **`office/FollowController.ts`** (classe pura, testável sem Phaser):
  recebe callbacks (`emitMove`, `onArrived`, `onCancelled`) e é alimentada
  pelos eventos do bridge (`moved`/`sync`/`left`) + posição dos ocupantes.
  Implementa a máquina de passos descrita nas decisões.
- **`office/useOfficeInteractions.ts`** (hook): liga tudo — estado do card
  aberto (occupant selecionado), chamadas (popup de entrada, fila, timeout
  30 s, toasts de resultado), instância do FollowController, envio de
  `call`/`call-response` pelo canal existente. **Decisão:** o bridge ganha o
  par genérico `onClientMessage(handler)`/`emitClientMessage(message)`
  (mensagem cliente→servidor tipada por `OfficeClientMessage`); o
  `useOfficeSocket` passa a escutar `onClientMessage` e enviar pelo WS —
  `emitMoveIntent` continua existindo e vira açúcar sobre esse canal.
- **`components/LegendCard.tsx`**: extração do card (prop `entry:
  ShowcaseEntry`, wrapper de link configurável para o overlay não navegar).
- **`office/CharacterCard.tsx`**: overlay com o LegendCard + botões Chamar /
  Seguir / Ver perfil (window.open). Posição: painel flutuante central-esq.,
  padrão visual dos overlays da página; fecha com X, Esc e clique fora.
- **`office/IncomingCallPopup.tsx`**: `role="alertdialog"`, nome do chamador,
  Aceitar/Recusar, barra de tempo (30 s). Monta o beep ao aparecer.
- **`lib/beep.ts`**: `playCallBeep()` — AudioContext lazy, envelope curto,
  falha silenciosa.
- **`OfficePage.tsx`**: compõe card, popup e toasts (padrão dos overlays;
  z-index acima do banner do alto-falante).

## Fluxos

1. **Clique** → cena emite `userId` → hook abre o CharacterCard com dados do
   showcase (ou fallback).
2. **Seguir** → fecha o card → FollowController calcula BFS até tile adjacente
   → passos confirmados um a um → chegou, encara o alvo.
3. **Chamar** → `call` → alvo recebe `incoming-call` em todas as abas → popup
   + beep → Aceitar: `call-response accepted` + FollowController até o
   chamador; Recusar/timeout: `call-response refused`. Chamador vê toast com
   o resultado. Alvo offline/rate-limit → toast de falha imediato.
4. **Ver perfil** → `window.open('/perfil/<id>', '_blank')`.

## Erros e bordas

- **Alvo sai do escritório** durante follow → cancela com aviso discreto;
  durante chamada pendente → popup do alvo já morreu com a aba; o chamador
  recebe recusa por timeout do próprio popup (30 s) — aceito no v1.
- **Sem caminho** (BFS null e não-adjacente — não deve ocorrer no mapa atual)
  → toast "Não foi possível chegar até Fulano".
- **Chamadas simultâneas ao mesmo alvo** → fila no cliente, um popup por vez.
- **Duas abas do chamado** → ambas mostram o popup e a primeira resposta
  vale para o chamador. O popup da aba que não respondeu não é fechado
  remotamente (o `call-result` vai só ao chamador, e o servidor não guarda
  estado de chamada): ele expira sozinho no timeout de 30 s. Aceito no v1 —
  fechar as duas abas em sincronia exigiria estado de chamada no servidor.
- **Beep bloqueado por autoplay** → popup sem som, sem erro no console.
- **Reconexão do WS** no meio de follow/chamada → follow cancela (welcome
  re-ancora tudo); popup pendente permanece e a resposta é enviada pela
  conexão nova (mesmo socket lógico).
- **Clique no personagem enquanto outro card está aberto** → substitui.

## Testes

- **Shared**: `findPath` — caminho reto, contorno de mesa, atravessa a porta
  (16,15), destino adjacente (nunca o tile do alvo), `null` quando já
  adjacente, alvo isolado (sem caminho).
- **API (hub)**: `call` entrega `incoming-call` a todas as abas do alvo;
  offline → `call-failed offline`; spam → `call-failed rate-limited`;
  `call-response` entrega `call-result` só ao chamador; malformadas ignoradas
  sem derrubar socket (via teste de integração do office-ws).
- **Web (FollowController, sem Phaser)**: avança só após `moved` confirmar;
  silêncio 500 ms → reenvio; `sync` → recalcula; alvo moveu → recalcula;
  tecla → cancela; chegada → `onArrived` com direção de encarar.
- **Web (hook/UI)**: clique via bridge abre o card com dados do showcase;
  fallback sem entrada; popup aceita/recusa envia a mensagem certa; timeout
  30 s auto-recusa; beep chamado ao montar o popup (módulo mockado — jsdom
  não tem AudioContext); "ver perfil" chama `window.open` com a URL certa.
- **Manual (2 navegadores)**: fluxo completo de chamada com som; seguir
  contornando paredes; alvo andando durante o follow.

## Riscos

- **FollowController é a peça com mais estados** (confirmação, timeout,
  recálculo, cancelamento) — por isso é classe pura com relógio injetável,
  fora do Phaser e do React.
- **O card depende do showcase**: se o endpoint mudar o shape, o overlay
  degrada junto com a /lendas (mesmo contrato, mesma quebra — visível).
- **Dupla aba do chamado com popups órfãos** é a borda mais feia aceita no
  v1 (expira em 30 s); resolver exigiria estado de chamada no servidor.
