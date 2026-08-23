# Resenha — GIFs (Tenor) — Design Spec

- **Data:** 2026-06-29
- **Autor:** lucca.secco
- **Status:** aprovado (brainstorming) — implementado
- **Atualização (2026-06-29):** a **API do Tenor foi descontinuada para novos clientes**
  (jan/2026). O provedor passou a ser o **Giphy** (era a opção 2 do brainstorming): mesma
  arquitetura de proxy+mapeamento, `GIPHY_API_KEY`, allowlist por sufixo `.giphy.com`,
  atribuição "Powered by GIPHY". Onde abaixo se lê "Tenor", considere "Giphy".
- **Depende de:** [Resenha](2026-06-26-resenha-design.md) e [Menções](2026-06-26-resenha-mencoes-design.md) (já em `main`)

## Resumo

Permitir **anexar um GIF** a uma resenha (post) e a um comentário. Um botão **GIF** no
composer abre um picker que busca GIFs em tempo real via **Tenor** (API do Google,
gratuita com chave). Ao escolher, o GIF aparece como preview no composer (com botão de
remover) e, ao publicar, é exibido no feed. Guardamos apenas a **URL do GIF no CDN do
Tenor** (mais dimensões), sem download nem disco.

## Decisões (do brainstorming)

- **Fonte:** picker com busca via **Tenor** (não Giphy, não colar URL).
- **Escopo:** GIF no **post e nos comentários**.
- **GIF × texto:** pode publicar **só GIF**, **só texto** ou **os dois**; **máx. 1 GIF**
  por post/comentário. Isso muda a validação atual (que exige ≥1 caractere).
- **Armazenamento:** **referenciar a URL do Tenor** (`media.tenor.com`) + largura/altura;
  sem baixar/auto-hospedar.
- **Proxy:** o front **não** chama o Tenor direto; passa pelo backend (`/api/gifs/...`)
  para manter a chave fora do navegador e seguir a convenção "web só fala com `/api`".
- **Atribuição:** exibir "Powered by Tenor" no picker (exigência do Tenor).
- **Sem chave configurada:** o recurso degrada — o botão GIF fica **escondido** quando o
  backend sinaliza que GIFs não estão habilitados.

## Configuração

`apps/api/.env` ganha `TENOR_API_KEY` (opcional) e, opcional, `TENOR_CLIENT_KEY`
(identificador do app, recomendado pelo Tenor). Lidos em `lib/config.ts` no mesmo molde
de `GEMINI_API_KEY`/`GEMINI_MODEL`. Atualizar `apps/api/.env.example`.

Flag derivada: `gifsEnabled = Boolean(config.tenorApiKey)`. O front descobre via um
endpoint público leve (ver "Backend") e esconde o botão quando `false`.

## Modelo de dados (Prisma)

Arquivo: `apps/api/prisma/schema.prisma`. Migration nova via `pnpm db:migrate` (nunca
editar migration aplicada). Campos **nullable** (GIF é opcional):

```prisma
// em model Review e em model ReviewComment:
gifUrl    String?
gifWidth  Int?
gifHeight Int?
```

Não há tabela nova — é 1 GIF por item, então colunas inline bastam. `gifWidth/gifHeight`
servem para reservar o aspect-ratio no render (evita layout shift).

## Contrato compartilhado (`@legends/shared`) — alterar primeiro

Novo arquivo/seção `gif.ts` (barril em `index.ts`):

```ts
/** Hosts de CDN do Tenor aceitos ao gravar um gifUrl. */
export const TENOR_MEDIA_HOSTS = ['media.tenor.com', 'c.tenor.com'] as const

/** Item de GIF devolvido pelo picker (resultado de busca). */
export interface GifResult {
  id: string
  url: string          // URL do .gif para exibir/gravar
  previewUrl: string   // still/preview leve para a grade do picker
  width: number
  height: number
  description: string  // texto alternativo (content_description do Tenor)
}

/** GIF anexado, como persistido/serializado. */
export interface AttachedGif {
  url: string
  width: number
  height: number
}

export interface GifSearchResponse {
  results: GifResult[]
  next: string | null  // cursor de paginação do Tenor
}
```

Ajustes em `review.ts`:

- `ReviewDTO` e `ReviewCommentDTO` ganham `gif: AttachedGif | null`.
- `CreateReviewRequest` e `CreateReviewCommentRequest` ganham `gif?: AttachedGif`.

## Backend (`apps/api`)

### Rota de GIFs — `src/routes/gifs.ts` (route fina)

- `GET /gifs/config` → `{ enabled: boolean }` (público; o front usa para mostrar/ocultar
  o botão). Alternativa: incluir `gifsEnabled` numa rota de config já existente, se houver;
  caso contrário, este endpoint dedicado.
