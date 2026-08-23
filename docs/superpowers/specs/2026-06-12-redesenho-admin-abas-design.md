# Redesenho da tela Admin com abas

**Data:** 2026-06-12
**Status:** Aprovado para implementação

## Objetivo

A tela Admin é hoje um único `<section>` rolável com 6 painéis empilhados
(Período, Colaboradores, Selos, Selos por membro, Categorias, Moderação), cada um
com formulário + lista — o que deixa a página excessivamente longa. Reorganizar
em navegação por abas, esconder os formulários de criação atrás de um botão
"+ Adicionar", e quebrar o componente monolítico em seções focadas.

Mudança puramente de front-end (layout/componentização). Sem alteração de
back-end, schema ou contratos de API.

## Contexto atual

`apps/web/src/pages/AdminPage.tsx` (~960 linhas) concentra: o gate `isAdmin`,
todas as queries/mutations, todo o estado de formulários, e o JSX de todos os
painéis. Componentes auxiliares já existentes no mesmo arquivo:
`HighlightAdmin` (renderizado dentro de `PeriodGroup`), `PeriodGroup`,
`CollaboratorRow`, `MemberBadgesPanel`, e o helper `Panel` + a constante
`inputCls`.

## Decisões (do brainstorming)

1. **Navegação:** abas horizontais; uma seção visível por vez.
2. **Selos:** uma única aba "Selos" com duas áreas — "Catálogo de selos" (CRUD) e
   "Conceder a membro" (o `MemberBadgesPanel`).
3. **Formulários:** os formulários de criação ficam escondidos atrás de um botão
   "+ Adicionar"; revelados inline; recolhem ao salvar com sucesso. Edição mantém
   o comportamento inline atual.
4. **Estrutura:** extrair cada seção em componente próprio numa pasta
   `apps/web/src/pages/admin/`.

## Navegação por abas

5 abas, renderizando só a seção ativa:

| Aba (id) | Conteúdo |
|---|---|
| Períodos (`periodos`) | agendamento + grupos (Em andamento / Agendados / Encerrados) + Destaque do mês (embutido em cada período via `HighlightAdmin`) |
| Colaboradores (`colaboradores`) | lista + adicionar/editar |
| Selos (`selos`) | área "Catálogo de selos" (CRUD) + área "Conceder a membro" |
| Categorias (`categorias`) | lista + adicionar/ativar |
| Moderação (`moderacao`) | lista de votos + remover |

- Estado local `activeTab` em `AdminPage`, default `'periodos'`.
- `TabBar` recebe a lista de abas (`{ id, label }[]`), o `activeTab` e
  `onChange`. Aba ativa: `border-b-2 border-primary text-primary`; inativa:
  `text-on-surface-variant hover:text-on-surface`. A barra é rolável na
  horizontal em telas estreitas (`overflow-x-auto`).
- Trocar de aba não refaz fetch: cada seção usa as mesmas query keys
  (`['admin','users']`, `['admin','badges']`, `['admin','categories']`,
  `['admin','periods']`, `['admin','votes']`), e o cache do React Query é
  compartilhado pelo `QueryClientProvider` da app.

## Formulários recolhíveis "+ Adicionar"

Cada formulário de criação fica atrás de um botão de ação no canto superior
direito do painel (o componente `Panel` já aceita um slot `action`):

- Períodos: "+ Agendar período" → revela o form de agendamento.
- Colaboradores: "+ Adicionar colaborador" → revela o form.
- Selos / Catálogo: "+ Adicionar selo" → revela o form.
- Categorias: "+ Adicionar categoria" → revela o form.

Padrão de implementação:
- Estado local `showForm` (boolean) por seção; o botão alterna a exibição do
  **mesmo** formulário que já existe hoje (sem modal — o codebase não tem sistema
  de modal/drawer).
- Ao salvar com sucesso (`onSuccess` da mutation correspondente), `showForm` volta
  a `false` (recolhe). Erros (`role="alert"`) seguem exibidos no form aberto.
