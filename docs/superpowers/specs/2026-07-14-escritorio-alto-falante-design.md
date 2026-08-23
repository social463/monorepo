# Escritório — Alto-falante (liderança fala para o mapa inteiro)

**Data:** 2026-07-14
**Status:** design aprovado (aguardando review do spec)
**Depende de:** `2026-07-14-escritorio-midia-design.md` (branch `feat/escritorio-midia`)

## Problema

A mídia do escritório é deliberadamente local: proximidade no espaço aberto e
salas com isolamento acústico. Não existe jeito de falar com **todo mundo** —
um "pessoal, reunião geral em 5 minutos" hoje exigiria caçar as pessoas sala
por sala. Falta o alto-falante do escritório: a liderança liga, o mapa inteiro
ouve — **inclusive quem está dentro de uma sala de reunião**.

## Escopo do v1

**Dentro:** botão "Alto-falante" na barra de mídia, visível só para liderança
(`LEAD`/`MANAGER`/`HEAD`); ao ligar, a voz vai para todos no escritório,
atravessando salas; banner "📢 Fulano no alto-falante" para todos enquanto
alguém fala; permissão de publicar imposta pelo **servidor** (grant no token);
**interruptor no painel do admin** que liga/desliga a feature inteira — com
ela desligada, nenhum cliente abre a conexão de broadcast (é o interruptor de
**custo**: a segunda conexão LiveKit por cliente só existe quando o recurso
está ativo).

**Fora (deliberadamente):** ducking (abaixar o volume das conversas durante o
anúncio); push-to-talk; trava de "um locutor por vez" (dois líderes simultâneos
são permitidos, o banner lista ambos); gravação de anúncios; role `ADMIN` no
escritório (decisão: alto-falante é da liderança, que já entra no mapa — a
rota `/escritorio` continua `DevOnly`).

## Decisões de design

- **Sala de broadcast dedicada e permanente (`office-broadcast`).** Todo
  cliente do escritório mantém uma **segunda conexão LiveKit**, só de escuta,
  a essa sala — além da sala de localização (aberto/zona). Alternativas
  rejeitadas: publicar em todas as salas ao mesmo tempo (N conexões enquanto
  fala, membership dinâmico, frágil) e relay server-side via ingress/egress
  (infra que decidimos não operar).
- **Permissão estrutural, não convenção de UI.** O grant `canPublish` vai
  dentro do token que a API assina: liderança recebe `canPublish: true`,
  qualquer outro role recebe `canPublish: false`. O **próprio servidor
  LiveKit** rejeita a publicação de um cliente adulterado — esconder o botão é
  cosmético, a fronteira é o token.
- **Broadcast não depende de posição.** O token de `office-broadcast` exige
  apenas estar no escritório (presença no hub → 409 se não estiver); não há
  checagem de zona. A conexão sobrevive às trocas de sala por posição — entrar
  numa reunião não desconecta ninguém do PA.
- **Voz sai SÓ pelo alto-falante enquanto ele está ligado.** Ao ligar, o mic
  local (da sala de localização) é silenciado — senão quem está perto do
  locutor ouviria em dobro. Ao desligar, o mic local **restaura o estado
  anterior** (quem estava desmutado volta desmutado).
- **Quem fala é visível para todos.** `speakerActive` deriva dos participantes
  da sala de broadcast com track de áudio publicado; o banner mostra o(s)
  nome(s). O locutor também se vê no banner (feedback de "estou no ar").
- **Interruptor global no admin, persistido no banco.** Motivação é **custo**:
  cada cliente do escritório mantém uma conexão extra com o LiveKit só para o
  broadcast — desligado, essa conexão não é aberta por ninguém. O flag vive
  numa tabela nova (`OfficeSetting`, primeira migration desta linha de
  features — as fatias anteriores eram deliberadamente sem banco, esta
  precisa: o flag tem que sobreviver a restart). **Default: desligado** — o
  admin liga quando o time quiser pagar o custo. A imposição é em camadas:
  desligado ⇒ a API recusa token de broadcast (403) **e** o cliente nem tenta
  conectar (o custo é evitado de fato, não só bloqueado).
- **O flag aplica em sessões novas do escritório.** O cliente lê a config ao
  montar a página; quem já está com o escritório aberto quando o admin
  desligar mantém a conexão até recarregar/navegar. Aceito no v1 (derrubar ao
  vivo exigiria empurrar config pelo WS — fica para depois se o custo residual
  incomodar).

