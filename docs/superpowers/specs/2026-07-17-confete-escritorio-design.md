# Confete no F, no Escritório

**Data:** 2026-07-17
**Status:** Aprovado

## Objetivo

Easter egg estilo Gather Town: segurar a tecla `F` dentro do Escritório virtual faz o
seu personagem **lançar confete** continuamente (como um canhão de festa, saindo do
personagem pra cima/pros lados, não caindo de cima). Se **5 pessoas** estiverem
segurando `F` ao mesmo tempo, dispara uma comemoração: banner na tela, confete em
tela cheia e um som de aplausos/torcida sintetizado.

## Escopo

Só o Escritório (`OfficePage` / `OfficeScene`), autenticado. Nenhuma outra tela do
Legends é afetada.

## Protocolo (`packages/shared/src/office.ts`)

Novos membros nas uniões existentes, seguindo o padrão já usado por
`nearby-message` (broadcast pra todo mundo conectado, sem persistência):

```ts
// OfficeClientMessage
| { type: "confetti"; active: boolean }

// OfficeServerMessage
| { type: "confetti"; userId: string; active: boolean }
| { type: "celebration" }
```

`confetti` é enviado no keydown/keyup físico de `F` (evento, não polling por frame —
2 mensagens por "segurada", independente da duração). `celebration` não carrega
payload: é só um sinal pra todo mundo comemorar junto.

## Servidor (`apps/api/src/lib/office-hub.ts`)

