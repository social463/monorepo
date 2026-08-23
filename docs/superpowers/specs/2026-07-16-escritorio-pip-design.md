# Escritório em Picture-in-Picture — Design

**Data:** 2026-07-16
**Status:** Aprovado

## Objetivo

Permitir que o usuário volte para o resto da aplicação sem sair do escritório
virtual: ao clicar em "Sair" nos controles centralizados no inferior
(`MediaBar`), o escritório vira uma janelinha flutuante (PiP) que mantém
áudio/vídeo e presença ativos enquanto ele navega pelas outras telas.

## Decisões de produto

- **Conteúdo do PiP:** câmeras + áudio. O mapa Phaser é destruído ao sair da
  rota e recriado ao voltar (como hoje). O PiP mostra os tiles de vídeo de quem
  está com câmera ligada na mesma sala/proximidade; sem câmeras, um estado
  compacto com avatares e contagem de pessoas.
- **Semântica do botão "Sair":** passa a minimizar. Ele navega para a Home e a
  sessão continua viva no PiP. A saída real (desconectar WebSocket + LiveKit) é
  o **X** do PiP.
- **Voltar ao escritório:** clique no corpo do PiP (ou botão expandir) navega
  para `/escritorio`.
- **Controles do PiP:** toggle de microfone, toggle de câmera, expandir, X. A
  janela é arrastável (limitada à viewport; posição só em memória).
- **Presença:** enquanto minimizado, o avatar continua parado no mapa, visível
  normalmente para os outros. Nenhuma mudança de protocolo WS.

## Arquitetura

Abordagem escolhida: **provider global de sessão** (vs. singleton fora do React
e vs. Document PiP nativo do browser — descartados por reescreverem hooks
testados ou não resolverem a persistência entre rotas).

### `OfficeSessionProvider`

Novo contexto em `apps/web/src/office/session/OfficeSessionContext.tsx`,
montado em `App.tsx` dentro do `BrowserRouter` e **fora** das `Routes`, para
sobreviver à navegação. Passa a ser o dono de:

- **`OfficeBridge`** — uma instância por sessão, recriada a cada
  `enterOffice()` para não vazar estado (snapshot de ocupantes, `youId`) da
  sessão anterior.
- **Query do mapa ativo** (`['office', 'active-map']`), com
  `enabled: status === 'active'`.
- **`useOfficeSocket`** e **`useOfficeMedia`** — mudam de call site, não de
  lógica. Recebem `publicationId`/inputs reais quando a sessão está ativa e
  `null` quando `idle`. O `useOfficeSocket` já fecha o WS com `publicationId`
  nulo (e ganha um reset de `occupants`/`youId` ao trocar de sessão, já que o
  hook não desmonta mais); o `useOfficeMedia` já desconecta a `Room` quando a
  sala estável vira `null` (`connected: false` zera a sala desejada) — sem
  mudança.
- **`useOfficeBroadcast` + query de `office/config`** — sobem juntos para que
  os anúncios de alto-falante continuem audíveis no PiP.
- **Elementos `<RemoteAudio>`** — saem do `MediaTiles` e são renderizados pelo
  provider enquanto a sessão vive (o som continua ao minimizar e não duplica).

**Bundle:** o provider vive no bundle principal, mas o `livekit-client`
(~110KB gzip) não pode ir junto — hoje ele só entra no chunk lazy da
`OfficePage`. Os hooks `useOfficeMedia`/`useOfficeBroadcast` passam a carregar
o LiveKit por `import()` dinâmico (loader com cache em
`office/media/livekit-loader.ts`); imports de tipos continuam estáticos.

### Ciclo de vida da sessão

```
idle --enterOffice() [OfficePage mount]--> active
active --"Sair" (MediaBar)--> active (página desmonta, PiP aparece)
active --leaveOffice() [X do PiP | logout | map-changed minimizado]--> idle
```

- `status: 'idle' | 'active'`. O PiP é visível quando `status === 'active'` e
  a rota atual não é `/escritorio`.
- `leaveOffice()` zera tudo: WS fecha, LiveKit desconecta (mídia e broadcast),
  bridge descartado, status volta a `idle`.

### O que continua na `OfficePage`

Phaser (`OfficeCanvas`, criado/destruído com a página), zoom, interações
(`useOfficeInteractions`), sidebar de pessoas, nearby chat, `MediaTiles`,
balões de câmera (`CharacterVideoBubble`), `BroadcastBanner` visual. A página
consome bridge/socket/mídia/broadcast do contexto em vez de criá-los.

## Componente PiP

`OfficePipWindow` em `apps/web/src/office/pip/OfficePipWindow.tsx`, renderizado
em `App.tsx` dentro do provider.

- **Janela:** `fixed`, padrão canto inferior direito, ~18rem de largura,
  `rounded-xl`, `bg-surface-container/95 backdrop-blur`, borda
  `outline-variant` e sombra — mesmo vocabulário visual dos controles
  flutuantes do escritório. `z-index` acima do `AppLayout`.
- **Arrastar:** pointer events no cabeçalho/corpo, posição limitada à
  viewport, mantida apenas em memória (volta ao padrão em reload — aceitável,
  já que o access token também não sobrevive a reload sem refresh).
- **Corpo:** até 4 tiles de vídeo (self com câmera ligada + remotos com
  `cameraTrack`), com nome sobreposto; havendo mais de 4 câmeras, mostra as 3
  primeiras + um tile "+N". Sem nenhuma câmera: fotos/avatares empilhados e
  "N pessoas no escritório". Clique no corpo → `/escritorio`.
- **Rodapé:** mic (`mic`/`mic_off`), câmera (`videocam`/`videocam_off`),
  expandir (volta ao escritório), X (`aria-label` "Sair do escritório") →
  `leaveOffice()`. Ícone `campaign` visível quando há alto-falante ativo.
- **MediaBar:** botão de sair mantém ícone/posição; `aria-label`/tooltip passa
  a ser "Voltar ao app — você continua no escritório".

## Casos de borda

- **`map-changed`:** listener sobe para o provider. Na rota `/escritorio`,
  mantém o `window.location.reload()` atual; minimizado, chama
  `leaveOffice()` (voltar ao escritório reconecta no mapa novo).
- **Logout:** efeito no provider — `user` do `AuthContext` virou `null` →
  `leaveOffice()`.
- **Proximidade no espaço aberto:** posição do usuário fica congelada onde
  estava; assinaturas por proximidade continuam reagindo ao movimento dos
  outros (nenhuma mudança em `applyProximity`).
- **Líder minimiza durante broadcast:** o speaker segue ativo — coerente com
  "o avatar continua presente".
- **Rotas admin (ex.: editor de mapas):** o PiP aparece normalmente; só a rota
  `/escritorio` o esconde.

## Testes

Vitest + Testing Library (jsdom), arquivos colocados ao lado do código:

- Provider: sessão sobrevive ao desmontar a página (socket/mídia continuam
  montados); `leaveOffice()` derruba WS + Room; nova sessão ganha bridge novo;
  logout encerra a sessão.
- `OfficePipWindow`: aparece quando `active` fora de `/escritorio`, some na
  rota do escritório e quando `idle`; X chama `leaveOffice()`; toggles delegam
  a `media.toggleMic`/`toggleCamera`; clique no corpo navega para
  `/escritorio`.
- `useOfficeSocket`: zera `occupants`/`youId` ao trocar de bridge/sessão
  (novo caso — o hook não desmonta mais entre sessões).
- Testes existentes dos hooks seguem valendo — só muda o call site.
