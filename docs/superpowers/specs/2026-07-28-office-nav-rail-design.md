# Rail de navegação do escritório

Data: 2026-07-28
Branch: `feat/office-toolbar-dock`

## Contexto

O escritório virtual (`apps/web/src/pages/OfficePage.tsx`) roda fora do `AppLayout`
(a rota `/escritorio` é isolada/fullscreen — ver `App.tsx`), então não herda a
sidebar de navegação do resto do app (`AppLayout.tsx`, componente `nav-items.ts`).
Como resultado, itens de navegação/gestão do escritório (pessoas online,
notificações, editar mapa) ficaram espalhados em pontos isolados da tela: um
botão flutuante próprio para expandir/recolher a lista de pessoas
(`OfficePage.tsx:333-392`), e um dock no canto superior direito — unificado
recentemente — para notificações e "Editar mapa" (`OfficePage.tsx:441-477`).

Ferramentas de escritório virtual comparáveis (Gather, SoWork) resolvem isso
com um **rail vertical fino e persistente** na borda esquerda, com ícones de
navegação/gestão — distinto da barra de controles de chamada (nossa
`MediaBar`, que já segue o padrão universal de barra inferior de apps de
chamada e não muda). Este spec adota esse padrão para os itens de navegação do
escritório, reaproveitando a linguagem visual "glass neon" já estabelecida na
`MediaBar` (`docs/superpowers/specs/2026-07-27-mediabar-menu-mais-design.md`).

## Escopo

1. Criar um rail vertical fixo na borda esquerda do escritório, com os itens:
   **Pessoas online**, **Notificações**, **Editar mapa** (só não-convidado).
2. Reposicionar o painel de pessoas online (`PeopleList`) para abrir ao lado
   do rail, em vez de a partir de `left-0`.
3. Adicionar uma variante de ancoragem ao `NotificationBell` para o dropdown
   abrir à direita do ícone (hoje ele assume que nasce no canto superior
   direito da tela e abre para baixo-e-esquerda).
4. Remover o dock unificado do canto superior direito (`OfficePage.tsx:441-477`,
   commit `256d27f2`) — seus itens migram para o rail.
5. Estruturar os itens do rail em um array centralizado, para que novos itens
   futuros (squad, mural, configurações, o que surgir) exijam só uma entrada
   nesse array, sem tocar em `OfficePage.tsx` de novo.

**Fora de escopo:** a "Grade de câmeras / N na sala" continua fora do rail —
é estado de chamada ao vivo (só existe dentro de sala de reunião), não
navegação, e permanece onde está hoje. O botão "Sair" continua na `MediaBar`
(ação de sessão, não navegação). A sidebar de navegação do app principal
(`AppLayout.tsx`) não é tocada — o escritório continua fora dela; este rail é
específico do escritório, não uma tentativa de unificar os dois padrões.

## Estrutura visual do rail

Faixa vertical fixa `fixed inset-y-0 left-0 z-30`, largura `w-[68px]`, mesma
linguagem visual da `MediaBar`: `bg-surface/70 backdrop-blur-xl border-r
border-primary-container/20`. Itens empilhados verticalmente, cada um um
botão circular (`h-11 w-11 rounded-full`, marcador `office-toolbar-btn` para
herdar o hover-glow já definido em `index.css`), centralizado horizontalmente
na faixa, com espaçamento vertical confortável (`gap-sm`, `py-md` no topo).

Cada item usa o mesmo par de classes já estabelecido na `MediaBar` para
distinguir estado ativo/inativo:
- **Inativo (painel fechado):** `text-on-surface-variant`, hover
  `hover:border-primary-container/30 hover:bg-primary-container/10
  hover:text-primary-container hover:shadow-[0_0_15px_rgba(37,222,136,0.3)]`.
- **Ativo (painel aberto):** `border-primary-container/40
  bg-primary-container/20 text-primary-container
  shadow-[0_0_15px_rgba(37,222,136,0.3)]` — persistente, mesma treatment de
  `highlightButtonCls` da `MediaBar`.

Itens, de cima para baixo:

1. **Pessoas online** (`groups`) — sempre visível. `aria-label`/`aria-pressed`
   refletem `peopleSidebarOpen`. Ativo = painel de pessoas aberto.
2. **Notificações** (`notifications`) — só `!isGuest`. Badge de não lidas
   preservado (mesmo comportamento de hoje). Ativo = dropdown de notificações
   aberto.
3. **Editar mapa** (`edit`) — só `!isGuest && !editing.state.active`. Sem
   estado de "ativo" no rail em si (clicar já dispara `editing.enter()` e sai
   do fluxo do escritório para o modo de edição — mesmo comportamento de
   hoje).

## Componentes novos

### `apps/web/src/office/nav/office-nav-items.ts`

Array de configuração, análogo em espírito ao `nav-items.ts` do app
principal, mas para toggles de painel (não rotas):

```ts
export interface OfficeNavItemConfig {
  id: string
  icon: string
  label: string
}

export const OFFICE_NAV_ITEMS = {
  people: { id: 'people', icon: 'groups', label: 'Pessoas online' },
  notifications: { id: 'notifications', icon: 'notifications', label: 'Notificações' },
  editMap: { id: 'editMap', icon: 'edit', label: 'Editar mapa' },
} as const satisfies Record<string, OfficeNavItemConfig>
```

