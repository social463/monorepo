# Componente Select customizado

**Data:** 2026-06-12
**Status:** Aprovado para implementação

## Objetivo

Substituir os `<select>` nativos do Admin por um componente `Select` reutilizável
que abre uma caixa logo abaixo do campo (não o dropdown nativo do navegador), com
busca, navegação por teclado e acessibilidade. Front-end apenas.

## Contexto atual

Os 4 `<select>` nativos ficam todos em `apps/web/src/pages/admin/BadgesSection.tsx`:
1. **Membro** ("Selecione uma lenda...") no painel "Atribuir selo manualmente".
2. **Selo** ("Selecione um selo…") no mesmo painel.
3. **Tipo de selo** (`BADGE_KINDS`) no formulário do catálogo.
4. **Categoria do selo** (categorias) no formulário do catálogo, quando o tipo é
   CATEGORY.

Os testes em `AdminPage.test.tsx` interagem com os selects de membro/selo via
`getByLabelText(...)` + `fireEvent.change`. Trocar por um componente custom (não
é mais um `<select>`) exige migrar esses testes para abrir o dropdown e clicar na
opção.

Observação de estilo: o editor do usuário reformata arquivos com aspas duplas e
ponto-e-vírgula; o restante do repositório usa aspas simples sem ponto-e-vírgula.
Código novo segue o estilo predominante do repositório (aspas simples), e arquivos
editados seguem o estilo já presente naquele arquivo.

## Decisões (do brainstorming)

1. **Escopo:** componente reutilizável; substitui os 4 selects.
2. **Busca:** sim — campo de filtro no topo da caixa (auto-habilitado para listas
   longas; ver API).
3. **Teclado/fechamento:** completo — setas, Enter, Esc, clicar fora; acessível.

## Componente `Select`

Arquivo novo: `apps/web/src/components/Select.tsx` (componente genérico, ao lado de
`Icon`, `Avatar`, `BadgeEmblem`).

```tsx
export type SelectOption = { value: string; label: string }

interface SelectProps {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  searchable?: boolean   // default: options.length > 6
  disabled?: boolean
  className?: string     // aplicado ao wrapper (largura/margens, ex.: "mb-lg", "sm:flex-1")
}
```

Estrutura:
- Wrapper `div` com `className="relative ${className}"`.
- **Gatilho:** `<button type="button">` ocupando a largura, com o rótulo da opção
  selecionada (ou o `placeholder`) à esquerda e um chevron (`Icon name="expand_more"`)
  à direita que rotaciona quando aberto.
- **Caixa (quando aberta):** `div` posicionado `absolute top-full left-0 right-0 mt-1 z-20`,
  contendo: (se `searchable`) um `<input>` de busca fixo no topo; e uma lista
  rolável (`max-h-64 overflow-y-auto`) de opções.

## Comportamento

- **Abrir/fechar:** clicar no gatilho alterna `open`. Ao abrir, foca o input de
  busca (ou a lista, se sem busca). Fecha ao: selecionar uma opção, `Esc`, clicar
  fora (listener `pointerdown` no `document`, removido no cleanup), ou `Tab`.
- **Busca:** o input filtra `options` por `label`, case-insensitive. Lista vazia
  exibe "Nenhum resultado". O termo de busca limpa ao fechar.
- **Teclado:**
  - Gatilho focado e fechado: `ArrowDown`, `Enter` ou `Space` abrem.
  - Aberto: `ArrowDown`/`ArrowUp` movem o índice destacado (com `scrollIntoView`),
    `Enter` seleciona o destacado, `Esc` fecha e devolve foco ao gatilho, `Tab`
    fecha.
  - Ao abrir, o destaque inicia na opção atualmente selecionada (ou na primeira).
- **Seleção:** clicar numa opção (ou Enter no destaque) chama `onChange(value)` e
  fecha.

## Acessibilidade

- Gatilho: `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded={open}`,
  `aria-label={ariaLabel}`, e `aria-controls` apontando para o id da lista.
- Lista: `role="listbox"` com `id`.
- Opções: `role="option"`, `aria-selected={value === option.value}`, `id` único; a
  opção destacada referenciada por `aria-activedescendant` no gatilho/lista.

## Visual (tema escuro atual)

- **Gatilho:** mesmo visual dos inputs — reaproveita `inputCls` (borda
  `outline-variant/60`, fundo `surface-container-highest`, foco `ring-2 ring-primary/30`),
  com `flex items-center justify-between text-left`. Placeholder em
  `text-on-surface-variant`; valor em `text-on-surface`. Chevron à direita
  (`transition-transform`, `rotate-180` quando aberto).
- **Caixa:** `rounded-md border border-outline-variant/60 bg-surface-container-high
  shadow-lg`. Input de busca com separador inferior (`border-b border-outline-variant/40`).
- **Opções:** `px-3 py-2 text-body-sm cursor-pointer`; destacada/hover
  `bg-primary/10 text-primary`; selecionada exibe um check (`Icon name="check"`) à
  esquerda e `text-on-surface`. "Nenhum resultado" em `text-on-surface-variant`.

## Integração (BadgesSection)

Substituir os 4 `<select>` por `<Select>`, mantendo `value`/`onChange` e os
handlers atuais:
- Membro: `ariaLabel="Selecionar membro"`, `placeholder="Selecione uma lenda..."`,
  `options = members.map(m => ({ value: m.id, label: m.name }))`,
  `className="mb-lg"`. (auto-searchable: lista longa)
- Selo: `ariaLabel="Selecionar selo"`, `placeholder="Selecione um selo…"`,
  `options = badges.map(b => ({ value: b.id, label: b.name }))`,
  `className="sm:flex-1"`.
- Tipo de selo: `ariaLabel="Tipo de selo"`,
  `options = BADGE_KINDS.map(k => ({ value: k.value, label: k.label }))`.
- Categoria: `ariaLabel="Categoria do selo"`,
  `options = categories.map(c => ({ value: c.slug, label: c.name }))`, com uma
  opção/placeholder para "sem categoria" conforme o comportamento atual do form.

Preservar o layout (o select de selo fica `sm:flex-1` ao lado do botão "Conceder";
o de membro tem `mb-lg`). O `onChange` recebe a string `value` (em vez de
`event.target.value`).

## Testes

- **`Select.test.tsx`** (novo, TDD): renderiza o gatilho com placeholder/aria-label;
  clicar abre a caixa (`aria-expanded`); lista as opções (`role="option"`); clicar
  numa opção chama `onChange` com o value e fecha; digitar na busca filtra; "Nenhum
  resultado" quando nada casa; `Esc` fecha; clicar fora fecha; `ArrowDown`+`Enter`
  seleciona; opção selecionada tem `aria-selected`.
- **Migrar `AdminPage.test.tsx`:** os testes que selecionavam membro/selo via
  `fireEvent.change` passam a abrir o dropdown (clicar no gatilho via
  `getByLabelText('Selecionar membro')`) e clicar na opção (ex.: `Diego Reis`).
  Asserções de POST/DELETE preservadas. (Os selects de tipo/categoria não têm
  testes hoje.)
- Suíte web inteira verde.

## Fora de escopo (YAGNI)

- Multi-seleção; agrupamento de opções; criação de opções novas (creatable);
  seleção assíncrona/remota.
- Posicionamento inteligente (flip para cima quando perto do rodapé) — a caixa
  sempre abre abaixo; `max-h` + scroll cobrem listas longas.
- Reutilização fora do Admin nesta etapa (o componente é genérico, mas só os 4
  selects do Admin são trocados agora).
