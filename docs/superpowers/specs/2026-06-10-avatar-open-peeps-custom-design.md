# Avatar personalizado (open-peeps por componente) — Design

**Data:** 2026-06-10
**Status:** Aprovado (aguardando revisão do spec)
**Contexto:** Estende a feature de seleção de avatar (estilos DiceBear por seed) com um modo de personalização componente a componente usando o estilo `open-peeps`.

## Objetivo

Permitir que o usuário monte um avatar personalizado escolhendo individualmente cada componente do estilo open-peeps (cabelo, expressão, barba, acessório, máscara e cores), com preview ao vivo, mantendo o picker atual de "sortear sprite" para os 7 estilos existentes.

## Decisões tomadas no brainstorming

1. **Escopo:** o modo personalizado é **adicional** — convive com a galeria de seed atual (personas, bottts, thumbs, croodles, lorelei, micah, toon-head). Não substitui nada.
2. **Componentes expostos:** todos — `head`, `face`, `facialHair`, `accessories`, `mask`, `skinColor`, `clothingColor`, `headContrastColor`.
3. **Armazenamento:** nova coluna `avatarOptions Json?` (jsonb nullable) na tabela `User`.
4. **Licença:** open-peeps é **CC0 1.0** (sem atribuição). A pendência de atribuição dos estilos CC BY 4.0 da galeria (personas, croodles, micah, toon-head) é um item separado, fora do escopo deste spec.

## Arquitetura

### 1. Modelo de dados

Migration adiciona `avatarOptions Json?` em `User`.

- Estilos de seed (os 7 atuais): `avatarOptions = null`.
- Modo personalizado: `avatarStyle = 'open-peeps'`, `avatarSeed` mantém uma base (string), `avatarOptions` guarda as escolhas. Exemplo:
  ```json
  {
    "head": "afro",
    "face": "smile",
    "facialHair": null,
    "accessories": "glasses",
    "mask": null,
    "skinColor": "edb98a",
    "clothingColor": "8fa7df",
    "headContrastColor": "2c1b18"
  }
  ```
- Em componentes opcionais (`facialHair`, `accessories`, `mask`), `null` significa "nenhum".

### 2. Tipos compartilhados — `packages/shared/src/avatar.ts`

- `AVATAR_STYLE_KEYS` (galeria de seed) permanece com os 7 estilos.
- Acrescentar:
  - `OPEN_PEEPS_STYLE = 'open-peeps'` (constante).
  - `ALL_AVATAR_STYLE_KEYS = [...AVATAR_STYLE_KEYS, OPEN_PEEPS_STYLE]` — usado para validar o campo `avatarStyle` (o backend aceita os 7 + open-peeps).
  - `AvatarStyleKey` passa a ser a união de `ALL_AVATAR_STYLE_KEYS`.
- `OPEN_PEEPS_OPTIONS` — fonte única de verdade, consumida pela UI (picker) e pela validação do backend. Estrutura:
  - Componentes de variante (cada um com lista de variantes permitidas e flag `allowsNone`):
    - `head` — 48 variantes, `allowsNone: false`
    - `face` — 30 variantes, `allowsNone: false`
    - `facialHair` — 16 variantes, `allowsNone: true`
    - `accessories` — 8 variantes, `allowsNone: true`
    - `mask` — 2 variantes (`medicalMask`, `respirator`), `allowsNone: true`
  - Componentes de cor (cada um com paleta de hex **sem** `#`):
    - `skinColor`: `["ffdbb4","edb98a","d08b5b","ae5d29","694d3d"]`
    - `clothingColor`: `["e78276","ffcf77","fdea6b","78e185","9ddadb","8fa7df","e279c7"]`
    - `headContrastColor`: `["2c1b18","e8e1e1","ecdcbf","d6b370","f59797","b58143","a55728","724133","4a312c","c93305"]`
  - As listas de variantes (`head`, `face`, etc.) devem ser extraídas do schema do open-peeps instalado (`openPeeps.schema.properties.<comp>.items.enum` em `@dicebear/collection@9.4.2`) e fixadas como constantes literais em shared, para que o backend (que importa shared) possa validar. As listas completas conhecidas na v9.4.2:
    - **head (48):** afro, bangs, bangs2, bantuKnots, bear, bun, bun2, buns, cornrows, cornrows2, dreads1, dreads2, flatTop, flatTopLong, grayBun, grayMedium, grayShort, hatBeanie, hatHip, hijab, long, longAfro, longBangs, longCurly, medium1, medium2, medium3, mediumBangs, mediumBangs2, mediumBangs3, mediumStraight, mohawk, mohawk2, noHair1, noHair2, noHair3, pomp, shaved1, shaved2, shaved3, short1, short2, short3, short4, short5, turban, twists, twists2
    - **face (30):** angryWithFang, awe, blank, calm, cheeky, concerned, concernedFear, contempt, cute, cyclops, driven, eatingHappy, explaining, eyesClosed, fear, hectic, lovingGrin1, lovingGrin2, monster, old, rage, serious, smile, smileBig, smileLOL, smileTeethGap, solemn, suspicious, tired, veryAngry
    - **facialHair (16):** chin, full, full2, full3, full4, goatee1, goatee2, moustache1, moustache2, moustache3, moustache4, moustache5, moustache6, moustache7, moustache8, moustache9
    - **accessories (8):** eyepatch, glasses, glasses2, glasses3, glasses4, glasses5, sunglasses, sunglasses2
    - **mask (2):** medicalMask, respirator
