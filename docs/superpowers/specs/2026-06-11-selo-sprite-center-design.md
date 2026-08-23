# Imagem de centro do selo via ilustrações 3D (3dicons.co)

**Data:** 2026-06-11
**Branch base:** feat/destaque-do-mes (ou nova branch de feature)

## Problema

Hoje o centro do selo é um **motivo geométrico** (estrela / escudo / círculo) escolhido
automaticamente pelo `kind` em [BadgeEmblem.tsx](../../../apps/web/src/components/BadgeEmblem.tsx).
O campo `iconKey` é armazenado mas **não** é desenhado — só define a cor do medalhão via
`badgeColor(iconKey)`. O admin não consegue escolher a imagem que aparece no centro.

## Objetivo

Permitir que o admin **escolha a ilustração de centro do selo** a partir de uma grade,
chegando perto de designs de gamificação premium (referência: medalhões glossy com uma
**ilustração 3D trabalhada** no centro — foguete, troféu, gema, etc.). Em paralelo, **redesenhar
o frame do medalhão** para um visual mais ousado (gradientes ricos, faíscas, fita, formas por kind).

As ilustrações vêm do **3dicons.co** (ícones 3D renderizados em Blender, estilo clay coeso),
versionadas como assets estáticos no projeto.

## Decisões (confirmadas com o usuário)

| Decisão | Escolha |
|---|---|
| Fonte das ilustrações | **3dicons.co** (3D clay, **CC0**) |
| Hospedagem | **Catálogo maior** de assets versionados em `apps/web/public` |
| Como o admin escolhe | **Grade clicável** de ilustrações (conjunto finito, dezenas+) |
| Identidade salva | **Chave de asset** reaproveitando o campo `iconKey` (sem migração) |
| Motivo geométrico atual | **Substituído** pela ilustração escolhida |
| Cor do medalhão | **Preset por ilustração** (definido no manifesto do asset) |
| Frame do medalhão | **Redesenho ousado** (fita, faíscas, formas por kind) |

## Licença

3dicons.co é **CC0 1.0** (domínio público): uso pessoal/comercial livre, sem atribuição.
Os arquivos são baixados do 3dicons.co (Gumroad/Figma) e versionados no repo.

## Fora de escopo

- Sem gerador procedural (Multiavatar/DiceBear) para o centro.
- Sem upload de imagem própria pelo admin.
- Sem mudanças no sistema de avatar (DiceBear/open-peeps) nem nos ícones de categoria
  (`categoryIcon` em `lib/icons.ts` permanece).

---

## Pré-requisito: aquisição dos assets

Passo manual (não automatizável — download via Gumroad/Figma do 3dicons.co):

1. Baixar o pacote CC0 do 3dicons.co em **um estilo único** (ex.: "clay"/"colored") para
   manter coesão visual.
2. Selecionar as ilustrações relevantes ao tema (engenharia, conquista, recorrência,
   categorias) — dezenas de itens.
3. Colocar os PNGs em `apps/web/public/badge-art/<chave>.png` (nomes em kebab-case:
   `rocket.png`, `trophy.png`, `medal.png`, `gem.png`, `shield.png`, `bulb.png`, ...).

O restante do código é dirigido pelo **manifesto** (abaixo), então funciona com qualquer
quantidade de assets presentes.

---

## Arquitetura

### 1. Dados (sem migração)

- **Reaproveitar `iconKey`** (já existe em `Badge`, `BadgeDTO` e nos schemas da API) como a
  **chave da ilustração** (ex.: `rocket`). Nenhuma coluna nova, nenhuma migration, DTO inalterado.
- **`apps/api/prisma/seed.ts`**: remapear o `iconKey` dos 9 selos existentes para chaves de
  ilustração válidas do manifesto (vários já casam: `trophy`, `medal`, `shield`, `star`→`star`...).

### 2. Catálogo / manifesto — `apps/web/src/lib/badge-art.ts` (novo)

- `BadgeArt = { key: string; label: string; src: string; color: string }`.
- `BADGE_ART: BadgeArt[]` — lista do catálogo: cada item aponta para `/badge-art/<key>.png`,
  um `label` em PT pro picker, e uma `color` (cor de acento do medalhão que combina com a arte).
- `badgeArt(key: string): BadgeArt | undefined` — lookup por chave.
- `DEFAULT_ART_KEY` — fallback para selos cuja `iconKey` não esteja no catálogo.
- Substitui o `BADGE_ICONS`/`BADGE_COLORS` específico de selo em `lib/icons.ts` (a função
  `categoryIcon` permanece intocada).