## Arquitetura

### 1. Contrato (`packages/shared/src/office-media.ts`)

```ts
export const OFFICE_BROADCAST_ROOM = 'office-broadcast'

export interface OfficeConfigDTO {
  broadcastEnabled: boolean
}
```

`isLeaderRole` já existe em `packages/shared/src/enums.ts`. O request/response
de token não muda de formato.

### 2. Dado & persistência (`apps/api/prisma/schema.prisma`)

Model novo, mínimo e genérico o bastante para futuros ajustes do escritório:

```prisma
model OfficeSetting {
  id               Int      @id @default(1)
  broadcastEnabled Boolean  @default(false)
  updatedAt        DateTime @updatedAt
}
```

Linha única (`id = 1`), criada on-demand (`upsert`) — sem seed obrigatório.
Migration nova via `pnpm db:migrate`. Leitura/escrita num service
(`office-setting-service.ts`): `getOfficeSettings()` e
`setBroadcastEnabled(value)`.

### 3. Backend

- **`apps/api/src/routes/office-media.ts`** — `POST /office/media-token` ganha
  um caso especial ANTES da checagem de zona:
  - `room === OFFICE_BROADCAST_ROOM` → se o flag está **desligado**, `403
    { message: 'O alto-falante está desativado' }`; ligado → exige presença no
    hub (mesmo 409 de sempre), **sem** checagem de posição, e assina com
    `addGrant({ roomJoin: true, room, canSubscribe: true, canPublish: isLeaderRole(request.user.role) })`.
  - Salas de localização: comportamento atual intocado (403 por posição, grant
    padrão). `officeRoomAt` nunca devolve `office-broadcast`, então não há
    colisão de nomes.
  - O role vem do **JWT** (`request.user.role`), nunca do body.
- **`GET /office/config`** (autenticada, mesma route file) → `OfficeConfigDTO`.
  É o que o front lê ao montar a página para decidir se abre a conexão de
  broadcast e se mostra o botão.
- **Admin** (`apps/api/src/routes/admin.ts` + `admin-service`, padrão
  existente): `PATCH /admin/office-settings` com `{ broadcastEnabled: boolean }`
  (Zod), protegida por `app.requireAdmin`; `GET` correspondente para o painel
  exibir o estado atual.

### 4. Painel do admin (`apps/web/src/pages/AdminPage.tsx`)

Seção/aba "Escritório" seguindo o padrão de abas existente do admin: um switch
"Alto-falante do escritório" com o estado atual e texto curto explicando o
custo ("mantém uma conexão de mídia extra por pessoa no escritório"). React
Query para ler/atualizar (`/admin/office-settings`).

### 5. Frontend (`apps/web/src/office/media/`)

- **`useOfficeMedia`** ganha a conexão de broadcast, com ciclo de vida
  próprio e mais simples que o da sala de localização:
  - só existe se `GET /office/config` disser `broadcastEnabled: true` (lido
    uma vez ao montar; flag desligado ⇒ nenhuma conexão extra, botão ausente
    para todos, banner nunca aparece);
  - conecta quando o escritório conecta (mesmo gate do resto: `connected` e
    presença confirmada), com `autoSubscribe: true`; desconecta no unmount.
    Retry com backoff próprio; falha no broadcast **não** afeta a mídia de
    proximidade (e vice-versa).
  - expõe: `speakerEnabled: boolean`, `toggleSpeaker(): Promise<void>`,
    `speakers: string[]` (nomes de quem está publicando no broadcast agora)
    e `broadcastAudioTracks` (para a UI anexar).
  - `toggleSpeaker()` liga: cria/publica o track de mic na sala de broadcast
    (desmutado — ligar o PA é o ato de falar) e **silencia o mic local**,
    guardando o estado anterior; desliga: despublica do broadcast e restaura
    o mic local. Se a permissão de mic já foi negada antes, ligar o PA mostra
    o mesmo aviso de permissão (não conecta nada).
  - a guarda de geração existente cobre só a sala de localização; o broadcast
    tem referência própria (`broadcastRoomRef`) e não participa da troca por
    posição.
- **`MediaBar`** ganha o botão "Alto-falante" (rótulos: "Ligar alto-falante" /
  "Desligar alto-falante"), renderizado apenas quando o usuário é liderança —
  o role vem do `useAuth()` na `OfficePage`, passado por prop (`canBroadcast`).
  Estado visual de ativo igual aos demais toggles.