- `GET /gifs/search?q=<termo>&pos=<cursor>` (protegida, `app.authenticate`):
  - Zod valida query (`q` string, `pos` opcional). Sem chave → `503 { message }`.
  - Chama o service/lib do Tenor; devolve `GifSearchResponse`.
  - `q` vazio → usar "featured" do Tenor (GIFs em alta).

### `src/lib/tenor-client.ts`

- Wrapper sobre `fetch` à API REST v2 do Tenor
  (`https://tenor.googleapis.com/v2/search` e `/featured`), passando `key`, `client_key`,
  `limit`, `pos`, `media_filter=gif,tinygif`, `contentfilter=high` (apropriado p/ tool
  interno de trabalho).
- Mapeia a resposta do Tenor → `GifResult` (usa `media_formats.gif` para `url`/dimensões
  e `media_formats.tinygif` para `previewUrl`).
- Erros de rede/HTTP do Tenor sobem como erro de domínio com `status` (padrão do repo).

### `services/review-service.ts`

- `createReview`/`createComment` aceitam `gif?: AttachedGif`.
- **Validação nova:** publicar exige `content` (após trim) não-vazio **ou** `gif`
  presente. Se ambos vazios → erro 400 (classe de erro tipada existente do domínio).
- **Allowlist de host:** se `gif` presente, validar que `new URL(gif.url).host` ∈
  `TENOR_MEDIA_HOSTS`; senão 400. Evita gravar URL arbitrária.
- Persistir `gifUrl/gifWidth/gifHeight`.

### `lib/serialize.ts`

- `toReviewDTO`/`toReviewCommentDTO` incluem
  `gif: review.gifUrl ? { url, width, height } : null`.

### Tempo real

- Os eventos de socket já existentes (`feed:changed`, `comments:changed`) cobrem a
  criação com GIF — nada novo a enviar (DTO carrega o gif).

## Frontend (`apps/web`)

### `lib/use-gifs.ts`
- Hook React Query para `GET /api/gifs/search` (busca com debounce + paginação via `next`).
- Hook/flag para `GET /api/gifs/config` (`gifsEnabled`).

### `components/GifPicker.tsx`
- Popover/modal: input de busca (debounce), grade de 2 colunas com `previewUrl`,
  scroll com "carregar mais" via cursor `next`, rodapé "Powered by Tenor".
- `onSelect(gif: GifResult)` devolve o GIF escolhido e fecha.

### Composers
- `ReviewComposer.tsx` e a caixa de comentário em `ReviewComments.tsx`:
  - Botão **GIF** (escondido quando `gifsEnabled === false`).
  - Estado local `gif: AttachedGif | null` (do composer, não do `MentionTextarea`).
  - Quando há GIF: preview (thumb com aspect-ratio) + botão **✕** para remover.
  - `canSubmit` passa a permitir **só-GIF** (`trimmed.length >= 1 || gif`), respeitando
    `REVIEW_MAX_LENGTH` para o texto.
  - `onSubmit` envia `gif` junto com `content`/`mentionedUserIds`.

### Render no feed
- `ReviewCard.tsx` e o item de comentário em `ReviewComments.tsx`: quando `review.gif`/
  `comment.gif` existe, renderizar `<img>` com `width/height` (aspect-ratio reservado),
  `max-w` adequado, cantos arredondados, `loading="lazy"`, `alt` genérico ("GIF").

### `lib/use-reviews.ts`
- `useCreateReview`/`useCreateComment` repassam `gif` no corpo.

## Testes

### API (Postgres real + mock de `fetch` ao Tenor)
- `routes/gifs.test.ts`: `search` mapeia resposta do Tenor → `GifResult`; sem chave →
  503; `/gifs/config` reflete a flag.
- `services/review-service.test.ts`: criar resenha **com gif**, **só-gif** (sem texto),
  **rejeitar vazio sem gif** (400), **rejeitar gifUrl de host fora da allowlist** (400).
- `lib/serialize.test.ts`: gif serializado no DTO (e `null` quando ausente).

### Web (jsdom + Testing Library; mock do fetch)
- `GifPicker`: digita termo → renderiza grade → clicar seleciona e chama `onSelect`.
- Composer: anexar GIF habilita publicar sem texto; remover GIF (✕) volta ao estado;
  botão some quando `gifsEnabled === false`.
- `ReviewCard`: renderiza `<img>` do GIF quando presente.

## Fora de escopo (YAGNI)

- Múltiplos GIFs por post; upload de GIF próprio; edição de GIF após publicar; busca por
  categorias/trending tabs no picker; analytics de "share" do Tenor (registerShare).
- Auto-hospedagem/cópia do GIF (decidido: referenciar Tenor).