- O botão de ação alterna rótulo/estado (ex.: "+ Adicionar selo" ↔ "Cancelar")
  ou some quando o form está aberto, mantendo o botão "Cancelar" do próprio form.
- Fluxos de **edição** (editar selo, editar colaborador) não mudam: continuam
  inline como hoje. Para selos, abrir o form de edição (via `startBadgeEdit`)
  também deve garantir `showForm = true`.
- A área "Conceder a membro" não muda (dropdown já é enxuto).

## Estrutura de arquivos

```
pages/AdminPage.tsx                  → casca: gate isAdmin, header, <TabBar>, switch da aba ativa, estado activeTab
pages/admin/TabBar.tsx               → barra de abas
pages/admin/PeriodsSection.tsx       → agendamento + PeriodGroup(s) (+ HighlightAdmin embutido)
pages/admin/CollaboratorsSection.tsx → lista + form de criação + CollaboratorRow
pages/admin/BadgesSection.tsx        → Catálogo (CRUD) + MemberBadgesPanel
pages/admin/CategoriesSection.tsx    → lista + form de criação
pages/admin/ModerationSection.tsx    → lista de votos + remover
pages/admin/shared.tsx               → Panel, inputCls, e tipos/utilitários compartilhados
```

- Helpers auxiliares migram para perto de quem os usa: `HighlightAdmin`,
  `PeriodGroup` → `PeriodsSection.tsx`; `CollaboratorRow` →
  `CollaboratorsSection.tsx`; `MemberBadgesPanel` → `BadgesSection.tsx`.
- `Panel` e `inputCls` vão para `pages/admin/shared.tsx` e são importados pelas
  seções e pela casca.
- Cada seção faz seus próprios `useQuery`/`useMutation` e detém seu próprio
  estado de formulário (`showForm`, campos, erros), movido do componente
  monolítico. A casca não passa dados por props além do necessário; as seções são
  auto-suficientes (buscam o que precisam via React Query).
- `AdminPage.tsx` final: gate `isAdmin`, `<header>`, `<TabBar>`, e um switch que
  renderiza o componente da aba ativa.

### Fronteiras de cada unidade
- **TabBar**: dado `tabs`, `activeTab`, `onChange`, renderiza a navegação. Sem
  conhecimento das seções.
- **Cada `*Section`**: encapsula uma aba completa (dados + estado + JSX). Pode ser
  entendida e testada isoladamente.

## Tratamento de erros

Inalterado por seção: mensagens via `role="alert"` + ícone `error`, no padrão
atual. As mutations mantêm seus `onError` setando o estado de erro local da
seção.

## Testes

Sem mudança de back-end (os 187 testes de API permanecem intocados).

`apps/web/src/pages/AdminPage.test.tsx` (11 testes atuais) assume todos os
painéis na mesma página. Plano:
- **Migrar os testes existentes** para navegar até a aba certa antes de
  interagir (ex.: clicar "Colaboradores" antes de editar; "Selos" antes de
  conceder selo; "Categorias" antes de criar categoria). Mudança mecânica,
  preservando as asserções.
- **Adicionar testes de navegação**:
  - A aba default (Períodos) é exibida ao montar.
  - Clicar numa aba troca o conteúdo exibido (uma seção visível por vez).
  - O botão "+ Adicionar" revela o formulário; salvar recolhe; "Cancelar" recolhe.
- Manter a suíte no `AdminPage.test.tsx` migrado + os testes de navegação. **Não**
  reescrever tudo em arquivos `*Section.test.tsx` separados agora (escopo
  controlado); seções novas podem ganhar testes próprios oportunamente.

## Fora de escopo (YAGNI)

- Persistir a aba ativa na URL (`?tab=`) — fica como melhoria futura; por ora
  estado local com default Períodos.
- Modais/drawers para os formulários (mantém reveal inline).
- Redesenho visual dos cards/itens internos além do necessário para as abas e o
  reveal dos formulários.
- Testes unitários separados por seção (migra-se a suíte atual).
- Qualquer mudança de back-end, schema ou DTO.
