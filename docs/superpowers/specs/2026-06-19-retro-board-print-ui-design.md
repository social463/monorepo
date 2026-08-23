# Design — Ajustes de UI do Board (modelo do print: tela cheia, layout 2×2, instruções, zoom)

- **Data:** 2026-06-19
- **Status:** aprovado (aguardando revisão final do spec)
- **Branch:** `feat/retro-board`
- **Escopo:** **frontend apenas** (+ ajuste de coordenadas numa constante de layout do `@legends/shared`). Sem API/DB/migration.
- **Referência visual:** print de ferramenta de retro (Metro Retro-like) enviado pelo usuário.

## Objetivo

Aproximar a UX do board de retrospectiva ao modelo do print, em quatro frentes acordadas:

1. **Sala em tela cheia** com navegação restrita a **Sair** (sem a sidebar/nav do app).
2. **Layout 2×2** dos quadrantes + região **Ações** deslocada à direita com uma **seta "→"**.
3. **Painel de instruções** numeradas no topo do board.
4. **Controles de zoom** no canto inferior direito (−, %, +, centralizar).

**Fora deste round** (adiado, cada um vira seu próprio ciclo): renomear regiões para
Drop/Add/Keep/Improve e templates de board (F); top bar com "Start Meeting" (D);
toolbar de ferramentas novas — conectores, caneta, formas, carimbos, frames (E).

## 1. Sala em tela cheia + chrome enxuto

Hoje `RetroRoomPage` renderiza dentro do `AppLayout` (sidebar + top bar do app), via
o bloco de rotas com `<ProtectedRoute><AppLayout/></ProtectedRoute>` em `App.tsx`.

- **Mover a rota `/retrospectivas/:id` para fora do `AppLayout`** — vira rota protegida
  full-screen (padrão de `/alterar-senha`): `<ProtectedRoute><DevOnly><RetroRoomPage/></DevOnly></ProtectedRoute>`.
  A **lista** `/retrospectivas` **permanece** dentro do `AppLayout`.
- `RetroRoomPage` desenha a **própria top bar enxuta** (ocupando a largura toda):
  - Esquerda: título da sala + status ("Aberta"/"Concluída").
  - Direita: presença (avatares/"N online"), **Concluir** (só facilitador, se `OPEN`), e
    **Sair** → `navigate('/retrospectivas')`.
  - Sem sidebar, sem itens de navegação do app.
- O canvas ocupa o restante da viewport (tela cheia, `h-screen` menos a top bar).

## 2. Layout 2×2 + Ações com seta

`RETRO_REGIONS` (constante de layout em `packages/shared/src/retro.ts`, consumida só
pelo web) muda de "5 regiões em fila" para:

- **4 quadrantes em grid 2×2** (coordenadas de mundo): `went_well` (sup. esq.),
  `went_bad` (sup. dir.), `start` (inf. esq.), `stop` (inf. dir.).
- **`actions`** como 5ª região **deslocada à direita**, centralizada verticalmente em
  relação ao bloco 2×2.
- Os `id`/`label` permanecem os atuais (Bom/Ruim/Começar/Parar/Ações) — renomear é o
  item F (adiado). Só mudam as coordenadas `x/y` (e eventualmente `w/h`).
- **Seta "→"**: elemento visual desenhado no mundo entre o bloco de quadrantes e a
  região Ações. Renderizado em `RegionsBackground` (ou componente irmão), em
  coordenadas de mundo (acompanha pan/zoom). Constante de posição derivada das
  coordenadas das regiões (não hardcode solto).

Cards já existentes não têm vínculo com região (a categoria foi removida no redesign
anterior), então a mudança de coordenadas das regiões **não afeta dados** — só o fundo
visual. Post-its mantêm seus `x/y` próprios.

## 3. Painel de instruções

Bloco renderizado no **topo do mundo** (acima dos quadrantes; acompanha pan/zoom, como
no print). Componente `BoardInstructions` no layer do mundo, em coordenada de mundo
fixa acima das regiões.

Conteúdo (PT, adaptado do print ao nosso modelo):