- Tipo `AvatarOptions`:
  ```ts
  interface AvatarOptions {
    head: string
    face: string
    facialHair: string | null
    accessories: string | null
    mask: string | null
    skinColor: string
    clothingColor: string
    headContrastColor: string
  }
  ```
- `UpdateProfileRequest` passa a incluir `avatarOptions?: AvatarOptions | null`.

### 3. Renderização — `apps/web/src/lib/avatar.ts`

- `avatarDataUri(style, seed)` continua para os 7 estilos de seed (inalterado).
- Nova `customAvatarDataUri(seed: string, options: AvatarOptions): string`:
  - Converte cada valor único para o formato DiceBear (array de 1 elemento): `head: [options.head]`, etc.
  - Para componentes opcionais: se o valor é uma variante, `<comp>: [valor]` + `<comp>Probability: 100`; se `null`, `<comp>Probability: 0` (e omite o array).
  - Cores passam como array de 1 elemento: `skinColor: [options.skinColor]`, etc.
  - Chama `createAvatar(openPeeps, { seed, size: 128, ...built }).toDataUri()`.
  - `openPeeps` é importado de `@dicebear/collection` e adicionado ao mapa de estilos com o mesmo cast usado pelos demais (`Style<Record<string, unknown>>`).

### 4. Componente `Avatar` — `apps/web/src/components/Avatar.tsx`

- `AvatarSource` ganha `avatarOptions?: AvatarOptions | null`.
- Lógica de resolução: se `avatarStyle === 'open-peeps'` **e** `avatarOptions` presente → `customAvatarDataUri(avatarSeed ?? '', avatarOptions)`. Senão, mantém a ordem atual: DiceBear seed (`avatarStyle` + `avatarSeed`) → `photoUrl` → iniciais.
- Continua renderizando só conteúdo interno (img/span), preservando os wrappers dos call sites. `imgClassName`/`initialsClassName` inalterados.

### 5. API — `PATCH /auth/me` (`apps/api/src/routes/auth.ts`)

- Schema Zod passa a aceitar:
  - `avatarStyle`: enum sobre `ALL_AVATAR_STYLE_KEYS` (nullable/optional).
  - `avatarSeed`: string 1–64 (nullable/optional) — inalterado.
  - `avatarOptions`: objeto validado componente a componente contra `OPEN_PEEPS_OPTIONS` (nullable/optional):
    - `head`/`face`: enum das variantes (obrigatório quando o objeto está presente).
    - `facialHair`/`accessories`/`mask`: enum das variantes **ou** `null`.
    - `skinColor`/`clothingColor`/`headContrastColor`: enum da paleta respectiva.
    - Qualquer chave/valor fora do allowlist → `400 { message: 'Dados inválidos' }`.
- Regra de coerência: se `avatarStyle` for fornecido e **não** for `'open-peeps'`, persistir `avatarOptions = null` (limpa a configuração antiga). Se `avatarStyle === 'open-peeps'`, `avatarOptions` deve estar presente (validação rejeita open-peeps sem options).
- Continua usando exclusivamente `request.user.sub` (sem IDOR).
- `toPublicUser` (`apps/api/src/lib/serialize.ts`) passa a expor `avatarOptions` (cast do campo Json do Prisma para `AvatarOptions | null`). `PublicUser` ganha `avatarOptions: AvatarOptions | null`.