Um item futuro (ex.: "Mural") só precisa de uma nova entrada aqui + o botão
correspondente em `OfficeNavRail`, seguindo o mesmo padrão dos três atuais —
não há necessidade de um sistema de plugins mais elaborado para o volume atual
de itens (3, escalando para talvez 5-6): YAGNI.

### `apps/web/src/office/nav/OfficeNavRail.tsx`

Componente de apresentação. Recebe via props tudo que precisa (estado
`peopleSidebarOpen`/setter, se `notificationsOpen` (novo estado local do
`NotificationBell` passado a subir — ver seção seguinte), `isGuest`,
`editing.state.active`, e o handler `onEditMap`). Renderiza a faixa + os 3
botões (2 deles condicionais). Segue o mesmo padrão de "componente de
apresentação, sem lógica de negócio própria" já usado por `DeviceMenu`,
`MediaBarMoreMenu`, etc.

## Notificações: nova âncora do dropdown

`NotificationBell.tsx` já tem um `variant` (`'default' | 'bare'`, adicionado
na revisão visual da `MediaBar`) controlando a aparência do botão-gatilho.
Este spec adiciona um segundo prop independente, `anchor?: 'right' | 'bottom'`
(default `'bottom'`, preservando o comportamento atual em `AppLayout.tsx` e em
qualquer outro uso existente):

- `anchor="bottom"` (hoje): painel abre `fixed inset-x-sm top-[4.75rem] ...
  md:absolute md:right-0 md:top-full` — inalterado.
- `anchor="right"` (novo, só usado no rail do escritório): painel abre
  `absolute left-full top-0 ml-sm w-80 ...` — nasce à direita do ícone,
  alinhado ao topo do botão, mesma largura (`w-80`) e mesmo conteúdo interno
  (lista, "Ver todas") do painel atual.

O botão-gatilho em si usa `variant="bare"` (já existe) dentro do rail, igual
ao dock que está sendo substituído.

## Painel de pessoas online — reposicionamento

O `<aside>` de `PeopleList` (`OfficePage.tsx:334-392`) deixa de nascer em
`left-0` e passa a nascer em `left-[68px]` (largura do rail), mantendo
exatamente a mesma largura (`18.25rem`), conteúdo e estado
(`peopleSidebarOpen`, `peopleSearch`). O botão próprio de
expandir/recolher que hoje aparece quando o painel está fechado
(`aria-label="Expandir pessoas online"`, ícone `dock_to_right`) é removido —
essa função passa a ser exclusivamente do item "Pessoas online" no rail. O
botão de recolher DENTRO do cabeçalho do painel aberto (`aria-label="Recolher
pessoas online"`) continua existindo sem mudanças — só mais uma forma de
fechar o mesmo estado, redundante com clicar de novo no rail, sem conflito.

## Remoção do dock top-right

O bloco inteiro `OfficePage.tsx:441-477` (o `<div className="absolute top-3
right-3 ...">` com `NotificationBell`, "Editar mapa" e a grade de câmeras)
é substituído: notificações e "Editar mapa" migram para o `OfficeNavRail`; a
grade de câmeras ("N na sala") continua como um elemento independente,
posicionado no canto superior direito como estava antes da unificação
recente (ela não pertence ao rail — ver "Fora de escopo").

## Testes

- Novo `apps/web/src/office/nav/OfficeNavRail.test.tsx`: cada item
  renderiza/some conforme a condição (`isGuest`, `editing.state.active`);
  clicar em "Pessoas online" chama o setter; clicar em "Notificações" abre o
  dropdown (via `NotificationBell` real, não mock, para cobrir a integração
  real); clicar em "Editar mapa" chama `onEditMap`; estado ativo aplica a
  classe de destaque.
- `NotificationBell.test.tsx`: novo teste para `anchor="right"` — dropdown
  renderiza com a classe de posicionamento esperada; `anchor` omitido/
  `"bottom"` continua idêntico ao comportamento já testado hoje.
- `OfficePage.test.tsx`: testes que hoje interagem com "Expandir/Recolher
  pessoas online" via o botão flutuante próprio passam a interagir via o
  item do rail (mesmo `aria-label`, só muda o container). Testes que hoje
  buscam "Editar mapa"/notificações no dock top-right precisam apenas trocar
  o ponto de busca — mesmos `aria-label`/comportamento.

## Riscos / pontos de atenção

- `NotificationBell` é componente compartilhado com `AppLayout.tsx` (fora do
  escritório) — os dois novos props (`variant`, agora também `anchor`) têm
  defaults que preservam 100% o comportamento atual lá; nenhuma mudança
  visual ou funcional é esperada fora do escritório.
- O rail ocupa 68px fixos na borda esquerda o tempo todo — diferente do dock
  anterior (que só aparecia quando havia pelo menos 1 item condicional
  visível). Em guest mode, com "Pessoas online" como único item, o rail
  ainda aparece com 1 ícone só — aceitável (guests já veem o botão
  independente de pessoas online hoje, então não é uma tela mais cheia do
  que antes, só reorganizada).
- `PeopleList`/painel de pessoas não muda de lógica interna, só de âncora
  (`left-0` → `left-[68px]`) — baixo risco.