> **{título da sala}**
> 1. Escolha o tópico da discussão (ex.: a última sprint).
> 2. Cada pessoa adiciona post-its nas quatro áreas com ideias/feedback.
> 3. Discutam em grupo e usem os votos para priorizar.
> 4. Reajam aos post-its com que concordam.
> 5. Registrem as Ações de acompanhamento a partir dos pontos mais votados.

Os passos são **estáticos** (constante no front). O título vem da sala (`room.title`).

## 4. Controles de zoom (canto inferior direito)

- Cluster fixo (screen space, não world) no canto inferior direito: **−** | **{zoom}%** |
  **+** | **centralizar**.
- Estende `useCanvasViewport`:
  - `zoomIn()` / `zoomOut()` — aplicam o mesmo passo/clamp `[0.3, 2.5]` do `zoomAt`,
    em torno do **centro da viewport** (sem precisar de evento de ponteiro).
  - `reset()` — restaura `pan`/`zoom` ao estado inicial.
  - O `%` exibe `Math.round(zoom * 100)`.
- Reaproveita a infra de pan/zoom já existente; nada de novo no transform.

## Componentes e arquivos (frontend)

- `apps/web/src/App.tsx` — mover a rota `/retrospectivas/:id` para fora do `AppLayout`.
- `apps/web/src/pages/RetroRoomPage.tsx` — top bar full-screen (título/status/presença/
  Concluir/**Sair**); layout full-screen; render do `BoardInstructions` no mundo;
  cluster de zoom; fiação dos novos controles do viewport.
- `apps/web/src/pages/retro/RegionsBackground.tsx` — render dos 4 quadrantes + Ações na
  nova disposição + a seta.
- `apps/web/src/pages/retro/use-canvas-viewport.ts` — `zoomIn`/`zoomOut`/`reset`.
- `apps/web/src/pages/retro/BoardInstructions.tsx` — **novo**; painel de instruções no
  mundo.
- `apps/web/src/pages/retro/ZoomControls.tsx` — **novo**; cluster de zoom.
- `packages/shared/src/retro.ts` — novas coordenadas de `RETRO_REGIONS` (2×2 + Ações).

## Testes

Vitest + jsdom + Testing Library. Sem testes de API (round é frontend).

- **`use-canvas-viewport.test.ts`**: `zoomIn`/`zoomOut` respeitam o clamp `[0.3, 2.5]`;
  `reset()` volta `pan`/`zoom` ao inicial; `worldToScreen`/`screenToWorld` inalterados.
- **`RetroRoomPage.test.tsx`**: renderiza a top bar full-screen com **Sair** que navega
  para `/retrospectivas`; renderiza `BoardInstructions` (passo 1 visível); renderiza os
  controles de zoom e clicar **+**/**−** muda o `%`; os 4 quadrantes + Ações presentes
  (labels). Mock de `retro-api`/`useRetroSocket`/`AuthContext` como nos testes atuais.
- **Regressão de rota**: o teste existente que monta `RetroRoomPage` via `MemoryRouter`
  continua válido (a página não depende mais do `AppLayout`).
- `RETRO_REGIONS`: ajustar o teste do shared se ele assertar coordenadas/contagem
  (mantém 5 regiões; muda disposição).

## Riscos e decisões conscientes

- **Mover a rota para fora do `AppLayout`** muda onde a sala vive na árvore de rotas;
  garantir que `ProtectedRoute` (e `DevOnly`) continuam envolvendo a sala, e que a
  lista segue dentro do layout.
- **Instruções e regiões em coordenadas de mundo**: posições relativas precisam ficar
  coerentes (instruções acima do bloco; Ações à direita; seta entre eles) em qualquer
  zoom. Derivar posições das constantes de `RETRO_REGIONS` evita números mágicos soltos.
- **`reset()` "centralizar"** volta ao estado inicial do viewport (mesmo default de
  hoje), não um "fit-to-content" calculado — suficiente para o v1 deste round.

## Fora do escopo deste round

- Renomear regiões para Drop/Add/Keep/Improve e templates de board selecionáveis (F).
- Top bar com nome-dropdown e **Start Meeting** / timer de sessão (D).
- Toolbar lateral de ferramentas novas: conectores, caneta, formas, carimbos de emoji,
  frames, votação com corações (E).
- Busca, Share, sino, menu do canto superior direito do print.
