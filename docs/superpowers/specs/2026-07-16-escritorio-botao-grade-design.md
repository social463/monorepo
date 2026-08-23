# Botão de grade (Meet-style) dentro da sala de reunião

## Problema

A grade expandida em tela cheia de `MediaTiles` (`buildTiles`/`resolveFeatured`/
overlay via `createPortal`) já existe e funciona — mas hoje não tem nenhum
gatilho de UI: `camerasExpanded` (estado em `OfficePage.tsx`) só é alternado
programaticamente, sem nenhum botão que o usuário possa clicar. Além disso,
com a remoção da faixa compacta (spec do balão de câmera), `hasVisible` só
considera câmera/tela ativas — abrir a grade numa sala onde ninguém ligou a
câmera ainda faria ela se auto-recolher na hora (efeito já existente:
`if (expanded && !hasVisible) onToggleExpanded()`).

Referência (Gather.town): dentro de uma sala, um ícone de grade aparece no
canto superior direito; clicar abre a visão consolidada de câmeras estilo
Meet.

## Comportamento desejado

- Um botão com ícone de grade aparece no **canto superior direito da tela**,
  **somente quando `inMeetingRoom`** (dentro de uma sala/zona de reunião,
  mesma variável já calculada em `OfficePage.tsx`). Fora de sala, o botão
  não aparece.
- Ao lado do ícone, um texto **"N na sala"** (N = quantidade de pessoas na
  sala atual, contando você: `(local ? 1 : 0) + media.remotes.length`) — um
  contador **diferente** do contador geral do escritório ("N pessoas no
  escritório", já existente na sidebar de pessoas).
- Clicar no botão alterna `camerasExpanded` (abre/fecha a grade expandida
  já existente).
- **Dentro de uma sala, a grade deve abrir mesmo que ninguém tenha
  câmera/tela ativa** — mostrando avatar de cada pessoa presente (mesmo
  comportamento de presença que existia antes na faixa lateral removida).
  Fora de sala, esse comportamento de presença **não** se aplica (mantém a
  regra atual: só abre/mantém aberta com câmera/tela ativa) — mas como o
  botão só existe dentro de sala, esse caso (abrir a grade fora de sala)
  não é mais alcançável por UI de qualquer forma; a distinção só importa
  pra não quebrar a garantia de que `MediaTiles` sem contexto de sala segue
  se comportando como antes.

## Abordagem

### `MediaTiles` recupera visibilidade por presença (só pra grade expandida)

`MediaTiles` ganha de volta um prop `showAllPresent?: boolean` (default
`false`) — mesmo conceito que existia antes da remoção da faixa compacta,
mas agora só afeta `hasVisible`, que passa a ser:

```ts
const hasVisible = showAllPresent ? tiles.length > 0 : tiles.some((t) => t.kind !== 'avatar')
```

Nenhuma outra mudança em `MediaTiles` — a grade expandida já lida com tiles
`avatar` corretamente (via `AvatarTile`, já usado hoje pra quem está sem
câmera dentro da lista de participantes).

### Botão + contador em `OfficePage.tsx`

Novo elemento (não faz parte de `MediaTiles` — vive em `OfficePage.tsx`,
junto aos outros controles flutuantes como o de zoom):

```tsx
{inMeetingRoom && (
  <button
    type="button"
    aria-label={camerasExpanded ? 'Recolher grade de câmeras' : 'Abrir grade de câmeras'}
    onClick={() => setCamerasExpanded((v) => !v)}
    className="absolute top-3 right-3 z-10 flex items-center gap-sm rounded-full border border-outline-variant/40 bg-surface-container/95 px-md py-sm shadow-lg backdrop-blur"
  >
    <Icon name="grid_view" className="text-[20px]" />
    <span className="font-label text-label-sm text-on-surface">
      {roomOccupantCount} na sala
    </span>
  </button>
)}
```

`roomOccupantCount` é calculado em `OfficePage.tsx` como
`(local ? 1 : 0) + media.remotes.length` (mesma fonte de dados que já
alimenta `MediaTiles`/`buildTiles` — não introduz nenhum novo estado ou
fonte de verdade).

`<MediaTiles>` passa a receber `showAllPresent={inMeetingRoom}`:

```tsx
<MediaTiles
  remotes={media.remotes}
  local={local}
  expanded={camerasExpanded}
  onToggleExpanded={() => setCamerasExpanded((value) => !value)}
  showAllPresent={inMeetingRoom}
/>
```

### Fechamento automático ao sair da sala

Se a pessoa sair da sala de reunião enquanto a grade está expandida (ex:
anda pro espaço aberto), `inMeetingRoom` vira `false`, `showAllPresent`
vira `false`, e `hasVisible` volta a exigir câmera/tela ativa — se ninguém
tiver mídia ativa nesse momento, o efeito já existente de auto-recolhimento
(`if (expanded && !hasVisible) onToggleExpanded()`) fecha a grade sozinha.
Nenhuma mudança adicional necessária pra isso funcionar; é consequência
direta da lógica já existente.

## Fora de escopo

- Chat com histórico escopado à sala (Meet-style) — spec separado, maior,
  a ser desenhado depois.
- Qualquer mudança no layout interno da grade expandida (destaque, grid
  uniforme, `AvatarTile`/`VideoTile`) — permanece idêntico.
- Ícone/contador visível fora de sala — explicitamente não existe (botão
  só aparece dentro de sala).

## Testes

- `MediaTiles.test.tsx`: reintroduzir casos equivalentes aos removidos na
  spec anterior para `showAllPresent` — mas agora testando a grade
  **expandida** (não a faixa compacta, que não existe mais): com
  `expanded` e `showAllPresent=true`, a grade abre mesmo com só avatares
  (sem `hasVisible` forçar auto-recolhimento); com `showAllPresent=false`
  (default) e sem câmera/tela ativa, a grade expandida auto-recolhe como
  hoje.
- `OfficePage.test.tsx`: botão de grade aparece só quando `inMeetingRoom`
  (mock de `useOfficeSocket` posicionando o occupant dentro de uma zona de
  reunião do mapa de teste); contador mostra a contagem correta; clicar no
  botão alterna a visibilidade da grade expandida (ex.: assert no `role`
  `region`/`aria-label` "Câmeras em tela cheia" de `MediaTiles`, que não é
  mockado nesses testes).