- Novo estado: `private confettiActive = new Set<string>()` — quem está segurando
  `F` agora, chaveado por `userId` (mesmo raciocínio de "por pessoa, não por
  socket" já usado nos buckets de movimento).
- Novo método `confetti(socket, userId, active)`:
  - Valida que o socket é dono do `userId` (`socketOwner`), igual todo outro
    handler do hub.
  - Atualiza o Set (`add`/`delete`).
  - Broadcast `{ type: 'confetti', userId, active }` pra todo mundo (inclusive o
    próprio remetente — mesmo padrão de `nearby-message`, sem predição local no
    cliente).
  - Se essa atualização fez o Set cruzar de `< 5` pra `>= 5`, broadcast de
    `{ type: 'celebration' }`. Cooldown de 4s (`CELEBRATION_COOLDOWN_MS`) pra
    evitar disparo repetido se o grupo oscilar bem em cima do threshold (4↔5).
- `leave()` remove o `userId` de `confettiActive` — desconectar com `F` segurado
  não deixa fantasma inflando a contagem pros próximos que entrarem.
- `reset()` (só teste) limpa `confettiActive` também.

Threshold (`CELEBRATION_THRESHOLD = 5`) é uma constante fixa exportada do hub, sem
UI de configuração — decisão consciente de escopo (YAGNI).

## Rota WS (`apps/api/src/routes/office-ws.ts`)

Novo `case 'confetti':` no switch de mensagens recebidas, chamando
`officeHub.confetti(socket, userId, message.active)` — mesmo formato dos handlers
existentes (`move`, `nearby-message`, etc.).

## Cliente — captura da tecla (`OfficeScene.ts`)

- Nova key: `keyboard.addKey('F')`, junto da criação das outras em `create()`.
- Escuta os eventos `'down'`/`'up'` da própria `Key` (não polling em `update()`
  como o movimento) — cada aperto físico gera exatamente uma mensagem de início e
  uma de fim.
- Guard: ignora se `this.inputLocked` (mesmo lock que já existe pro movimento —
  chat de proximidade aberto, por exemplo, não deve disparar confete sem querer).
- Se `inputLocked` vira `true` enquanto `F` está segurado (ex.: abriu o chat no
  meio), força o `active:false` imediatamente (`setInputLocked` já é o ponto único
  de entrada desse estado, dá pra interceptar ali).
- Também força `active:false` no evento `Phaser.Core.Events.BLUR` (perdeu foco da
  aba/janela) — sem isso, um alt-tab com `F` pressionado deixaria o servidor achando
  que a pessoa continua segurando pra sempre.

## Cliente — renderização do confete (`OfficeScene.ts`)

- Textura de partícula gerada em runtime, uma vez, no `create()` — 4×4 px branco
  via `Graphics.generateTexture`, sem asset novo. Cor real vem do `tint` da
  partícula (paleta fixa de ~6 cores de confete).
- `Map<userId, Phaser.GameObjects.Particles.ParticleEmitter>` paralelo ao
  `characters` já existente.
- Ao receber `{ type: 'confetti', userId, active: true }`: cria (ou reaproveita) o
  emissor daquele `userId`, com `emitter.startFollow(view.container)` pra
  acompanhar a pessoa andando. Configuração de **lançamento** (não chuva):
  - `angle: { min: -120, max: -60 }` — leque pra cima, saindo do personagem.
  - `speed: { min: 120, max: 260 }` — impulso inicial forte, tipo canhão de festa.
  - `gravityY: 260` — cai naturalmente depois do impulso.
  - `lifespan: 900`, `quantity: 2`, `frequency: 35`, `scale: { start: 1, end: 0.3 }`,
    `rotate: { start: 0, end: 360 }`.
- Ao receber `active: false`: `emitter.stop()` (deixa as partículas em voo
  terminarem naturalmente, não some abruptamente).
- `destroyCharacter(userId)` também destrói o emissor daquele `userId`, se existir
  — pessoa saiu do escritório, confete some junto.

## Cliente — comemoração (`OfficeScene.ts` + novo módulo de som)

Ao receber `{ type: 'celebration' }`:
- Banner fixo na câmera (`scrollFactor(0)`, não se move com o mapa): texto
  "🎉 Comemoração!", fade in/out ao longo de ~3s, depois se destrói.
- Burst único de confete cobrindo a largura da tela (mesma textura/paleta do
  confete normal, mas emissor fixo na câmera no topo da viewport, várias
  partículas de uma vez, sem `startFollow`).
- Chama `playApplauseSound()` (novo módulo `apps/web/src/office/media/applause-sound.ts`).

### Som de aplausos (`applause-sound.ts`)

Sintetizado via **Web Audio API pura**, sem arquivo de áudio (decisão consciente:
não há asset de som no repo hoje, e não é objetivo desta feature introduzir um
pipeline de assets de áudio). Abordagem:
- `AudioContext` criado sob demanda (não no load da página — política de autoplay
  dos browsers exige gesto do usuário, e segurar `F` conta como tal).
- "Palmas": ~20-30 estouros curtos de ruído branco filtrado (`BiquadFilter`
  passa-alta), com timing levemente randomizado ao longo de ~1.5s, simulando
  aplausos.
- "Torcida": leito de ruído filtrado (passa-baixa, mais suave) por baixo das
  palmas, dando sensação de "gente" ao fundo, com fade out no final.
- Função exportada única: `playApplauseSound(): void`. Sem estado, sem cleanup
  necessário (nós do Web Audio se desconectam sozinhos quando o envelope zera).

## Fora de escopo

- Rate-limit extra no `confetti` além da checagem de dono do socket — mesma
  política (nenhuma) do `nearby-message` hoje.
- Persistência de qualquer estado de confete/comemoração — tudo efêmero, cai com o
  processo, como o resto do `OfficeHub`.
- Configuração do threshold de comemoração (fixo em 5, sem UI de admin).
- Suporte a dispositivos sem teclado físico (mobile/touch) — feature é desktop-only
  por natureza, como o resto do controle de movimento do Escritório (WASD/setas).

## Testes

- `office-hub.test.ts`: broadcast de `confetti` (active true/false), threshold de
  `celebration` disparando ao cruzar 5, cooldown de 4s, limpeza do Set em `leave()`.
- `office-ws.test.ts`: roteamento da mensagem `confetti` até `officeHub.confetti`.
- `OfficeScene.test.ts`: guard de `inputLocked`, criação/parada do emissor ao
  receber `confetti`, banner + burst ao receber `celebration`.
