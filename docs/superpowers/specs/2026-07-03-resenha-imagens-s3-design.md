# Resenha — Imagens (upload S3) — Design Spec

- **Data:** 2026-07-03
- **Autor:** lucca.secco
- **Status:** aprovado (brainstorming) — a implementar
- **Depende de:** [Resenha](2026-06-26-resenha-design.md) e [Resenha GIFs](2026-06-29-resenha-gifs-design.md) (já em `main`)

## Resumo

Permitir **anexar uma imagem própria** (upload de arquivo) a uma resenha (post) e a um
comentário. Um botão **Imagem** no composer abre um seletor de arquivo; a imagem é
enviada **direto para um bucket S3** via **URL pré-assinada (presigned PUT)** — os bytes
**não passam pela API**. Guardamos apenas a **URL pública do objeto no S3/CDN** (mais
largura/altura), no mesmo molde da feature de GIFs (referência por URL + validação de
host). Imagem e GIF são **mutuamente exclusivos** no mesmo post/comentário.

## Decisões (do brainstorming)

- **Entrega:** feature completa ponta a ponta (contrato + backend + front).
- **Estratégia de upload:** **presigned URL** (PUT direto ao S3). A API só gera a URL
  assinada; não recebe multipart nem os bytes. **Não** instalamos `@fastify/multipart`.
- **Escopo:** **1 imagem** no **post e nos comentários** (igual ao GIF hoje).
- **Imagem × GIF:** **um ou outro** — o composer permite anexar GIF **ou** imagem, nunca
  os dois. (Texto continua opcional; vale a regra "conteúdo OU anexo" já existente.)
- **Leitura/exibição:** bucket **público / CDN**. Guardamos a **URL pública** e o front
  renderiza `<img src>` direto. Sem presigned GET.
- **Restrições:** tipos `image/jpeg`, `image/png`, `image/webp`, `image/gif`; tamanho
  **máx. 10MB**. Validação forte no **presign da API** + validação no cliente.
- **Sem processamento server-side** (resize/thumbnail): como o upload é direto, eventual
  compressão fica no cliente. Fica para depois se necessário (YAGNI).
- **Sem config → recurso degrada:** se faltar `S3_BUCKET` (etc.), `imageUploadsEnabled`
  é `false`, o endpoint de presign responde desabilitado e o front esconde o botão.
  Mesmo precedente do `gifsEnabled`.

## Configuração

`apps/api/.env` ganha (todas lidas no molde de `GIPHY_API_KEY`/`GEMINI_*`, cada lib lê
`process.env` diretamente — não há módulo central de config hoje):

- `S3_BUCKET` — nome do bucket.
- `S3_REGION` — região (ex.: `us-east-1`).
- `S3_PUBLIC_BASE_URL` — base pública dos objetos (ex.: `https://cdn.exemplo.com` ou
  `https://<bucket>.s3.<region>.amazonaws.com`). Usada para montar a `publicUrl` e para
  validar o host no backend (`assertImageHost`).
- Credenciais AWS: via **provider chain padrão** do SDK (`@aws-sdk/*`), preferindo
  **IAM role** na EC2 de produção; em dev, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`.
  Não versionar segredos.

Atualizar `apps/api/.env.example` com `S3_BUCKET`, `S3_REGION`, `S3_PUBLIC_BASE_URL` e
uma nota sobre credenciais/IAM role.

Flag derivada: `imageUploadsEnabled = Boolean(S3_BUCKET && S3_REGION && S3_PUBLIC_BASE_URL)`.
O front descobre via endpoint público (`GET /uploads/config`) e esconde o botão quando `false`.

**CORS do bucket:** o bucket precisa permitir `PUT` a partir da origem do app (header
`Content-Type`, método `PUT`). Documentar no `.env.example`/README de deploy (config de
infra, fora do código).

## Modelo de dados (Prisma)

Arquivo: `apps/api/prisma/schema.prisma`. Migration nova via `pnpm db:migrate` (nunca
editar migration aplicada). Campos **nullable** (imagem é opcional), espelhando as
colunas de GIF, em `model Review` **e** `model ReviewComment`:

```prisma
imageUrl    String?
imageWidth  Int?
imageHeight Int?
```

Sem tabela nova — 1 imagem por item, colunas inline bastam. `imageWidth/imageHeight`
reservam o aspect-ratio no render (evita layout shift).

## Contrato compartilhado (`@legends/shared`) — alterar primeiro

Novo arquivo `src/image.ts` (reexportado no barril `index.ts`), análogo a `gif.ts`:

```ts
export interface AttachedImage {
  url: string;
  width: number;
  height: number;
}

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10MB
export const ALLOWED_IMAGE_CONTENT_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
] as const;
export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];
export function isAllowedImageContentType(ct: string): ct is AllowedImageContentType;

export interface PresignImageUploadRequest {
  contentType: string;
  size: number;
}
export interface PresignImageUploadResponse {
  uploadUrl: string; // presigned PUT
  publicUrl: string; // URL final para gravar/exibir
  key: string;
}

