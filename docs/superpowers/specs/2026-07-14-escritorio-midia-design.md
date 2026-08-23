# Escritório — áudio, vídeo e tela por proximidade e por salas

**Data:** 2026-07-14
**Status:** design aprovado (aguardando review do spec)
**Depende de:** `2026-07-14-escritorio-virtual-design.md` (branch `feat/escritorio-virtual`)

## Problema

O escritório virtual mostra quem está por perto, mas ninguém consegue **falar**.
A segunda fatia é a que dá o valor de verdade: aproximou de alguém → conversa
por voz, como passar na mesa da pessoa; entrou numa sala demarcada → reunião
com isolamento acústico; ligou câmera ou compartilhou a tela → os outros veem.

## Escopo do v1

**Dentro:** áudio por proximidade no espaço aberto (conecta/desconecta pelo
raio); zonas/salas com isolamento acústico garantido pelo servidor; vídeo de
câmera opt-in; compartilhamento de tela opt-in; barra de controles de mídia;
tiles de vídeo/tela; integração com o servidor LiveKit **existente** (ver §3).

**Fora (deliberadamente):** fade de volume pela distância (v1 é liga/desliga
no limiar); trava/convite de sala; gravação; indicador de "falando" no canvas;
chat de texto; mobile.

## Decisões de design

- **SFU (LiveKit) em vez de mesh P2P.** Decisão do time: escala salas com o
  time inteiro em vídeo, economiza upload de cada um, e o SDK cliente elimina
  o grosso do WebRTC manual (reconexão, simulcast, devices). **Revisado
  (14/07): usamos um servidor LiveKit já existente** — não operamos um (§3);
  o custo assumido é a dependência de um serviço que não administramos.
- **A sala LiveKit segue a posição no mapa.** As posições já são
  server-autoritativas no `office-hub`; a mídia deriva delas:
  - **Zona** (retângulo nomeado do mapa) → sala LiveKit própria
    (`office-zone-<id>`). Quem está na zona entra nela; quem está fora não
    está na sala. Isolamento acústico é **estrutural**, não convenção.
  - **Espaço aberto** → sala única `office-open` com `autoSubscribe: false`;
    cada cliente assina só os tracks de quem está no raio de proximidade.
- **Proximidade = Chebyshev ≤ 3 tiles** (`max(|dx|,|dy|) <= 3`). Entrou no
  raio → assina (ouve/vê); saiu → desassina. Padrão de spatial audio do
  próprio LiveKit. Rejeitado: uma sala por aglomerado de pessoas — fusão e
  divisão de grupos vira churn infernal de conexão.
- **Token autorizado pela posição real.** O front pede
  `POST /office/media-token { room }`; a API só assina se a sala pedida for a
  correta para a posição do usuário **no hub** (`zoneAt`). Cliente adulterado
  não entra na sala de reunião sem estar fisicamente nela.
  - Limite documentado: no **espaço aberto**, a assinatura por distância é
    client-side — um cliente hackeado poderia ouvir alguém longe *no espaço
    aberto*. A fronteira dura de privacidade é a zona.
- **Mic mutado por padrão.** Ao entrar no escritório pede-se a permissão do
  navegador uma vez e o track de áudio é publicado **mutado**; a pessoa
  desmuta quando quiser falar. Vídeo e tela são opt-in na barra de mídia.
- **Áudio conecta sozinho; vídeo/tela só de quem ligou.** A conexão (sala +
  assinaturas) é automática pela posição; o que trafega depende do que cada
  um publicou.
- **Zonas são dados, não tiles.** Retângulos `{ id, name, x0, y0, x1, y1 }`
  em `@legends/shared`, por cima do `OFFICE_MAP`. O mapa ganha **duas salas de
  reunião** muradas (com vão de porta) na área inferior direita, e a **copa**
  vira zona demarcada. Layout tile a tile fica no plano; o contrato é: 3 zonas
  (`reuniao-1`, `reuniao-2`, `copa`), retângulos dentro do mapa, sem
  sobreposição, e todo vão de porta andável.

