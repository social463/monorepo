# Escritório — Sprite pixel-art chibi gerado por IA

**Data:** 2026-07-15
**Status:** implementado na branch `feat/escritorio-avatar-personagem` (review final:
ready to merge). Pendência: geração validada (provedor: OpenAI gpt-image-1 via `OPENAI_API_KEY_AVATAR`) (o pipeline
foi verificado ponta a ponta com sprite sintético; só a chamada Gemini não rodou).
**Depende de:** avatar como personagem v1.1 (branch
`feat/escritorio-avatar-personagem`) — reusa a cadeia occupant → textura →
swap e o fallback busto+perninhas.

## Problema

O personagem atual (busto open-peeps + perninhas procedurais) não tem a
identidade visual que o time quer: um sprite **pixel-art chibi estilo RPG**
(cabeça grande, ~60% da altura, sombreamento suave), com **4 direções**
(frente, costas, esquerda, direita) — referências visuais fornecidas pelo
usuário. O DiceBear não produz esse estilo; o sprite será **gerado por IA a
partir do avatar** de cada pessoa.

## Decisões aprovadas

- **Fonte:** geração por IA (OpenAI `gpt-image-1`, endpoint images/edits, fundo transparente nativo) usando o avatar DiceBear da
  pessoa como referência de identidade (cabelo, pele, roupa, acessórios).
- **Momento:** ao salvar o avatar no perfil (`PATCH /auth/me`) + sob demanda
  no join do escritório para quem ainda não tem (backfill best-effort).
- **Animação:** 1 frame estático por direção + bob vertical no passo (frames
  de caminhada ficam FORA — consistência entre frames gerados por IA é o maior
  risco; não assumir).
- **Fallback em cadeia:** sprite IA → busto+perninhas (v1.1) → placeholder
  geométrico. Os dois últimos já existem e não mudam.

## Abordagens consideradas

- **A. Pipeline server-side + cache em disco (escolhida).** Uma geração por
  usuário/avatar, imagem única com grade 2×2 (as 4 direções numa geração só =
  personagem consistente), pós-processamento em JS puro, spritesheet salvo em
  disco e servido estático (mesmo padrão de `storage/highlights`).
- **B. Geração no cliente.** Descartada: a chave da API de imagem é secreta.
- **C. Pack de sprites + palette swap (sem IA).** Visual garantido; fica como
  **plano B de qualidade** — se a IA não entregar, o pipeline de
  cache/serving/cena se reaproveita com um pack.

## Arquitetura

### Serviço de geração (`apps/api/src/services/office-sprite-service.ts`)

- **Cache por arquivo, sem migration:**
  `storage/office-sprites/<userId>-<hash>.png`, onde
  `hash = officeHash(JSON.stringify({ seed, options }))` sobre os mesmos
  valores resolvidos que geram o avatar (determinístico; trocar o avatar muda
  o hash). Existe → pronto; não existe → gera. Falha definitiva →
  arquivo-marcador `.failed` com TTL (não martelar a API a cada join).
- **Dedupe:** mapa em memória de gerações em voo por `userId` (join + save
  simultâneos disparam UMA geração).
- **Entrada:** o avatar da pessoa renderizado em PNG server-side —
  `@dicebear/core` + `@dicebear/collection` rodam em Node (deps novas da API);
  SVG → PNG via `@resvg/resvg-js` (já usado no card do Destaque). Mesma ordem
  de resolução do escritório: options → seed → userId.
