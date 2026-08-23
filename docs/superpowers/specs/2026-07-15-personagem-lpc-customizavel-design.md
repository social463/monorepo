# Personagem LPC customizável — design

**Data:** 2026-07-15
**Status:** aprovado (brainstorming com o usuário)

## Contexto

Hoje a identidade visual do usuário é dividida em dois sistemas:

1. **Avatar de perfil**: busto DiceBear *open-peeps*, com editor por componente
   (`AvatarPicker`), persistido em `User.avatarStyle/avatarSeed/avatarOptions`.
2. **Personagem do escritório**: sprite pixel-art gerado por IA (OpenAI
   `gpt-image-1.5`, `images/edits`) a partir do busto — pipeline assíncrono com
   pós-processamento (chroma-key, grade 2×2 → sheet 4×1), cache em disco
   (`storage/office-sprites`), broadcast WS `sprite-updated`, fallback pro busto
   após 60s e custo por geração.

## Objetivo

Um **único personagem customizável, gratuito e determinístico** que serve de
identidade em todo o app (perfil, votos, listas) e anda no escritório com
**walk cycle real** — substituindo o open-peeps e eliminando por completo a
geração via OpenAI.

## Decisões (aprovadas em brainstorming)

| Decisão | Escolha |
| --- | --- |
| Escopo | Personagem único substitui perfil **e** escritório |
| Base de assets | LPC — Universal Spritesheet Character Generator (CC-BY-SA/OGA-BY) |
| Animação | Walk cycle completo (frames prontos do LPC) |
| Arquitetura | **Opção A** — montagem 100% no cliente, sem estado no servidor |

## Arquitetura

Padrão idêntico ao que o repo já usa com DiceBear: tudo renderiza on-the-fly a
partir de `avatarOptions`; nenhum PNG é persistido no servidor.

```
CharacterOptions (User.avatarOptions, validado por zod a partir do catálogo)
        │
        ├─ web: composeCharacterSheet(options) → canvas (sheet 9×4 de 64px)
        │        ├─ characterPortraitDataUri → recorte da cabeça (perfil/votos)
        │        └─ OfficeScene → textures.addSpriteSheet + anims por direção
        │
        └─ api: apenas valida e persiste; occupant do WS carrega avatarOptions
```

### 1. Assets LPC + catálogo

- **Curadoria única commitada no repo**, a partir do
  [Universal LPC Spritesheet Character Generator](https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator),
  restrita a assets com licença permissiva com atribuição — **CC-BY-SA 3.0,
  OGA-BY 3.0, CC-BY 3.0/4.0 ou CC0** (excluir GPL-only na curadoria; o script
  de vendoring valida o allowlist e falha alto fora dele). Decisão registrada:
  CC0/CC-BY entram porque são MENOS restritivas que CC-BY-SA e removê-las
  cortaria estilos de cabelo importantes (afro, dreads, twists) do catálogo.
- **Pré-fatiamento no vendoring**: de cada sheet universal aproveitamos só as
  linhas de walk — 4 direções (up, left, down, right) × 9 frames de 64px, onde o
  frame 0 de cada direção é a pose parada. Cada camada vira um PNG ~576×256 em
  `apps/web/public/lpc/<categoria>/<item>/<cor>.png`.
- **Categorias v1**: corpo (tipos de corpo + ~8 tons de pele), cabelo
  (~12 estilos × cores), barba, torso/camisa (~10 itens), calça/saia (~8),
  sapatos (~5), chapéu, óculos. Cor no LPC é variante pré-pintada (cor =
  arquivo), não tint em runtime. Chapéu, óculos e barba são opcionais
  ("nenhum").
- **Catálogo em `packages/shared/src/character.ts`**: ids válidos por
  categoria, cores por item, z-order das camadas e o tipo `CharacterOptions`.
  Fonte única para a UI do editor e para a validação zod na API. Paths dos PNGs
  seguem convenção derivada dos ids.
- **Créditos/atribuição**: arquivo `CREDITS` gerado dos metadados do gerador
  (autor + licença por asset curado) e página/modal "Créditos" acessível no
  app. Satisfaz a atribuição exigida pelo CC-BY-SA/OGA-BY.

### 2. Modelo de dados (sem migration de schema)

- Reusa os campos existentes de `User`: `avatarStyle = 'lpc'`,
  `avatarOptions = CharacterOptions`, `avatarSeed` permanece só como semente de
  aleatoriedade.
- **Migração implícita, sem script**: `defaultCharacterFromSeed(seed ?? userId)`
  no shared — função determinística que gera um `CharacterOptions` válido.
  Usuários com `avatarStyle === 'open-peeps'` (ou nulo) são renderizados com o
  personagem padrão derivado da seed; a primeira edição no editor grava options
  reais. Nenhum dado é apagado.
- Todo o vocabulário open-peeps sai do código: `OPEN_PEEPS_*`,
  `openPeepsProps`, `AvatarOptions` antigo, deps `@dicebear/*` (web e api).

### 3. Renderização (100% cliente)

- `apps/web/src/lib/character.ts`:
  - `composeCharacterSheet(options)` — carrega as camadas em z-order, desenha
    num canvas (sheet 9 colunas × 4 linhas de células 64px), cache em memória
    por hash das options.
  - `characterPortraitDataUri(options)` — recorta a região da cabeça do frame
    frontal parado e escala com nearest-neighbor (retrato pixel-art).