- **Banner + áudio do broadcast**: componente pequeno (`BroadcastBanner`) que
  a `OfficePage` posiciona no topo central, visível quando `speakers.length > 0`:
  "📢 {nomes} no alto-falante". Ele também anexa os tracks de áudio do
  broadcast (elementos `<audio>` invisíveis, mesmo padrão do `MediaTiles`).

## Fluxos

0. **Admin liga o recurso** → painel do admin → switch "Alto-falante do
   escritório" → `PATCH /admin/office-settings` persiste no banco. (Com o
   flag desligado — o default — os fluxos 1–5 simplesmente não existem:
   ninguém conecta ao broadcast, o botão não aparece.)
1. **Lenda entra no escritório** → `GET /office/config` diz que o broadcast
   está ativo → além da sala de localização, conecta em `office-broadcast`
   como ouvinte (token com `canPublish: false`).
2. **Líder liga o alto-falante** → botão na barra → token do broadcast já tem
   `canPublish: true` → publica o mic lá, silencia o mic local → todos (aberto
   e salas) ouvem e veem o banner.
3. **Líder entra numa sala de reunião falando** → troca de sala de localização
   normal; o broadcast segue conectado e transmitindo.
4. **Líder desliga** → despublica, banner some para todos, mic local volta ao
   estado de antes.
5. **Lenda adulterada tenta publicar no broadcast** → o servidor LiveKit
   rejeita: o token dela não tem `canPublish`.

## Erros e bordas

- **Falha só no broadcast** (conexão cai, token falha) → retry com backoff;
  proximidade/salas seguem funcionando; se o líder estava falando, o toggle
  volta a desligado e a barra avisa.
- **Permissão de mic negada** → ligar o PA vira o mesmo aviso existente; a
  escuta do broadcast funciona normalmente (ouvinte não precisa de mic).
- **Locutor fecha a aba/perde conexão** → o LiveKit derruba o participante da
  sala de broadcast; o banner some para todos sozinho.
- **Dois líderes simultâneos** → permitido; o banner lista os dois nomes.
- **Duas abas do mesmo líder** → mesma identidade no LiveKit: a conexão nova
  derruba a antiga (comportamento default já aceito na mídia).
- **`GET /office/config` falha** → trata como desligado (fail-closed: sem
  conexão extra, sem botão) e loga; a mídia de localização segue normal.
- **Admin desliga com gente no ar** → sessões novas já não conectam; quem
  está com a página aberta mantém a conexão até recarregar (documentado nas
  decisões). A API já recusa tokens novos de broadcast imediatamente.

## Testes

- **API**: com o flag ligado, token de `office-broadcast` para
  LEAD/MANAGER/HEAD tem `canPublish: true` e para LEGEND `canPublish: false`
  (decodificando o JWT); com o flag desligado (default), 403; 409 fora do
  escritório; salas de localização continuam com o comportamento atual
  (testes existentes não mudam). `GET /office/config` reflete o flag;
  `PATCH /admin/office-settings` exige admin (403 para os demais), valida o
  body (400) e persiste (upsert da linha única).
- **Web (hook, LiveKit mockado)**: conexão de broadcast abre junto e NÃO cai
  na troca de sala por posição; `toggleSpeaker` liga → publica no broadcast e
  silencia o mic local; desliga → restaura o estado anterior do mic;
  `speakers` reflete participantes remotos com áudio publicado; falha no
  broadcast não altera o status da mídia de localização.
- **Web (UI)**: `MediaBar` mostra o botão só com `canBroadcast`; banner
  aparece com `speakers` não vazio e lista os nomes; página do admin renderiza
  o switch e chama o PATCH.
- **Web (gating)**: com `broadcastEnabled: false` na config, o hook não abre a
  conexão de broadcast e o botão não aparece nem para liderança.
- **Manual**: admin liga o switch; dois navegadores + um líder — ligar o PA e
  confirmar que quem está dentro da sala de reunião ouve; que o mic local
  silencia (quem está colado no líder não ouve em dobro); que LEGEND não vê o
  botão; e que com o switch desligado ninguém abre conexão de broadcast.

## Riscos

- **Duas conexões LiveKit por cliente** — custo aceito da sala dedicada; a de
  broadcast fica ociosa (só sinalização) fora dos anúncios.
- **Restauração do estado do mic** é o ponto com mais chance de bug sutil
  (ligar PA já mutado, desligar PA depois de mexer no mic local, etc.) — os
  testes do hook precisam cobrir essas sequências explicitamente.