### 6. UI — `AvatarPicker` (`apps/web/src/components/AvatarPicker.tsx`)

- Toggle no topo do modal: **"Sortear"** (galeria atual dos 7 estilos, comportamento inalterado) | **"Personalizar"** (editor open-peeps).
- Estado inicial do modo: se o usuário já tem `avatarStyle === 'open-peeps'`, abre em "Personalizar" com as options atuais; senão abre em "Sortear".
- Editor "Personalizar":
  - Preview grande ao vivo (usa `customAvatarDataUri` com o estado atual).
  - Controles por componente de variante (head, face, facialHair, accessories, mask): seletor com setas ‹ › que cicla pela lista (incluindo a opção "Nenhum" no início para os opcionais). Mostra o nome/label da variante atual.
  - Controles de cor (skinColor, clothingColor, headContrastColor): fileira de swatches clicáveis; o swatch selecionado fica destacado.
  - Botão **"Aleatório"**: sorteia uma variante de cada componente (respeitando "Nenhum" como possibilidade nos opcionais) e uma cor de cada paleta.
- Estado inicial dos componentes (quando entra em "Personalizar" sem options prévias): primeira variante de head/face, `null` nos opcionais, primeira cor de cada paleta — ou um sorteio inicial via "Aleatório". (Decisão de implementação: usar um conjunto default determinístico, com o botão Aleatório disponível.)
- Salvar: `apiFetch('/auth/me', { method: 'PATCH', body: { avatarStyle: 'open-peeps', avatarSeed, avatarOptions } })` → `setUser(res.user)` → `queryClient.invalidateQueries(['profile'])` → `onClose()`. (Mesmo fluxo do modo Sortear, trocando o corpo.)
- O `avatarSeed` no modo personalizado: manter o seed atual do usuário se houver, senão gerar via `randomSeed()` (afeta apenas aspectos não controlados pelos componentes forçados).

### 7. Testes

- **shared:** `OPEN_PEEPS_OPTIONS` tem variantes não-vazias para cada componente e paletas não-vazias; `ALL_AVATAR_STYLE_KEYS` inclui os 7 + 'open-peeps'.
- **web lib (`avatar.test.ts`):** `customAvatarDataUri` retorna `data:image/svg+xml...`; com opcionais em `null` ainda gera avatar válido; é determinístico para o mesmo seed+options.
- **Avatar (`Avatar.test.tsx`):** renderiza imagem open-peeps (data URI) quando `avatarStyle='open-peeps'` + `avatarOptions`; cai para o caminho de seed quando style é um dos 7.
- **AvatarPicker (`AvatarPicker.test.tsx`):** o toggle "Personalizar" exibe o editor; ajustar um componente e salvar envia `avatarStyle: 'open-peeps'` e um `avatarOptions` com as chaves esperadas no corpo do PATCH; `setUser` e `onClose` são chamados.
- **API (`auth.test.ts`):** PATCH com `avatarStyle='open-peeps'` + `avatarOptions` válido persiste e o GET `/auth/me` reflete; variante inválida → 400; ao enviar `avatarStyle` de um estilo de seed, `avatarOptions` é zerado (null) no retorno.

## Não-objetivos (YAGNI)

- Não há upload de imagem nem editor pixel a pixel.
- Não se expõem `*Probability` ao usuário além do "nenhum/escolhido" (0/100).
- Não se adiciona atribuição dos estilos CC BY 4.0 aqui (item separado).
- Sem cache/persistência de SVG renderizado — a renderização é client-side e barata.

## Arquivos afetados (resumo)

- `apps/api/prisma/schema.prisma` + nova migration (coluna `avatarOptions`).
- `packages/shared/src/avatar.ts` (constantes/tipos), `packages/shared/src/auth.ts` (`PublicUser`).
- `apps/api/src/lib/serialize.ts`, `apps/api/src/routes/auth.ts` (+ `auth.test.ts`).
- `apps/web/src/lib/avatar.ts` (+ `avatar.test.ts`), `apps/web/src/components/Avatar.tsx` (+ `Avatar.test.tsx`), `apps/web/src/components/AvatarPicker.tsx` (+ `AvatarPicker.test.tsx`).