## Arquitetura

### 1. Contrato (`packages/shared/src/office-media.ts`)

```ts
export const PROXIMITY_RADIUS = 3

export interface OfficeZone {
  id: string
  name: string          // "Sala de Reunião 1", "Copa"…
  x0: number; y0: number; x1: number; y1: number   // inclusivo
}

export const OFFICE_ZONES: readonly OfficeZone[]

/** Zona que contém o tile, ou null (espaço aberto). */
export function zoneAt(x: number, y: number): OfficeZone | null

export const OFFICE_OPEN_ROOM = 'office-open'
export function officeRoomForZone(zoneId: string): string  // `office-zone-<id>`

/** Sala correta para uma posição — usada pela API (autorização) e pelo front. */
export function officeRoomAt(x: number, y: number): string

export function isWithinProximity(ax: number, ay: number, bx: number, by: number): boolean

export interface OfficeMediaTokenRequest { room: string }
export interface OfficeMediaTokenResponse { token: string; url: string }
```

### 2. Backend (`apps/api`)

- **`src/routes/office-media.ts`** — `POST /office/media-token`, protegida
  (`onRequest: [app.authenticate]`). Route fina:
  1. valida o body com Zod (`room` string);
  2. busca a posição do usuário no `officeHub` — se não está no escritório,
     `409 { message: 'Entre no escritório antes de conectar a mídia' }`;
  3. `officeRoomAt(x, y) !== room` → `403 { message: 'Você não está nessa sala' }`;
  4. assina o token com `livekit-server-sdk` (`AccessToken`, identity = userId,
     name = nome, grant `roomJoin` só para aquela sala, TTL curto (~5 min) — token é bearer; TTL curto limita a janela de reuso por cliente adulterado após sair da sala) e
     devolve `{ token, url: LIVEKIT_URL }`.
- **`src/lib/office-hub.ts`** — ganha `occupantOf(userId)` (posição atual ou
  `null`). Nenhuma outra mudança: o hub continua sem saber que mídia existe.
- **`src/lib/config.ts`** — `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
  `LIVEKIT_URL`. Em dev caem no default do container `--dev`
  (`devkey`/`secret`, `ws://localhost:7880`); em produção são obrigatórias
  (mesmo padrão do `JWT_SECRET`).

### 3. Infra (LiveKit)

**Decisão revisada (14/07): usamos um servidor LiveKit JÁ EXISTENTE — não
operamos um.** Nada de container próprio, nginx ou portas UDP no nosso EC2.

- A integração inteira é por env: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
  `LIVEKIT_URL` (a URL que os **navegadores** usam, ex.
  `wss://livekit.suaempresa.com`). Obrigatórias em produção; em dev, aponte o
  `.env` para o mesmo servidor existente.
- Os navegadores conectam **direto** no servidor existente (sinalização e
  mídia) — nosso nginx não participa.
- Pré-requisito operacional: a API key/secret que assinamos precisa ser
  válida nesse servidor.

### 4. Frontend (`apps/web/src/office/media/`)

- **`useOfficeMedia(occupants, youId, connected)`** — hook orquestrador, o
  único dono do objeto `Room` do `livekit-client`:
  - deriva a sala desejada de **sua** posição confirmada (`officeRoomAt`);
    troca de sala com ~500 ms de estabilidade (não flapa parado na porta);
  - pede o token (`apiFetch`), conecta, publica o mic **mutado**;
  - no `office-open`: a cada mudança de `occupants`, assina/desassina cada
    participante remoto por `isWithinProximity` (zonas usam
    `autoSubscribe: true` — todo mundo se ouve);
  - expõe estado pra UI: conectado/conectando, mutado, câmera, tela,
    participantes com tracks.
- **`MediaBar.tsx`** — mic (default mutado), câmera, compartilhar tela,
  estado da conexão. React/Tailwind, fora do canvas.
