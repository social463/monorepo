# Design — Guarda-roupa LPC completo (todas as definições do gerador)

**Data:** 2026-07-16
**Branch:** `claude/avatar-creation-customization-419891` (continuação do sistema LPC)
**Substitui a curadoria de:** `docs/superpowers/specs/2026-07-15-personagem-lpc-customizavel-design.md`

## Problema

O personagem LPC atual passa por um funil de curadoria manual: o array `CURATED`
em `scripts/vendor-lpc.mjs` seleciona 41 sheet_definitions (693 PNGs, 2.8MB) e o
catálogo em `packages/shared/src/character.ts` replica essa seleção à mão (9 slots
fixos, 285 linhas). O usuário quer **tudo que o Universal LPC Spritesheet Character
Generator oferece** — as 614 sheet_definitions — sem funil de curadoria.

## Decisões de escopo (validadas com o usuário)

1. **Literalmente as 614 definições** — incluindo armas, escudos, feridas, asas,
   caudas, chifres, próteses. Sem filtro temático.
2. **Todos os tipos de corpo**: male, female, muscular, pregnant, teen, child +
   corpos especiais (esqueleto, zumbi) e as 21 peles (7 humanas + fantasia:
   lavanda, verdes, peles de pelo).
3. **Assets commitados no repo** (`apps/web/public/lpc`), como hoje — sem infra
   externa nem download em build. Custo aceito: ~22 mil PNGs / ~100MB no git
   (Azure DevOps) e na imagem Docker.
4. **Licenças: tudo menos GPL-only.** Allowlist ampliado com `OGA-BY 4.0`,
   `CC-BY-SA 4.0` e `OGA-BY 3.0+`. Defs multi-licenciadas contendo GPL entram
   pela licença permissiva. A única def GPL-only fica de fora.
5. **Arquitetura A — catálogo gerado**: o script de vendoring emite o catálogo
   como artefato; o contrato vira genérico por categoria.

## Fatos verificados do upstream (clone de 2026-07-16)

- **614 sheet_definitions**, 12.316 variantes de cor somadas, ~100 `type_name`s
  distintos. `spritesheets/` completo tem 790MB / 24.212 PNGs.
- Formato consistente: cada `layer_N` tem `zPos` + pasta por tipo de corpo;
  a pasta contém `<variante>.png` (espaços viram `_`) em layout universal —
  walk em `y=512`, 4 direções × 9 frames de 64px (região 576×256).
- **144 defs multi-camada** (ex.: `backpack_basket` com `fg/` zPos 130 + `bg/`
  zPos 5) — obrigatório suportar N camadas por item.
- **29 defs têm camadas `custom_animation`** (sheets oversize para animações
  especiais). Dessas, **10 defs só têm camadas custom** (tool_rod, tool_whip,
  weapon_blunt_club, 3 polearms, boomerang, katana, longsword_alt, scimitar) —
  não existem no walk cycle e ficam de fora com motivo no relatório.
- **23 defs reprovam no allowlist atual**: maioria é ruído de dados (créditos
  escritos no campo `licenses`) ou licenças boas fora do allowlist
  (`OGA-BY 4.0` ×8, `CC-BY-SA 4.0` ×8); **1 def é GPL-only**.
- Corpos por camada (contagem de paths): male 752, female 775, muscular 691,
  pregnant 707, teen 651, child 136. Itens declaram compatibilidade por corpo —
  child tem bem menos guarda-roupa.
- Resultado esperado: **~603 defs utilizáveis**, ~22 mil fatias walk únicas
  (dedup por pasta de origem), ~90–110MB.

## Arquitetura

### 1. Pipeline — `scripts/vendor-lpc.mjs` reescrito

- Remove o array `CURATED`; varre **todas** as sheet_definitions do clone
  upstream (argumento do script, como hoje).
- Exclusões automáticas, cada uma registrada em relatório: (a) def GPL-only;
  (b) def cujas camadas são todas `custom_animation` (sem walk); (c) crédito
  sem nenhuma licença do allowlist.
- Camadas `custom_animation` de defs mistas são ignoradas (só as camadas de
  layout universal entram).
- Fatia walk (`extract 576×256 @ y=512`) por **pasta de origem × variante**,
  com dedup: corpos que apontam para a mesma pasta compartilham o mesmo PNG.
  Layout de saída: `lpc/<pasta-origem-upstream>/<variante>.png` (espelha o
  path do upstream — elimina a tradução de nomes da curadoria antiga).
- Licenças: allowlist `CC-BY-SA 3.0/4.0, OGA-BY 3.0/3.0+/4.0, CC-BY 3.0/4.0,
  CC0`. Strings de ruído (nomes de autor no campo `licenses`) são toleradas
  desde que o crédito tenha ≥1 licença válida.
- Saídas: PNGs + `CREDITS.txt` (todos os créditos, obrigatório) +
  **`packages/shared/src/lpc-catalog.json`** + relatório de exclusões
  em `apps/web/public/lpc/EXCLUDED.txt` (commitado; uma linha por def com o
  motivo: gpl-only, sem-walk, licença-inválida, arquivo-ausente).

### 2. Catálogo gerado — `packages/shared/src/lpc-catalog.json`

Uma entrada por def utilizável:

