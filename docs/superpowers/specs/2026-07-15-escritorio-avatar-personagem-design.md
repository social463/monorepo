# Escritório — Avatar open-peeps como personagem

**Data:** 2026-07-15
**Status:** spec aprovado — plano em `docs/superpowers/plans/2026-07-15-02-escritorio-avatar-personagem.md`
**Depende de:** escritório virtual (Phaser + WS, já na base) e avatar open-peeps
custom (`avatarSeed`/`avatarOptions` no `User`).

## Problema

O personagem do escritório hoje é um placeholder geométrico (retângulo + círculo
gerados em runtime) que só "combina" com o avatar da pessoa pelas duas cores
(`skinColor`/`clothingColor`, via `officeColors`). O avatar open-peeps que a
pessoa montou no perfil só aparece ao clicar no personagem (card). Queremos que
o próprio avatar seja o personagem: o **busto completo** do open-peeps andando
pelo mapa.

## Decisões aprovadas

- **Visual (v1.1):** busto do open-peeps **+ corpo desenhado embaixo** —
  perninhas procedurais na cor da roupa (escurecida) sob o busto, fechando a
  silhueta de um personagem completo. *(Feedback pós-v1: o busto flutuando
  sozinho não leu como personagem; o DiceBear só oferece o open-peeps como
  busto, então o corpo é desenhado pela cena.)*
- **Tamanho:** ~44px de altura total (busto ~34px + pernas ~10px), ancorado
  nos "pés", transbordando o tile de 32px para cima (padrão top-down).
- **Abordagem:** o cliente gera e rasteriza (opção A abaixo).
- **Andar:** bob do busto mantido + perninhas alternam uma elevação sutil por
  passo.

## Escopo do v1

**Dentro:** `OfficeOccupant` carrega os dados do avatar; a cena Phaser rasteriza
o SVG open-peeps em textura e substitui o placeholder; flip horizontal por
direção; bob de caminhada mantido; fallback determinístico para quem nunca
customizou.

**Fora (deliberadamente):** atualização ao vivo quando a pessoa troca o avatar
no perfil (só ao reentrar no escritório); spritesheet com frames de caminhada;
variação de desenho para cima/baixo (busto é frontal); qualquer mudança no
`AvatarPicker` ou no card.

## Abordagens consideradas

- **A. Cliente gera e rasteriza (escolhida).** O servidor inclui
  `avatarSeed`/`avatarOptions` no occupant; o web reusa o gerador que já existe
  (`apps/web/src/lib/avatar.ts`) e carrega o SVG como textura no Phaser. Zero
  endpoint novo, zero estado novo, geração já é client-side hoje.
- **B. Servidor renderiza PNG** (resvg já existe para o card do Destaque).
  Descartada: endpoint + storage/invalidação novos para um problema que o
  cliente já resolve.
- **C. Overlay DOM sobre o canvas.** Descartada: sincronia de posição vira
  jitter e quebra o encapsulamento da cena.

## Arquitetura

### Contrato (`packages/shared/src/office.ts`)

`OfficeOccupant` ganha dois campos (mantendo `skinColor`/`clothingColor` para o
fallback/placeholder):

```ts
export interface OfficeOccupant {
  // ... campos atuais ...
  avatarSeed: string | null;
  avatarOptions: AvatarOptions | null;
}
```

### Backend (`apps/api`)

- `office-ws.ts`: o `select` do usuário passa a incluir `avatarSeed`.
- `office-hub.ts`: `OfficeUser` ganha `avatarSeed: string | null`; o `join`
  copia `avatarSeed`/`avatarOptions` para o occupant. Nada mais muda — o hub
  continua sem tocar o Postgres depois do join.

### Web — resolução do avatar (helper puro)

Novo helper em `apps/web/src/office/` (ex. `officeAvatar.ts`), testável sem
Phaser, com a mesma ordem de resolução do componente `Avatar`:

1. `avatarOptions` presentes → `customAvatarDataUri(seed, options)`;
2. só `avatarSeed` → `avatarDataUri('open-peeps', seed)`;
3. nada → open-peeps determinístico com `userId` como seed (todo mundo vira
   busto; ninguém fica no boneco geométrico permanentemente).

