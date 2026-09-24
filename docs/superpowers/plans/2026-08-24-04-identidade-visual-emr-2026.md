# Plan — Identidade visual EMR 2026

Spec: `docs/superpowers/specs/2026-08-24-identidade-visual-emr-2026-design.md`

Os passos 1 e 2 são independentes; o 3 depende dos dois (a migration grava
paleta **e** fonte).

## 1. Paleta

- [x] `EMR_PRESET`: `brandColor` `#35bd78` → `#6CE190`, `neutralColor` → `#F8F8F8`
      e os dois esquemas de `overrides` reescritos com os tokens de 2026.
- [x] Comentários do preset explicando o mapeamento: por que o Lime não é
      `primary`, onde o Orange ficou, e que o escuro é derivado (o brandbook não
      trata modo escuro).
- [x] Os 13 pares passam nos dois esquemas. **Dois ajustes que o contraste
      exigiu**, e nenhum deles é da marca:
      - `on-surface-variant` claro é `#526a62`, um fio mais escuro que o
        `ink-soft` do brandbook: sobre o degrau mais claro da escada de
        superfícies o valor oficial cai para 4.03:1;
      - o topo da escada escura é `#315850`, e não um tom mais claro, para o
        `dark-text` do brandbook render 4.96:1 ali.
      Nos dois casos quem cedeu foi a escada, que é do produto — o brandbook
      lista "sem sistema de espaçamento/superfície" entre as próprias lacunas.

## 2. Fonte como token de marca

- [x] `@legends/shared`: `BrandFonts { headline, body }` no `BrandingPreset`, no
      `BrandingDTO` e no `StoredBranding`; constante com a pilha do produto
      (Geist/Inter) como padrão.
- [x] `PRODUCT_FONT_STACK` e validação: nome de família precisa ser seguro para
      entrar em `<link>` do Google Fonts e em `font-family`.
- [x] `apps/api`: `brandingSchema` aceita `fonts`; `presetFromStored` repassa.
- [x] `apps/web/src/lib/branding.ts`: `applyBranding` injeta
      `--brand-font-headline` / `--brand-font-body` e carrega a família por
      `upsertLink`, como já faz com favicon e manifest.
- [x] `tailwind.config.ts`: `headline`/`label`/`body`/`sans` passam a ler
      `var(--brand-font-*, <pilha do produto>)`.
- [x] `EMR_PRESET.fonts` = Outfit.
- [x] Console do super-admin: campo para a família, ao lado da cor.
- [x] Testes: empresa sem `fonts` continua com Geist/Inter; a EMR carrega Outfit;
      nome com aspas, ponto e vírgula ou parêntese é recusado (ele entra numa URL
      do Google Fonts **e** numa declaração `font-family` — aceitar seria deixar
      o cadastro de marca escrever CSS).

## 3. Aplicar na empresa EMR

- [x] Migration que grava a paleta e a fonte no `AppSetting` (`key: 'branding'`,
      `companyId: 'company-emr'`), **preservando os logos já cadastrados** — ela
      não sobe arquivo para o S3, e trocar marca antiga por marca nenhuma é pior.
- [x] Migration é **só UPDATE**, nunca INSERT: empresa sem registro de marca cai
      no padrão do produto, e inventar um registro seria cadastrar configuração
      que ninguém pediu. Merge de chaves de topo (`||`), então nome exibido,
      assinatura, domínios, esquema e logos ficam intactos.
- [x] Conferido no banco de dev: `appName` e logos preservados, `brandColor`,
      `fonts` e os 35 tokens de cada esquema reescritos.

## 4. Arte para upload (fora do repo)

- [x] Recortar do ZIP o logotipo horizontal (tinta Approved e tinta clara) e o
      símbolo isolado, em PNG com fundo transparente, no scratchpad.
- [x] Entregar os caminhos para a G&G subir em Administração › Marca.

## 5. Fechamento

- [x] `pnpm test` com o Postgres de pé: shared 534/534, web **2528/2528** e api
      **2922/2922** — as três suítes inteiras, sem exceção.
- [x] Conferido no app rodando: `GET /branding?slug=emr` devolve Outfit e a
      paleta nova; `GET /branding` do produto continua em Geist/Inter, provando
      que a fonte virou token de marca e não troca global.

## 6. O que fica para a G&G

- **Subir a arte** em Administração › Marca. Os recortes estão em
  `…/scratchpad/logo-emr-2026/`: logotipo e símbolo, em tinta Approved e em
  Lime. São bitmaps — o vetor da marca de 2026 não existe, e o próprio brandbook
  manda pedir ao estúdio.
- **Data da virada.** A migration troca a paleta no deploy. Para escolher o dia,
  o caminho é não subir a migration e colar o JSON de
  `…/scratchpad/emr-2026-tokens.json` no console.
