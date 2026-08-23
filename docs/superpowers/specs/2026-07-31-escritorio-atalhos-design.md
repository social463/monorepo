# Atalhos do escritorio — design

**Data:** 2026-07-31
**Task:** 22288
**Branch:** `feat/22288-atalhos-escritorio`
**Status:** Planned

## Contexto

O escritorio (`apps/web/src/pages/OfficePage.tsx`) ja centraliza alguns atalhos
em React (`Enter`, `Ctrl/Cmd+D`, `M`, Espaco, `L`) e outros na cena Phaser
(`WASD`, setas, `F`, `R`, mouse esquerdo, mouse direito). Existem ainda hooks
de runtime com `E` para interacoes proximas, como kart e links.

O rail esquerdo ja e o lugar persistente de navegacao/gestao do escritorio
(`apps/web/src/office/nav/OfficeNavRail.tsx`). A nova entrada de configuracoes
deve seguir esse padrao: botao iconico no rail, painel lateral abrindo ao lado,
sem competir com a `MediaBar` inferior.

## Decisao de UX

1. Adicionar um botao "Configuracoes" no `OfficeNavRail`, usando icone de
   engrenagem.
2. Ao abrir, mostrar um painel lateral ao lado do rail com uma interface de tabs.
   A primeira aba planejada para esta task e "Atalhos".
3. A aba "Atalhos" lista cards/linhas compactas agrupadas por contexto:
   movimentacao, interacoes, audio e reuniao, tela/painel.
4. Itens de menu e botoes com atalhos ganham um marcador pequeno alinhado a
   direita, por exemplo um `kbd` visual com `H` ou `L`.
5. Tooltips existentes podem incluir o atalho entre parenteses quando ja for o
   padrao local, mas o marcador visual no menu e o ponto principal de descoberta.

## Componentes e Arquivos Esperados

### `apps/web/src/office/nav/office-nav-items.ts`

Adicionar item `settings` ao catalogo do rail:

- `id: 'settings'`
- `icon: 'settings'`
- `label: 'Configuracoes'`

### `apps/web/src/office/nav/OfficeNavRail.tsx`

Adicionar props para estado do painel de configuracoes:

- `settingsOpen`
- `onToggleSettings`

O botao deve seguir `railButtonCls(settingsOpen)` e fechar paineis concorrentes
em `OfficePage`, assim como Pessoas e Notificacoes ja fazem.

### Novo componente de painel

Criar componente de apresentacao, por exemplo:

- `apps/web/src/office/settings/OfficeSettingsPanel.tsx`

Responsabilidades:

- Renderizar cabecalho "Configuracoes".
- Renderizar tablist com "Atalhos".
- Renderizar a lista de atalhos a partir de uma estrutura declarativa.
- Fechar pelo botao de recolher, sem gerenciar regra de negocio do escritorio.

### Catalogo de atalhos

Criar estrutura local e estatica, por exemplo:

- `apps/web/src/office/settings/office-shortcuts.ts`

Formato esperado:

```ts
export interface OfficeShortcutItem {
  keys: string[]
  label: string
  context: string
}
```

Esse catalogo alimenta o painel e evita duplicar texto em teste. Nao precisa
vir de `@legends/shared`, pois e uma decisao de UI do web e nao contrato
api/web.

### Marcador compacto de tecla

Criar componente pequeno reutilizavel no escopo do escritorio, por exemplo:

- `apps/web/src/office/settings/ShortcutKeycap.tsx`

Uso previsto:

- Lista de atalhos no painel.
- `MediaBarMoreMenu` para `H`, `L`, `P`, `E` ou outras acoes aplicaveis.
- Toolbars compactas quando houver espaco.

O marcador deve ter dimensoes estaveis, texto curto e nao alterar altura dos
itens existentes.

## Atalho `H`

Implementar em `OfficePage.tsx`, no mesmo estilo do atalho `L`:

- ignorar `repeat`;
- ignorar `ctrlKey`, `altKey`, `metaKey`, `shiftKey`;
- ignorar foco em campo de texto via `isTextInputTarget`;
- exigir `raisedHands.canRaise`;
- chamar `raisedHands.toggle()`;
- usar `preventDefault()`.

Esse atalho fica no React porque a regra de disponibilidade e a action ja estao
em `raisedHands`, igual a `L` usa `roomLock`.

## Atalhos Listados no Painel

| Grupo | Atalhos |
| --- | --- |
| Movimento | `W/A/S/D`, setas, `Shift`, mouse direito, mouse esquerdo arrastando |
| Interacoes | `E`, `Ctrl/Cmd+D`, `Enter`, `F`, `R`, `1-8` |
| Audio e reuniao | `M`, Espaco, `H`, `L` |
| Tela e paineis | `P`, `Escape` |

## Regras de Disponibilidade

- A lista pode mostrar atalhos mesmo quando a acao depende de contexto.
- Cada linha deve explicar o contexto em texto curto, por exemplo "em sala
  travavel" para `L`.
- O marcador no botao/menu so aparece para acoes renderizadas naquele contexto.
- Convidado nao deve ver acoes que nao existem para ele no menu; o painel pode
  listar atalhos gerais do escritorio.

## Acessibilidade

- O botao do rail deve ter `aria-label="Configuracoes"` e `aria-pressed`.
- O painel deve ter titulo visivel e botao de fechar com `aria-label`.
- Tabs devem usar `role="tablist"` e `role="tab"` se houver mais de uma aba.
- Marcadores de tecla devem ser decorativos quando repetem texto ja presente no
  nome acessivel do item.

## Testes Planejados

- `apps/web/src/pages/OfficePage.test.tsx`
  - `H` chama `raisedHands.toggle` quando `canRaise=true`.
  - `H` nao chama nada quando `canRaise=false`.
  - `H` nao interfere com foco em campo de texto.
  - abrir configuracoes pelo rail mostra a aba "Atalhos".

- `apps/web/src/office/nav/OfficeNavRail.test.tsx`
  - renderiza botao de configuracoes e aciona `onToggleSettings`.
  - aplica estado ativo quando `settingsOpen=true`.

- `apps/web/src/office/media/MediaBarMoreMenu.test.tsx`
  - mostra marcador `H` no item de levantar mao.
  - mostra marcador `L` no item de trancar sala.
  - mantem acessibilidade dos menuitems.

## Plano de Implementacao Futuro

1. Adicionar catalogo e componentes visuais de atalhos.
2. Estender `OfficeNavRail` e `OfficePage` com painel de configuracoes.
3. Implementar hotkey `H`.
4. Adicionar marcadores compactos nos itens de menu/botoes relevantes.
5. Rodar testes focados do web.

Nenhum passo de implementacao foi executado neste momento; este documento
apenas prepara a task.
