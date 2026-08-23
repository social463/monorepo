# Design — Corrida com Shift no escritório virtual

**Data:** 2026-07-17
**Branch:** `feat/corrida-shift` (a partir da main)

## Problema

O personagem no escritório virtual anda por tile, num ritmo fixo. O usuário quer
que segurar **Shift** faça o personagem correr — o dobro da velocidade — e que
isso seja visível para os outros ocupantes do escritório, não só uma sensação
local.

## Decisão de escopo (validada com o usuário)

**Sincronizado de verdade**: quando alguém segura Shift, o servidor aceita e
retransmite os passos no dobro do ritmo, e todos os clientes conectados veem
aquele personagem correndo — não é só uma predição/animação local que depois
"engasga" quando o servidor não acompanha.

## Fatos verificados do código (branch main, antes desta feature)

- Movimento é por tile (grid), nunca contínuo em pixels. Fluxo: tecla →
  predição local otimista (`MovementPredictor`, anima o passo na hora) →
  `{type:'move', dir}` via WS → servidor valida colisão → `{type:'moved',
  userId, x, y, dir}` broadcast para todos → cada cliente reconcilia (o autor
  via `predictor.confirmMove`, os demais chamando `step()` direto).
- `apps/web/src/office/scenes/OfficeScene.ts`: `STEP_MS = 150` (duração da
  animação/tween de um passo) e `INPUT_COOLDOWN_MS = 160` (intervalo mínimo
  entre passos enviados, "casa com o rate limit do servidor"). `update(time)`
  lê as teclas de direção pressionadas (`up/down/left/right`, setas + WASD,
  registradas uma vez em `create` via `keyboard.addKey`), respeita o cooldown,
  chama `applyLocalIntent(dir)` (que usa `predictor.predict` e anima via
  `step()`) e `bridge.emitMoveIntent(dir)`.
- `step(userId, x, y, dir)` é a MESMA função usada para animar o próprio
  personagem (chamada por `applyLocalIntent`) e os outros ocupantes (chamada
  no `case 'moved'` do `handle()`, quando `userId !== youId`). Ela usa
  `STEP_MS` como `duration` do tween de posição e do bob do walk cycle
  (`STEP_MS/2`), e toca a animação `${textureKey}-walk-${dir}` no sprite LPC.
- `apps/api/src/lib/office-hub.ts`: token bucket por usuário (não por socket —
  várias abas dividem o mesmo orçamento), `MOVES_PER_SECOND = 10`,
  `BURST = 10`. `move(socket, userId, dir)` chama `takeToken(userId)`; se
  faltar token, a função **retorna em silêncio** (nenhuma mensagem enviada —
  nem `moved` nem `sync`). Se a posição alvo não é andável, envia `sync` só
  para quem tentou (vira o personagem, sem passo).
- `apps/api/src/routes/office-ws.ts:91`: dispatch do WS —
  `if (msg.type === 'move' && isDirection(msg.dir)) officeHub.move(ws, user.id, msg.dir)`.
- `packages/shared/src/office.ts`: `OfficeClientMessage` inclui
  `{type:'move', dir: Direction}`; `OfficeServerMessage` inclui
  `{type:'moved', userId, x, y, dir}`.
- Shift não está reservado em nenhum lugar do teclado do escritório hoje.
- O "Seguir" (FollowController) manda passos por `bridge.emitClientMessage`
  (canal separado de `emitMoveIntent`, que é só teclado) — a predição local
  escuta os dois (`onClientMessage` com `message.type === 'move'` também
  chama `applyLocalIntent`), mas o Seguir não passa pelo cooldown de teclado.

## Arquitetura

### 1. Protocolo (`packages/shared/src/office.ts`)

Campo opcional `sprint?: boolean` em duas mensagens (compatível com clientes
antigos, que simplesmente não mandam/recebem o campo):

```ts
export type OfficeClientMessage =
  | { type: "move"; dir: Direction; sprint?: boolean }
  | ...

export type OfficeServerMessage =
  | { type: "moved"; userId: string; x: number; y: number; dir: Direction; sprint?: boolean }
  | ...
```

`sync` não precisa do campo — é enviado só para quem bateu na parede, sem
tween de posição do lado de quem recebe.

### 2. Servidor (`apps/api/src/lib/office-hub.ts`, `office-ws.ts`)

- `MOVES_PER_SECOND` e `BURST` sobem de `10` para `20`. Isso é uma mudança de
  **ritmo**, não de segurança: a validação de colisão (`isMapTileWalkable`,
  `canEnterRoom`) continua idêntica e 100% no servidor — um cliente
  adulterado não atravessa parede nem teleporta, só poderia (no limite)
  manter o dobro do ritmo de passos indefinidamente, o que não é um risco
  relevante para uma plataforma de presença/reconhecimento, não um jogo
  competitivo.
- `move(socket, userId, dir, sprint = false)`: ganha o parâmetro `sprint`.
  Ao aceitar o passo (`walkable` e sala permitem), o broadcast passa a ser
  `{type:'moved', userId, x: targetX, y: targetY, dir, sprint}`. Sem mudança
  na lógica de token bucket além dos números acima — o mesmo bucket cobre
  passo normal e passo de corrida (a corrida só consome tokens mais rápido,
  dentro do novo teto).
