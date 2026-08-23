# Telas responsivas — Engineering Legends (web)

**Data:** 2026-06-16
**Status:** aprovado

## Objetivo

Tornar a aplicação web (`apps/web`) responsiva em três faixas de
dispositivo, sem regressões visuais no desktop atual. O gargalo principal é o
`AppLayout`, que hoje usa uma sidebar fixa de `w-64` com `ml-64` na coluna de
conteúdo e não colapsa em telas estreitas.

## Faixas de dispositivo (breakpoints padrão do Tailwind)

| Faixa    | Largura        | Navegação                                  |
| -------- | -------------- | ------------------------------------------ |
| Mobile   | `< md` (<768)  | Bottom tab bar fixa; sidebar oculta        |
| Tablet   | `md`–`lg`      | Rail compacto (só ícones, `w-20`)          |
| Desktop  | `lg+` (≥1024)  | Sidebar completa `w-64` — igual ao atual   |

Tokens de espaçamento relevantes: `md`=16px, `lg`=24px, `xl`=40px.

## Componentes

### `AppLayout` (`apps/web/src/components/AppLayout.tsx`)

- **Sidebar `<aside>`** ganha responsividade:
  - `hidden md:flex` — oculta no mobile.
  - Largura `md:w-20 lg:w-64` — rail de ícones no tablet, completa no desktop.
  - Labels dos itens e o cabeçalho "Legends / Onde lendas nascem" aparecem só
    em `lg` (`hidden lg:inline` / `hidden lg:block`); no rail tablet ficam só os
    ícones, centralizados.
  - O CTA "Fazer reconhecimento" e o botão "Sair" do rodapé seguem o mesmo
    padrão (ícone-only no tablet, completo no desktop).
- **Coluna principal**: margem responsiva `ml-0 md:ml-20 lg:ml-64`.
- **`<main>`**: `pb-24 md:pb-0` para não ficar atrás da bottom tab bar.
- **Header (`TopAppBar`)**:
  - Busca `hidden sm:block` (some no mobile estreito).
  - Logo "Legends" aparece à esquerda apenas no mobile (`md:hidden`), já que a
    sidebar com o nome some.
  - O menu do avatar passa a incluir **"Sair"** (além de "Alterar senha"), pois
    o botão Sair da sidebar não está disponível no mobile.

### `BottomNav` (novo — `apps/web/src/components/BottomNav.tsx`)

- Barra fixa no rodapé (`fixed bottom-0`), visível só `< md` (`flex md:hidden`).
- Renderiza os mesmos itens de navegação (máx. 5) com ícone + label curto.
- Item ativo destacado (cor primária, ícone preenchido), mesma lógica de
  `activeTo` do layout.
- Selo "Aberta" (pulsante) no item Votar quando `votingOpen`.
- Testável de forma isolada (`BottomNav.test.tsx`).

### Itens de navegação compartilhados

Para evitar duplicação entre a sidebar e o `BottomNav`, a montagem de
`navItems` (que depende de `isAdmin` e do `user`) vira uma função/helper única
consumida por ambos. Decisão de detalhe (helper exportado vs. props) fica para
o plano de implementação.

## Páginas (ajustes finos)

Padrão geral: `p-xl` → `p-lg md:p-xl` nas `<section>` raiz. Grids já colapsam
via `grid-cols-12` e prefixos `sm:`/`md:`/`lg:`; revisão caso a caso:

- **TeamPage** — grid de cards já `sm:grid-cols-2 lg:grid-cols-3`; padding.
- **VotePage** — `grid-cols-12` com `lg:col-span-4/8` (empilha por padrão);
  revisar lista de candidatos (`max-h`/scroll) e grid de selos
  (`grid-cols-2 sm:grid-cols-3`); padding.
- **ProfilePage** — header `md:flex-row`, avatar `md:h-36`; revisar grids
  `grid-cols-12` e padding.
- **LegendsPage** — grid `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` e busca
  `md:w-96` já ok; padding e header `md:flex-row`.
- **HighlightsPage** — grid `sm:grid-cols-2 lg:grid-cols-3`; padding.
- **BadgesPage** — grid `sm:grid-cols-2 lg:grid-cols-3`; padding.
- **LoginPage** — já `lg:grid-cols-2` com aside `hidden lg:block`; verificar
  apenas o formulário no mobile.
- **AdminPage / seções de admin** — revisar tabelas/grids largos (overflow
  horizontal onde necessário) e padding.

## Validação

Screenshots via Playwright em três larguras por tela — ~390px (mobile),
~820px (tablet), ~1440px (desktop) — comparando o estado antes/depois e
confirmando que desktop não regrediu.

## Fora de escopo

- Redesenho visual além do necessário para responsividade.
- Otimização de imagens/performance.
- Mudanças no card de destaque 1080×1080 (exportação, não tela).