```jsonc
{
  "id": "hair_afro",
  "category": "hair",          // type_name do upstream
  "label": "Afro",             // name do upstream, em inglês
  "layers": [                  // 1..N camadas, em ordem
    { "zPos": 120, "paths": { "male": "hair/afro/male", "female": "hair/afro/male", ... } }
  ],
  "variants": ["blonde", "ash", ...],
  "bodyTypes": ["male", "female", "muscular", "pregnant", "teen"]
}
```

- Labels de **item** ficam em inglês (613 traduções manuais fora de escopo);
  labels de **categoria** ganham mapa pt-BR curado em `character.ts`.
- Tamanho estimado: 300–500KB (gzip ~60KB), importado estaticamente pelo shared
  (funciona em Node e no bundle web; o Vite faz tree-shake/JSON import normal).

### 3. Contrato — `CharacterOptions` v2 (`@legends/shared`)

```ts
interface CharacterOptions {
  bodyType: 'male' | 'female' | 'muscular' | 'pregnant' | 'teen' | 'child'
  items: Record<string, { item: string; variant: string }>
  // items.body é obrigatório (pele = variant; esqueleto/zumbi são itens
  // alternativos da categoria body). Demais categorias opcionais, 1 item cada.
}
```

- `isCharacterOptions`/`sanitizeCharacterOptions` validam contra o catálogo:
  categoria existe, item pertence à categoria, variante existe, corpo compatível.
- `characterSignature`/`characterHash` mantêm o conceito atual (assinatura
  canônica ordenada por categoria).
- **Migração v1→v2**: função pura que converte o shape antigo (bodyType,
  skinTone, hair, beard, torso, legs, feet, glasses, hat) para v2 — os ids
  antigos têm correspondente direto no upstream. Aplicada dentro do `sanitize`
  (borda da API e do web), sem migration de banco (`avatarOptions` é Json).
- **Cabeça**: no v1 ela era derivada automaticamente de corpo+pele; no v2
  `head` é uma categoria normal do catálogo (45 defs — humanas, alien, boarman
  etc.). A migração v1→v2 e o `defaultCharacterFromSeed` preenchem
  `items.head` com a cabeça humana do bodyType na mesma variante de pele do
  corpo; o `sanitize` **não** injeta cabeça (personagem sem cabeça é estado
  válido, como no gerador upstream), mas o editor seleciona a humana por
  padrão ao trocar de corpo/pele enquanto o usuário não escolher outra.
- `defaultCharacterFromSeed` continua sorteando apenas do pool "civil" atual
  (corpo humano + roupa básica) — ninguém spawna de zumbi armado por sorteio.

### 4. Runtime web

- `characterLayers(options)` lê o catálogo e expande cada item em N camadas
  `{path, zPos}` (é isso que faz mochila/cabelo comprido renderizarem atrás do
  corpo). Resolve o path pelo bodyType com fallback à cadeia do upstream.
- `composeCharacterSheet`, cache por assinatura, integração Phaser
  (`OfficeScene.loadCharacterSprite`, `officeAvatar.ts`) e retrato
  (`useCharacterPortrait`, crop de cabeça) ficam conceitualmente idênticos.

### 5. Editor — `AvatarPicker` reconstruído

- Dirigido pelo catálogo: abas por grupo curado de categorias — Corpo,
  Rosto & Cabelo, Roupas, Acessórios, Equipamento, Fantasia (+ "Outros" para
  categoria nova que surgir sem grupo).
- Busca textual por nome de item; grade de thumbnails **virtualizada** nas
  categorias grandes (86 cabelos × 26 cores), thumbnails compostas on-demand
  em canvas com cache (cada camada tem ~4KB).
- Swatches de variante por item; botão "remover" por categoria; presets
  prontos mantidos.

### 6. Backend

- `PATCH /me` e `serialize.ts` passam a usar o `isCharacterOptions`/`sanitize`
  v2; options legadas (v1 e DiceBear) passam pela migração/descartes na borda.
- Nenhuma rota nova, nenhuma migration.

## Tratamento de erros

- Vendoring: arquivo de variante ausente para um corpo → pula aquele corpo e
  registra no relatório (não derruba o script); def sem créditos (placeholder upstream)
  → exclusão registrada como sem-creditos — nada é publicado sem atribuição.
- Runtime: item/variante fora do catálogo → `sanitize` descarta a entrada e
  mantém o resto do personagem; camada que falhar ao carregar no compose →
  comportamento atual (erro sobe, spinner permanece até retry).

## Testes

- **Integridade catálogo⇄disco**: todo path×variante do catálogo existe em
  `apps/web/public/lpc` (substitui o teste path-por-path da curadoria).
- Validação/sanitize v2 (categoria inválida, variante inválida, corpo
  incompatível) e migração v1→v2 (fixtures com options reais do formato atual).
- `characterLayers` multi-camada (zPos atrás do corpo) e assinatura estável.
- Adaptação dos testes existentes de `character.ts`, editor e serialize.

## Riscos assumidos

- **+~100MB no repo** num commit só de assets, separado do commit de código
  (review viável; clone mais pesado para sempre).
- Labels de item em inglês no editor.
- Itens de RPG (armas, feridas) visíveis num produto corporativo — decisão
  explícita do usuário.
- Peso de página no editor: mitigado por virtualização e composição sob demanda.

## Fora de escopo

- Outras animações além do walk (slash, thrust, idle etc.).
- Tradução dos 613 nomes de item.
- As 10 defs sem representação no walk e a 1 def GPL-only.
