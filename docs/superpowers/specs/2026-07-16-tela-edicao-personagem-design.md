# Design — Tela de edição de personagem (fim do modal)

**Data:** 2026-07-16
**Branch:** `feat/tela-edicao-personagem` (a partir da main, pós-merge do guarda-roupa LPC completo)
**Relacionado:** `docs/superpowers/specs/2026-07-16-lpc-guarda-roupa-completo-design.md`

## Problema

Com o guarda-roupa LPC completo (589 definições, ~100 categorias em 7 grupos),
o `AvatarPicker` — um dialog `max-w-lg` — ficou com experiência ruim: preview
pequeno, grade espremida, muita rolagem dentro de um modal estreito. O usuário
quer transformar a edição de personagem em uma **tela própria**.

## Decisões de produto (validadas com o usuário)

1. **Tela única com tudo** — o modal morre; o botão no perfil navega para a
   tela; o modo "Prontos" (12 sorteados) vira um atalho dentro da tela.
2. **Preview grande, fixo e animado** — coluna dedicada com walk cycle e girar
   nas 4 direções, sempre visível (decisão delegada: sem fundo de mapa do
   escritório — imersão não paga o custo).
3. **Salvar volta ao perfil + guarda de mudanças** — salvar navega de volta ao
   perfil; sair com mudanças pendentes pede confirmação.

## Fatos verificados do código

- Rotas: `BrowserRouter` clássico em `apps/web/src/App.tsx` (não é data
  router) → **`useBlocker` indisponível**; guard de navegação é manual.
- Convenção de rotas em pt-BR (`/perfil/:id`, `/escritorio`, `/votar`).
- `ProfilePage.tsx` abre o modal via estado local `pickerOpen` (botão na linha
  ~193, render na ~580).
- Peças reutilizáveis intactas do guarda-roupa: `catalogView.ts` (searchItems,
  setItem, applyBodyType, randomCharacter), `LayerThumb.tsx` (thumbs lazy),
  `CharacterPreview.tsx` (canvas com walk + girar), `useCharacterPortrait`.
- Save atual: PATCH `/auth/me` com `{avatarStyle:'lpc', avatarSeed, avatarOptions}`,
  depois `setUser(res.user)` + `queryClient.invalidateQueries(['profile'])`.

## Arquitetura

### 1. Rota e navegação

- Nova rota protegida **`/personagem`** registrada em `App.tsx` junto às demais.
- `ProfilePage`: o botão de editar personagem vira navegação para `/personagem`
  (só no perfil próprio, como hoje); `pickerOpen` e o render do modal saem.
- `AvatarPicker.tsx` e `AvatarPicker.test.tsx` são **deletados** (conteúdo migra
  para os componentes novos).
- **Salvar**: mesmo PATCH de hoje; em sucesso, `setUser` + invalidate +
  `navigate('/perfil/<id do usuário logado>')`.
- **Cancelar/Voltar** (botões da tela): se dirty, dialog de confirmação
  "Descartar alterações?" (confirmar → navega; cancelar → permanece); se limpo,
  navega direto.
- **Fechar/recarregar a aba** com dirty: `beforeunload` nativo.
- **Limitação aceita e documentada:** cliques no menu/navegação global durante
  a edição não são interceptados (`BrowserRouter` clássico não tem `useBlocker`).
  O guard cobre os controles da própria tela + `beforeunload`.
- **Dirty** = `characterSignature(options) !== characterSignature(inicial)`.
  O `inicial` vem de `resolveCharacterOptions(user)` (fallback
  `defaultCharacterFromSeed`, como o modal faz hoje).

### 2. Layout

**Desktop (≥ lg):** duas colunas.
- **Esquerda (sticky):** preview grande animado (walk cycle + girar 4 direções;
  `CharacterPreview` ganha prop de escala/tamanho), label do corpo, botão
  "Aleatório", seção **"Prontos"** (fileira de 6 retratos sorteados + botão
  "Embaralhar"; clicar num pronto carrega as options dele no editor — marca
  dirty), link de créditos LPC, e rodapé com **Salvar / Cancelar**.
- **Direita:** o guarda-roupa com espaço real — linha de tipos de corpo, abas
  de grupo (`CATEGORY_GROUPS`), chips de categoria do grupo, busca, grade de
  itens larga (6–8 colunas em desktop, com o botão "Nenhum" nas categorias
  opcionais) e variantes do item selecionado.

**Mobile:** coluna única; preview compacto **sticky no topo** (personagem menor
+ botão Salvar sempre visíveis), guarda-roupa rolando abaixo (grade 3–4 colunas).

### 3. Componentes

```
apps/web/src/pages/CharacterEditorPage.tsx      # estado (options, dirty), save, guard, layout
apps/web/src/components/character-editor/
  PreviewPane.tsx                               # preview grande + Aleatório + Prontos + créditos
  WardrobePanel.tsx                             # corpos, grupos, chips, busca, grade, variantes
  PresetsRow.tsx                                # 6 retratos sorteados + Embaralhar
  catalogView.ts                                # MOVIDO de components/avatar-picker (sem mudança de lógica)
  catalogView.test.ts                           # movido junto
  LayerThumb.tsx                                # movido junto (sem mudança de lógica)
```

- `WardrobePanel` recebe `options` + `onChange(options)` — todo o estado vive
  na página (uma fonte de verdade; o guard e o save leem do mesmo lugar).
- `PreviewPane` recebe `options`, `onRandom`, `onPickPreset(options)`.
- `CharacterPreview.tsx` ganha prop opcional de tamanho/escala (default = atual,
  para não mexer nos outros usos).
- Nenhuma mudança em `@legends/shared`, API, contrato ou banco.

### 4. Tratamento de erros

- Falha no PATCH: mensagem de erro na tela (como o modal faz hoje com
  `ApiError`), usuário permanece na página com as edições intactas.
- Rota `/personagem` sem usuário autenticado: `ProtectedRoute` padrão.

## Testes

- **Migram** (mesmos casos, host novo): busca filtra grade, troca de corpo
  re-seleciona categoria stale, seleção de item/variante, save envia
  CharacterOptions v2 com avatarStyle 'lpc' — de `AvatarPicker.test.tsx` para
  `WardrobePanel.test.tsx`/`CharacterEditorPage.test.tsx`.
- **Novos:** guard (dirty → dialog de confirmação, confirmar navega, cancelar
  permanece; limpo → navega direto), navegação pós-save para o perfil,
  preset carrega options e marca dirty.
- **Atualizam:** `ProfilePage.test.tsx` (botão navega em vez de abrir modal),
  testes de rota do `App` (nova rota renderiza).
- `catalogView.test.ts` move junto com o arquivo, sem mudança.

## Riscos assumidos

- Guard não intercepta a navegação global (limitação do `BrowserRouter`);
  migrar para data router fica fora de escopo.
- `beforeunload` mostra o dialog genérico do navegador (não customizável) —
  comportamento padrão da web, aceito.

## Fora de escopo

- Fundo de mapa do escritório no preview.
- Migração para `createBrowserRouter`/data router.
- Qualquer mudança no contrato, API, catálogo ou assets.