Retorna `{ textureKey, dataUri }`, com `textureKey = 'avatar-' + userId + '-' +
officeHash(dataUri)` — o hash no key garante que trocar o avatar e reentrar na
mesma sessão do browser não reaproveite a textura velha.

### Web — cena (`OfficeScene.ts`)

- Occupants entram depois do `preload()`, então a textura é carregada em
  runtime: `new Image()` a partir do data URI → `onload` →
  `textures.addImage(key, img)`. Rasteriza a **2x** (~80px de altura) e aplica
  filtro **LINEAR nessa textura** (o `pixelArt: true` global usa NEAREST, que
  serrilharia o busto reduzido).
- `spawn()`: cria o container como hoje (label com nome, hit area de clique,
  balão de fala — tudo preservado) com o placeholder geométrico atual; quando a
  textura fica pronta, troca body+head pelo **conjunto busto + perninhas**: o
  sprite do busto (origin no pé dos ombros, ~34px) sobre duas perninhas
  procedurais (textura branca `char-leg` tintada com o `clothingColor` do
  occupant escurecido, pés na borda de baixo do tile). Se o occupant sai antes
  do `onload`, descarta.
- Se a mesma textura já existe (`textures.exists`), usa direto (re-join na
  mesma sessão).
- **Direção:** `face()` vira flip horizontal (`setFlipX`) para esquerda/direita;
  cima/baixo não muda o desenho. O deslocamento de cabeça atual morre junto com
  o placeholder pós-troca.
- **Animação de andar:** tween de posição (150ms/tile) e bob vertical mantidos,
  aplicados ao sprite.
- **Erro no raster** (`img.onerror`): mantém o placeholder geométrico tintado —
  é exatamente o comportamento atual, ninguém fica invisível.
- `destroy` do personagem remove referências; texturas `avatar-*` podem ficar no
  TextureManager pela sessão (dezenas de imagens ~80px — custo irrelevante).

## Fluxos

1. **Entrar no escritório** → `welcome` traz occupants com avatar → para cada
   um, resolve data URI → raster → sprite substitui o placeholder (um "pop"
   sutil de troca é aceitável).
2. **Alguém entra** → `joined` → mesmo caminho para um occupant.
3. **Andar** → tween + bob no sprite; virar para esquerda/direita → flip.
4. **Trocar avatar no perfil** → nada muda no mapa até reentrar (limitação
   aceita do v1).

## Erros e bordas

- **SVG falha ao rasterizar** → placeholder geométrico permanece (fallback
  natural).
- **Occupant sai durante o carregamento da textura** → callback checa se o
  personagem ainda existe antes de trocar.
- **Duas abas** → hub já de-duplica; o cliente carrega a textura por
  `textureKey`, sem duplicação.
- **`avatarOptions` malformado no banco** → o gerador do DiceBear pode lançar;
  o helper embrulha em try/catch e cai para o caso "só seed"/"userId".

## Testes

- **`office-hub.test.ts`**: `welcome`/`joined` incluem `avatarSeed`/
  `avatarOptions` do usuário; `null` quando ausentes.
- **`officeAvatar.test.ts`** (web, sem Phaser): ordem de resolução
  options → seed → userId; try/catch de options malformado; `textureKey`
  estável para o mesmo avatar e diferente quando o avatar muda.
- **Cena**: a lógica de raster/troca fica encapsulada para depender só do
  helper; o comportamento visual é verificado manualmente (`pnpm dev`), como o
  restante da cena Phaser (que não tem teste de render hoje).

## Riscos

- **Legibilidade a 40px**: detalhes finos (óculos, barba) podem ficar pequenos;
  mitigado pelo raster 2x + filtro linear. Se ficar ruim na prática, o ajuste é
  um número (altura alvo).
- **Estilo**: o busto vetorial destoa do mapa pixel-art — trade-off aceito na
  decisão de design (fidelidade ao avatar > coesão pixel-art).