- `office-ws.ts:91`: passa `Boolean(msg.sprint)` para `hub.move(...)`.

### 3. Cliente — input e predição (`OfficeScene.ts`, `OfficeBridge.ts`, `useOfficeSocket.ts`)

- Nova tecla registrada junto das demais: `keyboard.addKey('SHIFT')`.
- Constantes novas: `SPRINT_STEP_MS = STEP_MS / 2` (75ms),
  `SPRINT_INPUT_COOLDOWN_MS = INPUT_COOLDOWN_MS / 2` (80ms) — mantém a mesma
  folga proporcional entre cadência do cliente e teto do servidor que existe
  hoje (160ms cliente vs 100ms mínimo do servidor ≈ 1.6×; 80ms vs 50ms ≈ 1.6×
  também).
- `update(time)`: o cooldown usado passa a depender de `this.shiftKey.isDown`
  (`SPRINT_INPUT_COOLDOWN_MS` ou `INPUT_COOLDOWN_MS`). `applyLocalIntent` e
  `bridge.emitMoveIntent` recebem o booleano de sprint.
- `OfficeBridge.emitMoveIntent(dir, sprint)` e `onMoveIntent` repassam o
  booleano para o handler; `useOfficeSocket.ts` inclui `sprint` no JSON
  enviado (`ws.send(JSON.stringify({type:'move', dir, sprint}))`) só quando
  `true` (omite o campo quando `false`, mantendo o payload idêntico ao atual
  no caso comum).
- `MovementPredictor` **não muda** — ele só sequencia tiles (`predict`,
  `confirmMove`, `confirmSync`), nunca soube de tempo/duração. A velocidade é
  puramente uma decisão de animação da cena.
- O Seguir (`FollowController` / canal `emitClientMessage`) **não** ganha
  sprint nesta feature — corrida é uma ação de teclado. Fora de escopo.

### 4. Cliente — animação (`step()`)

- `step()` passa a receber a duração como parâmetro (`STEP_MS` ou
  `SPRINT_STEP_MS`) em vez de usar a constante do módulo direto — usada tanto
  no tween de posição quanto no bob do walk cycle do placeholder
  (`duration/2`).
- `applyLocalIntent` chama `step()` com a duração derivada do estado atual do
  Shift (o autor sempre sabe se está correndo).
- `case 'moved'` no `handle()`: para ocupantes que não são você, a duração
  vem do `message.sprint` recebido do servidor.
- Pernas mais rápidas: ao tocar a animação do sprite LPC,
  `sprite.anims.timeScale = sprint ? 2 : 1` — evita o efeito de "deslizar" (o
  personagem se move rápido mas os pés animam devagar). Resetado para `1`
  sempre que o passo termina ou muda de tipo.

## Tratamento de erros / casos de borda

- Shift pressionado sem nenhuma tecla de direção: no-op, como hoje sem
  direção nenhuma.
- Shift solto no meio de um tween em andamento: o passo em voo termina na
  duração com que começou (sem interromper); o PRÓXIMO passo já reflete o
  novo estado do Shift. Sem necessidade de cancelar/reiniciar tweens.
- Cliente antigo (sem o campo `sprint` no protocolo) conversando com servidor
  novo: `sprint` chega `undefined`, tratado como `false` — comportamento
  idêntico ao atual.
- Rate limit: com as margens da seção 3, sprint sustentado não deve nunca
  esgotar o bucket (12.5 passos/s efetivos do cliente contra 20/s de teto do
  servidor). Se ainda assim algum passo for descartado por rate limit (ex.:
  múltiplas abas do mesmo usuário movendo ao mesmo tempo), o comportamento é
  o mesmo de hoje: passo sem eco, sem `sync` — não é uma regressão desta
  feature.

## Testes

- `apps/api/src/lib/office-hub.test.ts`: sprint sustentado (passos a cada
  ~80ms simulados) não esgota o bucket com os novos limites; `moved`
  propaga `sprint: true` quando o passo aceito veio com `sprint: true`, e
  `sprint: false` quando veio sem (o parâmetro tem default `false`, então o
  broadcast do servidor SEMPRE inclui o campo explícito — só o `move` de
  saída do cliente é que omite o campo quando `false`, por brevidade do
  payload comum).
- `apps/web/src/office/scenes/OfficeScene` (teste de integração existente,
  se houver, ou novo): Shift + tecla de direção dispara `step()` com
  `SPRINT_STEP_MS`; um `moved` de outro ocupante com `sprint:true` anima com
  a mesma duração reduzida.
- `MovementPredictor.test.ts`: sem mudança (fora de escopo).

## Fora de escopo

- Corrida no "Seguir" (FollowController).
- Velocidade configurável/diferente de exatamente 2×.
- Indicador visual de "correndo" na UI (ícone, texto) — a própria animação
  mais rápida já comunica o estado.
- Qualquer mudança em `MovementPredictor`.