- **`MediaTiles.tsx`** — faixa de tiles: vídeos das câmeras e telas
  compartilhadas de quem você assina; clique expande a tela compartilhada;
  áudio é anexado invisível. Sem limite de "um share por vez" no v1.
- **`OfficePage.tsx`** — compõe: canvas + HUD existentes + `MediaBar` +
  `MediaTiles`. O Phaser ganha só o tint + nome das zonas (dados de
  `OFFICE_ZONES` no `create()` — nada de lógica de mídia na cena).

## Fluxos

1. **Entrar no escritório** → WS conecta (já existe) → hook pede permissão de
   mic, pede token de `office-open` (ou da zona do spawn), conecta mutado.
2. **Aproximar de alguém no aberto** → `moved` atualiza `occupants` → distância
   ≤ 3 → assina os tracks dele → vocês se ouvem (se desmutados).
3. **Entrar na sala de reunião** → posição confirmada cai na zona → 500 ms
   estável → desconecta de `office-open`, token novo, conecta em
   `office-zone-reuniao-1` → ouve todos da sala; quem ficou fora some.
4. **Compartilhar tela** → botão na barra → `setScreenShareEnabled(true)` →
   track aparece nos tiles de quem está na mesma sala/raio.

## Erros e bordas

- **Permissão de mic negada** → conecta mesmo assim como ouvinte; barra mostra
  aviso e botão pra tentar de novo. Vídeo/tela idem (falha vira aviso, nunca
  quebra a página).
- **LiveKit fora do ar / token falhou** → escritório continua funcionando
  (mapa e movimento não dependem de mídia); barra mostra "sem áudio" e o hook
  tenta reconectar com backoff.
- **WS do escritório cai** → posição some do hub → tokens novos são negados
  (409) até reconectar; a conexão de mídia existente segue até o hook trocar
  de sala.
- **Flap na porta da zona** → debounce de 500 ms na troca de sala.
- **Duas abas** → ambas podem conectar; LiveKit trata identidade repetida
  derrubando a conexão anterior (comportamento default, aceito no v1).
- **Ex-lenda/desativado** → nunca chega: o WS do escritório já o rejeita e o
  token exige presença no hub.

## Testes

- **Shared** (`office-media.test.ts`): zonas dentro do mapa e sem sobreposição;
  `zoneAt` (dentro, fora, borda inclusiva); `officeRoomAt` (aberto vs zona);
  `isWithinProximity` (limiar exato, simetria); vão de porta das salas novas é
  andável (`isWalkable`).
- **API** (`office-media.test.ts`): 401 sem token; 409 fora do escritório;
  403 pedindo sala que não corresponde à posição (hub real com posição
  conhecida); 200 com token cujo grant bate com a sala e identity = userId
  (decodificar o JWT do LiveKit no teste — env fake, sem servidor LiveKit).
- **Web**: `useOfficeMedia` com `livekit-client` mockado — conecta na sala
  certa pela posição, troca de sala só após estabilidade, assina/desassina por
  distância no `office-open`, mic nasce mutado; smoke da `MediaBar`.
- **Manual** (nenhum teste cobre mídia real): dois navegadores — ouvir por
  proximidade, silêncio através da parede da sala, vídeo e tela.

## Riscos

- **Dependência de um LiveKit que não operamos:** se o servidor existente
  cair ou as credenciais forem trocadas, a mídia para (o escritório em si
  segue funcionando — degradação já prevista no design). Alinhar com quem o
  administra antes do rollout.
- **Troca de sala tem gap audível** (~1 s entre desconectar e conectar).
  Aceito no v1; dá pra suavizar depois com pré-conexão.
- **getUserMedia exige contexto seguro (HTTPS)** — mic/câmera/tela não abrem
  em `http://` (exceto localhost). O nginx do container escuta em 80; **é
  preciso confirmar onde o TLS termina hoje** (ALB/CloudFront?) antes do
  rollout. Sem HTTPS na ponta, a feature inteira não funciona em produção.
