# PRD — Favoritar personagem criado

**Data:** 2026-07-17
**Task:** 21871
**Branch:** `task/21871-favoritar-personagem`
**Status:** Implemented

## Problema

Hoje o usuario tem apenas um visual LPC salvo no perfil (`avatarOptions`). Ao
experimentar roupas, corpo, cabelo ou acessorios na tela `/personagem`, ele
precisa sobrescrever o visual atual para testar uma combinacao nova. Isso torna
a edicao arriscada: se o usuario gosta do visual atual, ele evita explorar.

## Objetivos

- Permitir que o usuario salve visuais em 5 slots fixos de personagem.
- Permitir que o usuario substitua um slot ocupado por um visual novo.
- Permitir carregar um slot salvo no editor e aplicar o visual pelo botão "Salvar".
- Preservar o fluxo atual de edicao/salvamento do personagem.
- Impedir que o usuario perca o visual atual enquanto experimenta novas opcoes.

## Fora de Escopo

| Item | Motivo |
| --- | --- |
| Compartilhar favoritos entre usuarios | A task fala apenas de salvar personagem proprio. |
| Favoritos publicos ou ranking de visuais | Nao resolve o problema principal. |
| Sincronizacao em tempo real entre abas | O fluxo atual de perfil ja trabalha por refresh/cache local. |
| Mais de 5 slots | O limite definido no card e 5. |
| Suporte a avatar legado `open-peeps` | O avatar atual do produto e LPC (`avatarStyle: 'lpc'`). |

## Referencia de Produto

A referencia e o guarda-roupa do Habbo Hotel: o usuario monta o visual do
personagem e salva esse outfit em um slot para uso posterior. A documentacao
oficial antiga do Habbo Club descreve o fluxo como vestir o Habbo, clicar na
acao de salvar e guardar o outfit em um dos slots disponiveis. Para Legends, a
mesma ideia sera adaptada para **5 slots fixos**, visiveis na tela de edicao de
personagem.

## Usuarios

- **Colaborador autenticado:** edita o proprio personagem, salva visuais
  favoritos, aplica um favorito como visual atual.
- **Sistema:** valida slot 1-5, ownership e formato `CharacterOptions` antes de
  persistir.

## Historias

### P1: Salvar visual atual em um slot

**User Story:** Como colaborador, quero salvar o visual que estou montando em um
dos 5 slots para poder voltar a ele depois sem perder meu visual atual.

**Criterios de aceite:**

1. WHEN o usuario esta em `/personagem` com um visual valido THEN o sistema
   SHALL mostrar 5 slots de visual.
2. WHEN o usuario escolhe um slot vazio THEN o sistema SHALL persistir
   `CharacterOptions` v2 naquele slot, retornar o slot atualizado e atualizar a
   UI.
3. WHEN o usuario escolhe um slot ocupado THEN o sistema SHALL sobrescrever o
   slot escolhido com o visual em edicao.
4. WHEN o payload de personagem e invalido THEN o sistema SHALL responder 400 e
   nao alterar o slot.

**Independent Test:** Salvar o visual atual no slot 1, recarregar a pagina e ver
o slot 1 preenchido com o mesmo preview.

### P1: Aplicar slot como visual atual

**User Story:** Como colaborador, quero aplicar um visual salvo em slot para
recuperar rapidamente uma combinacao que ja criei.

**Criterios de aceite:**

1. WHEN o usuario clica em um slot preenchido THEN a tela SHALL carregar aquele
   visual no editor sem salvar automaticamente.
2. WHEN o usuario clica em "Salvar" depois de carregar um slot THEN o sistema
   SHALL atualizar `avatarStyle: 'lpc'`, `avatarSeed` e `avatarOptions` pelo
   fluxo existente de `PATCH /auth/me`.
3. WHEN o save falha THEN o sistema SHALL manter o usuario na tela e mostrar
   erro em pt-BR.

**Independent Test:** Salvar dois slots diferentes, clicar em um deles, confirmar
que a tela permanece em `/personagem`, depois clicar em "Salvar" e ver
perfil/escritorio usando o visual aplicado.

### P2: Gerenciar slots

**User Story:** Como colaborador, quero ver quais slots estao preenchidos, quais
estao vazios e limpar slots que nao uso mais.

**Criterios de aceite:**

1. WHEN o usuario abre `/personagem` THEN o sistema SHALL mostrar sempre 5 slots,
   preenchidos ou vazios.
2. WHEN o slot esta preenchido THEN a UI SHALL mostrar preview do personagem e
   acoes para usar/substituir/limpar.
3. WHEN o slot esta vazio THEN a UI SHALL mostrar estado vazio e acao para salvar
   o visual atual naquele slot.
4. WHEN o usuario limpa um slot THEN o sistema SHALL esvaziar apenas aquele slot
   do usuario autenticado.

**Independent Test:** Salvar e limpar o slot 2, recarregar a pagina e confirmar
que o slot 2 aparece vazio.

## Requisitos Rastreaveis

| ID | Requisito | Prioridade | Status |
| --- | --- | --- | --- |
| FAVCHAR-01 | Salvar `CharacterOptions` v2 em um dos 5 slots do usuario autenticado. | P1 | Pending |
| FAVCHAR-02 | Mostrar sempre 5 slots, preenchidos ou vazios. | P1 | Pending |
| FAVCHAR-03 | Substituir slot ocupado direto pela acao do usuario. | P1 | Pending |
| FAVCHAR-04 | Carregar slot no editor e aplicar pelo botão "Salvar". | P1 | Pending |
| FAVCHAR-05 | Limpar slot proprio. | P2 | Pending |
| FAVCHAR-06 | Persistir cada slot por indice fixo de 1 a 5. | P1 | Pending |
| FAVCHAR-07 | Manter mensagens de erro/sucesso em pt-BR. | P1 | Pending |

## Metricas de Sucesso

- Usuario consegue salvar, aplicar, substituir e limpar slots sem sair da tela
  `/personagem`.
- Slots 1-5 e ownership sao cobertos por testes de API.
- Fluxo atual de salvar personagem continua verde nos testes existentes.

## Duvidas Pendentes

Nenhuma no momento.