### 3. Renderização — `BadgeEmblem.tsx` (redesenho)

- A cor do medalhão passa a vir de `badgeArt(badge.iconKey)?.color ?? <fallback por kind>`.
- O centro renderiza `<image href={art.src} ...>` (a ilustração 3D), recortado no domo,
  **substituindo** o `<Motif>`.
- **Redesenho ousado do frame** (objetivos visuais, SVG definido na implementação):
  - Gradientes mais ricos e borda dupla metálica.
  - **Faíscas/sparkles** ao redor do medalhão.
  - **Fita (ribbon)** decorativa opcional na base.
  - **Forma/realce por kind**: IMPACT → explosão de estrela; RECURRENCE → anel com raios;
    CATEGORY → escudo; HIGHLIGHT → coroa/destaque.
- **Fallback**: se `iconKey` não estiver no catálogo, usa `DEFAULT_ART_KEY` (ou o `Motif`
  geométrico antigo) + cor por kind — cobre selos legados antes do remapeamento.

### 4. Picker no formulário — `SpritePicker.tsx` → `BadgeArtPicker.tsx` (novo)

- Props: `value: string` (iconKey), `onChange: (key: string) => void`.
- Renderiza grade de botões a partir de `BADGE_ART`, cada um mostrando a ilustração + label;
  o selecionado recebe destaque (anel/borda).
- Preview do selo final (`BadgeEmblem`) ao lado da grade.
- Sem "sortear" (catálogo finito); pode ter busca/filtro por label se o catálogo crescer.

### 5. Formulário admin — `AdminPage.tsx`

- Remover o `<input>` de texto do `iconKey` (linha ~733) e colocar o `<BadgeArtPicker>` no lugar.
- `emptyBadge.iconKey` inicia em `DEFAULT_ART_KEY`.
- `startBadgeEdit` já preenche `iconKey`; create/edit já enviam `iconKey` (sem mudança no payload).

### 6. API — `admin.ts`

- Nenhuma mudança estrutural: `iconKey` já é aceito no create/update. (Opcional: validar que a
  chave existe no catálogo, mas não é obrigatório.)

---

## Fluxo de dados

```
Admin clica numa ilustração na grade (BadgeArtPicker)
  → badgeForm.iconKey = key
  → POST/PATCH /admin/badges { ..., iconKey }
  → Prisma grava Badge.iconKey (campo já existente)
  → BadgeDTO.iconKey entregue ao front
  → BadgeEmblem: <image src=badgeArt(iconKey).src> no centro + cor do manifesto no medalhão
```

## Tratamento de erros / borda

- `iconKey` fora do catálogo → `DEFAULT_ART_KEY` + cor por kind (selos legados não quebram).
- Asset ausente em `/badge-art/` → o `<image>` falha graciosamente; manter um placeholder/fallback.
- Catálogo vazio (assets ainda não baixados) → picker mostra estado vazio; `BadgeEmblem` cai no
  `Motif` geométrico atual.

## Testes

- **Unit (front):** `badgeArt(key)` retorna item correto e `undefined` p/ chave desconhecida;
  `DEFAULT_ART_KEY` existe no catálogo.
- **Componente:** `BadgeEmblem` renderiza `<image>` quando `iconKey` está no catálogo e cai no
  fallback quando não está; aplica a cor do manifesto.
- **Componente:** `BadgeArtPicker` lista o catálogo, destaca o selecionado e dispara `onChange`.
- **Manual:** criar/editar selo escolhendo ilustração na grade e ver o centro + cor refletirem a
  escolha; conferir o frame redesenhado em vários `kind`.

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `apps/web/public/badge-art/*.png` | **novos** — ilustrações 3D (CC0) baixadas do 3dicons.co |
| `apps/web/src/lib/badge-art.ts` | **novo** — manifesto do catálogo + helpers + cor |
| `apps/web/src/lib/icons.ts` | remover `BADGE_ICONS`/`BADGE_COLORS` de selo (mantém `categoryIcon`) |
| `apps/web/src/components/BadgeArtPicker.tsx` | **novo** — grade clicável de ilustrações |
| `apps/web/src/components/BadgeEmblem.tsx` | ilustração no centro + cor do manifesto + frame redesenhado + fallback |
| `apps/web/src/pages/AdminPage.tsx` | troca input por `BadgeArtPicker`; default `iconKey` |
| `apps/api/prisma/seed.ts` | remapear `iconKey` dos selos para chaves do catálogo |

**Sem mudanças** em `schema.prisma`, migrations, `packages/shared` ou na estrutura das rotas da API.
