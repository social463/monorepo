# Editar Personagem pelo Toolbar do Escritório — Design

**Data:** 2026-07-16
**Status:** Aprovado

## Objetivo

Hoje o único jeito de chegar na tela de edição de personagem (`/personagem`) é pelo botão "Editar avatar" na própria página de perfil. O chip de iniciais na `MediaBar` (barra fixa no rodapé do escritório virtual) mostra a identidade do usuário logado mas não é clicável. Esta mudança torna esse chip um atalho direto para `/personagem`.

## Decisão de produto

Clicar no chip de iniciais navega para `/personagem` — a mesma navegação que o botão "Editar avatar" do perfil já dispara. Nenhuma tela nova: a rota `/personagem` já existe (`CharacterEditorPage`, sempre edita o usuário autenticado, sem parâmetro de `userId`). Como qualquer navegação para fora de `/escritorio`, o escritório virtual minimiza para o PiP existente (`OfficePipWindow`) — sessão de voz/vídeo continua ativa, sem mudança nesse mecanismo.

## Arquitetura

- `MediaBar` (`apps/web/src/office/media/MediaBar.tsx`) ganha uma prop `onEditCharacter: () => void`, seguindo o padrão de callback já usado por `onLeave`.
- O chip de iniciais (hoje um `<div>` em `MediaBar.tsx:218-228`) vira um `<button type="button" aria-label="Editar personagem" title="Editar personagem" onClick={onEditCharacter}>`, mantendo exatamente o visual atual (iniciais + pontinho de status de conexão sobreposto) — só adiciona o elemento interativo e o feedback de hover/focus consistente com os demais botões da barra.
- `OfficePage.tsx` passa `onEditCharacter={() => navigate('/personagem')}` ao `<MediaBar>` — usa o `navigate` que o componente já importa e usa em `onLeave`.

## Casos de borda

- Nenhum: a rota `/personagem` já trata dirty-check (`window.confirm`/`beforeunload`) e sempre edita o usuário logado — este trabalho não altera nada nela.

## Testes

- `MediaBar.test.tsx`: clicar no chip de iniciais chama `onEditCharacter`; `aria-label`/`title` corretos.
- `OfficePage.test.tsx`: `onEditCharacter` passado à `MediaBar` navega para `/personagem` (mock de `useNavigate`, já usado por outros testes deste arquivo para `onLeave`).
