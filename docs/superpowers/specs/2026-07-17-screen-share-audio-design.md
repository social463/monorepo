# Áudio no compartilhamento de tela — design

**Data:** 2026-07-17
**Branch:** `feat/screen-share-audio`

## Problema

No escritório virtual, quando alguém compartilha a tela, só o **vídeo** vai
para os demais participantes. O áudio (de uma aba com vídeo/música, ou do
sistema) não é capturado nem reproduzido. O pedido: ao compartilhar uma **aba**,
compartilhar o **som** junto; ao compartilhar uma **janela/tela**, compartilhar
o áudio também **quando o navegador permitir**.

## Limitação de navegador (define o "quando permitir")

A captura de áudio em `getDisplayMedia` depende do navegador e do tipo de
superfície escolhida pelo usuário no diálogo nativo:

- **Aba (`browser`)** → Chrome/Edge exibem a caixinha **"Compartilhar áudio da
  guia"**. Se marcada, o áudio da aba é capturado. É o caso principal.
- **Tela inteira / monitor (`monitor`)** → com `systemAudio: 'include'`, o
  Chrome (Windows/ChromeOS) pode oferecer o áudio do sistema.
- **Janela (`window`)** → navegadores **não** capturam áudio por janela.
  Pedimos o áudio mesmo assim; sem ele, compartilha só o vídeo, sem erro.

Conclusão: pedimos o áudio de forma consistente e deixamos o navegador decidir
se o entrega. Não há garantia para o caso "janela" — é limite da plataforma.

## Estado atual (fatos do código)

- **Envio** — `apps/web/src/office/media/useOfficeMedia.ts:415` `toggleScreenShare`
  chama `room.localParticipant.setScreenShareEnabled(next)` **sem opções** → o
  SDK não captura áudio.
- **Recebimento** — `useOfficeMedia.ts:160` `syncRemotes` só mapeia
  `Track.Source.Microphone` → `audioTrack`. O `Track.Source.ScreenShareAudio`
  é ignorado (nem sequer há campo pra ele).
- **Reprodução** — `apps/web/src/office/session/OfficeSessionContext.tsx:170` o
  provider monta um `<RemoteAudio>` por `audioTrack`. É onde o áudio "vive"
  (continua no PiP, não duplica).
- LiveKit **2.20.1** já suporta: `ScreenShareCaptureOptions.audio` e o enum
  `Track.Source.ScreenShareAudio = "screen_share_audio"`.

## Solução (3 pontos, sem backend/contrato)

### 1. Enviar o áudio da tela
Em `toggleScreenShare`, passar opções ao helper:

```ts
await room.localParticipant.setScreenShareEnabled(next, {
  audio: true,
  systemAudio: 'include',
})
```

O navegador decide se mostra a caixinha de áudio da aba / oferece o áudio do
sistema. Se o usuário não marcar ou a superfície não suportar, o SDK publica só
o vídeo — comportamento idêntico ao de hoje.

### 2. Receber o áudio da tela
- Em `RemoteMedia`, adicionar `screenAudioTrack: RemoteAudioTrack | null`.
- Em `syncRemotes`, mapear `pub.source === Track.Source.ScreenShareAudio` →
  `media.screenAudioTrack` (mesmo loop, ao lado dos outros `else if`).
- O rastreio de `screenShareOrder` (destaque de quem começou primeiro)
  **continua só no vídeo** (`Track.Source.ScreenShare`) — o track de áudio não
  entra na ordenação, então não há contagem dupla.

### 3. Reproduzir o áudio da tela
No provider (`OfficeSessionContext.tsx`), montar um `<RemoteAudio>` adicional
por `screenAudioTrack`, reusando o componente existente:

```tsx
{media.remotes.map(
  (r) => r.screenAudioTrack && (
    <RemoteAudio key={`sa-${r.userId}`} track={r.screenAudioTrack} />
  ),
)}
```

## Fora de escopo

- Controle de volume por-participante do áudio de tela (o alto-falante/broadcast
  atual não muda).
- Indicação visual de "tem áudio" no tile de tela.
- Backend / `@legends/shared` — nada muda; LiveKit publica e assina o track
  sozinho, e a assinatura por proximidade já se aplica a todas as publicações.

## Testes

- **`useOfficeMedia.test.ts`** — `toggleScreenShare` chama `setScreenShareEnabled`
  com `{ audio: true, systemAudio: 'include' }`.
- **`useOfficeMedia.test.ts`** (syncRemotes) — publicação `ScreenShareAudio`
  subscrita e não-mutada vira `screenAudioTrack`; mutada/não-subscrita é
  ignorada (mesma regra do vídeo).
- Verificação de runtime via skill `verify` (dois navegadores, compartilhar uma
  aba com áudio e confirmar que o outro ouve).