- `Avatar.tsx` — nova cadeia de resolução: personagem LPC → `photoUrl` →
  iniciais.
- `OfficeScene`:
  - Compõe o sheet localmente a partir do `avatarOptions` do occupant (que já
    trafega no payload do WS) — o conceito de `spriteUrl` deixa de existir.
  - `textures.addSpriteSheet` (36 frames) + animações Phaser por direção:
    frames 1–8 = walk cycle, frame 0 = parado.
  - Sem spinner de 60s e sem fallback de busto — composição é local e rápida.
  - Altura de exibição ~44px, mantendo a escala atual em relação ao tile de 32.
- **Troca de avatar ao vivo**: `PATCH /auth/me` avisa o `officeHub`, que faz
  broadcast de `avatar-updated` (substitui `sprite-updated`) com as novas
  options; clientes recompõem a textura.

### 4. Editor de personagem (substitui o conteúdo do `AvatarPicker`)

Mesmo modal aberto do perfil, dois modos preservados:

- **"Prontos"**: grid de 12 personagens aleatórios
  (`defaultCharacterFromSeed` com seeds aleatórias) — um clique escolhe tudo.
- **"Personalizar"**: abas por categoria (Corpo, Cabelo, Barba, Camisa, Calça,
  Sapatos, Chapéu, Óculos), navegação de itens por setas de ciclo + swatches de
  cor, seguindo o padrão visual do editor atual. Categorias opcionais têm
  "nenhum".
- **Preview ao vivo animado**: personagem de corpo inteiro tocando o walk
  cycle, com botão para girar a direção.
- Salvar → `PATCH /auth/me` com `{ avatarStyle: 'lpc', avatarSeed,
  avatarOptions }` — rota existente, muda só o schema zod (valida contra o
  catálogo do shared).

### 5. Remoção do pipeline OpenAI

Deletar por completo, com seus testes:

- `apps/api/src/services/office-sprite-service.ts`,
  `apps/api/src/lib/sprite-sheet.ts`, `apps/api/src/lib/office-avatar-png.ts`
- `apps/api/assets/office-sprite-style/` (4 PNGs de referência), storage
  `storage/office-sprites/` e o static `/office-sprites/` em `app.ts`
- Env vars `OPENAI_API_KEY_AVATAR`, `OPENAI_MODEL_AVATAR`,
  `OPENAI_IMAGE_QUALITY` (`.env.example` e `config.ts`)
- Trigger de geração no `PATCH /auth/me`, backfill no `office-ws.ts`,
  `spriteUrl` no `OfficeOccupant`, mensagem WS `sprite-updated`
- No front: cadeia spinner/fallback da `OfficeScene` (`loadPixelSprite`,
  `SPRITE_LOADING_FALLBACK_MS` etc.) e `officeAvatar.ts` no que for busto
- Referência a `/office-sprites/` no nginx/deploy, se existir

### 6. Testes

- **shared**: catálogo consistente (todo item referencia cores/paths válidos),
  `defaultCharacterFromSeed` determinística e sempre válida contra o zod,
  z-order estável.
- **api**: `PATCH /auth/me` aceita options válidas e rejeita item/cor fora do
  catálogo (400). Testes do sprite-service removidos junto com o código.
- **web**: composição testada isolando o desenho do canvas (ordem de camadas,
  resolução de paths, cache por hash); editor com Testing Library (trocar item,
  cor, payload de save correto); `Avatar.tsx` com a nova cadeia de resolução.
- **Manual**: escritório com 2 sessões — walk cycle, `avatar-updated` ao vivo,
  usuário legado (sem options novas) aparecendo com personagem padrão.

## Pontos de atenção

- **MoodOfDay (humor do dia)**: hoje usa 5 feições do open-peeps aplicadas ao
  avatar da pessoa. LPC não tem expressões faciais — o seletor passa a usar
  **emojis** (😞 🙁 😐 🙂 😄), preservando a feature e removendo a dependência
  do DiceBear. (Decisão registrada no plano.)

- **Licença**: CC-BY-SA exige atribuição e share-alike sobre os assets — a
  curadoria deve registrar autor/licença por item e a página de créditos é
  requisito de release, não opcional.
- **Layout do sheet LPC**: as posições exatas das linhas de walk no sheet
  universal devem ser verificadas contra os assets reais no momento do
  vendoring (o pré-fatiamento congela isso; o runtime só conhece o formato
  9×4).
- **jsdom não desenha canvas**: os testes web devem separar a lógica pura
  (manifest, z-order, paths, hash) do `drawImage` em si.
- **Peso dos assets**: só as camadas usadas são baixadas (PNGs pequenos e
  cacheáveis); o vendoring deve manter a curadoria enxuta (~centenas de KB no
  total, não MB).

## Fora de escopo

- Outras animações LPC (slash, thrust, spellcast, hurt).
- Tint de cor em runtime (cores são variantes pré-pintadas).
- Persistência de PNG no servidor ou qualquer render server-side.
- Remoção do `GEMINI_API_KEY`/`GEMINI_MODEL` (são do Destaque do Mês, texto —
  não fazem parte do pipeline de avatar).