export interface ImageUploadConfig {
  enabled: boolean;
  maxBytes: number;
  allowedContentTypes: string[];
}
```

Estender em `src/review.ts`:
- `ReviewDTO` e `ReviewCommentDTO`: `image: AttachedImage | null`.
- `CreateReviewRequest` e `CreateReviewCommentRequest`: `image?: AttachedImage | null`.

## Backend (`apps/api`)

**Dependências novas:** `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner` (no
`apps/api/package.json`).

### `src/lib/s3-client.ts` (novo)
- Lê `S3_BUCKET`, `S3_REGION`, `S3_PUBLIC_BASE_URL` de `process.env`.
- `imageUploadsEnabled(): boolean` — mesma ideia de `gifsEnabled()`.
- `presignImageUpload({ key, contentType }): Promise<string>` — usa `S3Client` +
  `PutObjectCommand` + `getSignedUrl` (expiração curta, ex. 60s).
- `publicUrlFor(key): string` — `${S3_PUBLIC_BASE_URL}/${key}`.
- Singleton do `S3Client` (lazy), no molde do `prisma.ts`/`giphy-client.ts`.

### `src/routes/image-uploads.ts` (novo, registrado em `src/app.ts`)
- `GET /uploads/config` — público. Retorna `ImageUploadConfig` (`enabled`, `maxBytes`,
  `allowedContentTypes`).
- `POST /uploads/images/presign` — **auth** (`onRequest: [app.authenticate]`). Body
  validado por Zod (`{ contentType, size }`):
  - Rejeita `400` se `!isAllowedImageContentType(contentType)` ou `size > IMAGE_MAX_BYTES`.
  - Se `!imageUploadsEnabled()`, responde de forma coerente (ex. `409/503` "uploads
    desabilitados") — o front já esconde o botão, isso é defesa.
  - Gera `key = reviews/{userId}/{crypto.randomUUID()}.{ext}` (ext derivada do
    content-type). `userId = request.user.sub`.
  - Retorna `PresignImageUploadResponse` (`uploadUrl`, `publicUrl`, `key`).

### `src/services/review-service.ts`
- Aceitar `image?: AttachedImage | null` em `createReview` e `createComment`.
- **Validação image × gif:** rejeitar se ambos vierem preenchidos (erro de domínio
  tipado, mesmo molde do `VoteError`/validações atuais → `400`).
- `assertImageHost(url)` — análogo a `assertGifHost`: a `url` deve começar com
  `S3_PUBLIC_BASE_URL`. Rejeita URLs de fora do nosso bucket/CDN.
- A regra "conteúdo OU anexo" (`assertContentOrGif`) passa a considerar imagem também
  (renomear/estender para "conteúdo OU gif OU imagem").
- Persistir `imageUrl/imageWidth/imageHeight`.

### `src/lib/serialize.ts`
- `toReviewDTO` e `toReviewCommentDTO`: montar `image: imageUrl ? { url, width, height } : null`.
- Conferir se o `toMuralReviewItem` precisa expor imagem (se o mural renderiza mídia do
  post) — alinhar com o comportamento atual de GIF no mural.

## Frontend (`apps/web`)

### `src/lib/upload.ts` (novo)
`uploadImage(file: File): Promise<AttachedImage>`:
1. valida tipo e tamanho (contra `ALLOWED_IMAGE_CONTENT_TYPES`/`IMAGE_MAX_BYTES`);
2. lê dimensões naturais (via `Image`/`createObjectURL`);
3. `POST /uploads/images/presign` (por `apiFetch`, JSON);
4. `PUT uploadUrl` com **fetch cru** (não `apiFetch`), header `Content-Type` do arquivo,
   `body: file`. Sem `Authorization` (URL já assinada; origem diferente);
5. retorna `{ url: publicUrl, width, height }`.

`apiFetch` **não** é alterado (o PUT ao S3 é um fetch separado; o presign é JSON normal).

### `src/components/ImagePicker.tsx` (novo, análogo a `GifPicker.tsx`)
- Input de arquivo, preview, estado de progresso/erro, botão remover.
- Desabilita/oculta quando já há GIF anexado (exclusão mútua) e sinaliza ao composer que
  há imagem para desabilitar o GIF.

### Composers e cards
- `ReviewComposer.tsx` e o composer de comentário (`ReviewComments.tsx`): integrar o
  `ImagePicker` ao lado do botão de GIF, com exclusão mútua.
- `ReviewCard.tsx` e `ReviewComments.tsx`: renderizar `<img>` quando `review.image`
  presente, usando `width/height` para reservar aspect-ratio.
- Enviar `image` no payload de `useCreateReview`/`useCreateComment` (`use-reviews.ts`).

### Config no front
- Hook lê `GET /uploads/config` (análogo ao `use-gifs`/`/gifs/config`); esconde o botão
  Imagem quando `enabled:false`.

## Testes (Vitest, ao lado do código)

- **`review-service`**: imagem persistida corretamente; **image + gif juntos → rejeitado**;
  `assertImageHost` rejeita URL fora do `S3_PUBLIC_BASE_URL`; "conteúdo OU anexo" aceita
  só-imagem.
- **`image-uploads` (presign)**: rejeita content-type inválido e `size > máx`; exige auth;
  responde desabilitado quando `imageUploadsEnabled` é `false`. Manter `s3-client` fino
  para testar a **validação** sem bater na AWS (mockar `presignImageUpload`/`getSignedUrl`
  ou injetar a dependência).
- **`serialize`**: `toReviewDTO`/`toReviewCommentDTO` montam `image` quando há `imageUrl`
  e `null` quando não há.
- **web**: `upload.ts` valida tipo/tamanho; `ImagePicker` respeita exclusão mútua com GIF.

## Fora de escopo (YAGNI)

- Múltiplas imagens / galeria por post.
- Resize/thumbnail server-side; conversão de formato.
- Presigned GET / bucket privado.
- Moderação automática de conteúdo de imagem.
- Remoção do objeto no S3 ao deletar a resenha (pode virar follow-up: hoje o GIF também
  só some da referência).