- **Prompt:** imagem do avatar (identidade — o prompt explicita que ela é um
  BUSTO e serve só para rosto/cabelo/cores; o personagem gerado deve ser de
  **corpo inteiro**, com pernas e pés visíveis, proporção chibi) + descrição
  textual do estilo + **grade 2×2 em posições fixas** (TL=frente, TR=costas,
  BL=esquerda, BR=direita) sobre fundo verde-chroma (#00FF00) sólido. Se
  existirem imagens em `apps/api/assets/office-sprite-style/`, são anexadas
  como referência few-shot de estilo.
- **Modelo:** `OPENAI_MODEL_AVATAR`/`OPENAI_IMAGE_QUALITY` (envs; defaults `gpt-image-1`/`medium`, doc no
  `.env.example`). Sem `OPENAI_API_KEY_AVATAR`
  → serviço desligado, fallback permanente, zero erro no log de request.
- **Best-effort:** disparo em background nos dois gatilhos (padrão da
  avaliação de selos: falha logada, nunca derruba o save nem o join).

### Pós-processamento (`apps/api/src/lib/sprite-sheet.ts`, JS puro)

*(Ajustes v1.1, da validação com geração real: chroma-key adaptativo, frame
esquerdo espelhado do direito, prompt de corpo inteiro.)*

1. Decodifica o PNG retornado (`pngjs` — sem dependência nativa).
2. Chroma-key **adaptativo**: a cor do fundo é amostrada dos 4 cantos da
   imagem (média) — o modelo raramente devolve o #00FF00 pedido; removida com
   tolerância por distância euclidiana RGB.
3. Fatia a grade 2×2 em 4 quadrantes; apara as bordas transparentes de cada um.
4. **Validação:** quadrante vazio, ou com proporções absurdas (largura/altura
   fora de faixa), invalida a geração → 1 retry com prompt reforçado → falhou
   de novo, marca `.failed`.
5. Downscale nearest-neighbor para frames de **48px de altura** (uniformes) e
   monta o spritesheet **4×1** (ordem fixa: down, up, left, right) com frames
   de largura idêntica (padding transparente centralizado).
6. **O frame `left` é o `right` espelhado horizontalmente** (o quadrante BL
   gerado é descartado): modelos erram o lado do perfil com frequência;
   espelhar é determinístico e garante simetria perfeita.

### Contrato (`packages/shared/src/office.ts`)

- `OfficeOccupant.spriteUrl: string | null` — URL pública do spritesheet
  (`/office-sprites/<arquivo>.png`) quando pronto.
- Mensagem nova no union de server messages:
  `{ type: "sprite-updated"; userId: string; spriteUrl: string }` — broadcast
  do hub quando uma geração termina e o usuário está no mapa (sem isso, a
  primeira visita mostraria o fallback até reentrar).

### Backend — costura

- `office-ws.ts`/`office-hub.ts`: no join, o hub resolve `spriteUrl` (arquivo
  existe?) e dispara o backfill se não existir; ao concluir uma geração de
  quem está no mapa, atualiza o occupant e faz broadcast de `sprite-updated`.
- `auth.ts` (`PATCH /auth/me`): avatar mudou → dispara geração em background.
- `app.ts` + nginx: `storage/office-sprites` servido estático sob
  `/office-sprites/` (mesmo esquema de `/highlights/`).

### Web — cena (`OfficeScene.ts`)

- Occupant com `spriteUrl` → carrega o spritesheet em runtime
  (`this.load.spritesheet` + `load.start()`, ou Image manual + frames), troca
  o conjunto busto+perninhas pelo frame da direção corrente.
- `face()` com sprite IA troca **frame** (down/up/left/right) — sem flip.
- Bob mantido no passo (tween no sprite).
- `sprite-updated` chega pelo bridge → mesma rotina de troca (personagem
  "vira" pixel-art ao vivo).
- Fallback: sem `spriteUrl` (ou falha de load), fica o busto+perninhas v1.1.

## Fluxos

1. **Pessoa salva avatar novo** → geração em background → entra no escritório
   já com sprite (caso comum).
2. **Primeira visita de quem já tinha avatar** → entra com busto+perninhas →
   backfill gera (~5-15s) → `sprite-updated` → personagem vira pixel-art ao
   vivo.
3. **Troca de avatar** → hash muda → novo arquivo gerado; o antigo fica órfão
   no disco (aceito no v1; dezenas de PNGs pequenos).
4. **IA fora do ar / sem chave / geração inválida 2x** → `.failed` com TTL →
   fallback v1.1 até o TTL expirar e alguém tentar de novo.

## Erros e bordas

- Grade fora do layout pedido → validação derruba, retry 1x, depois `.failed`.
- Dois joins simultâneos do mesmo usuário → dedupe em voo, uma geração.
- Usuário sai do mapa antes da geração terminar → arquivo salvo mesmo assim
  (aproveita na próxima); broadcast só se ainda estiver no mapa.
- `OPENAI_API_KEY_AVATAR` ausente (dev) → serviço inerte, fallback permanente.
- Sprite 404 no cliente (arquivo sumiu) → onerror do load mantém o fallback.

## Testes

- **Service** (cliente Gemini mockado): cache hit não gera; dedupe em voo;
  falha → `.failed` com TTL respeitado; sucesso salva arquivo e notifica o hub.
- **`sprite-sheet.ts`** (PNGs sintéticos): chroma-key com tolerância; slicing
  2×2; validação rejeita quadrante vazio; downscale nearest e montagem 4×1.
- **Hub**: occupant com/sem `spriteUrl`; broadcast de `sprite-updated` só para
  quem está no mapa.
- **Cena**: sem teste de render (padrão do escritório); verificação manual.

## Riscos

- **Aderência da IA à grade 2×2** é o risco central — mitigada por prompt
  rígido + validação + retry + fallback. Se a taxa de falha for alta na
  prática, plano B (pack + palette swap) reusa todo o pipeline.
- **Uniformidade de estilo entre usuários** não é garantida; as referências
  few-shot em `assets/office-sprite-style/` reduzem a variação.
- **Custo/latência Gemini**: ~1 geração por usuário por troca de avatar; time
  pequeno. TTL do `.failed` evita loop de custo em pane.
