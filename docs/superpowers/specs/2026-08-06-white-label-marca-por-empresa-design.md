# White label — nome, logo e cores por empresa

**Data:** 2026-08-06
**Status:** implementado

## Problema

O Legends já é multi-tenant no **dado** — `Company`, `companyId` no JWT, `AppSetting`
por `(key, companyId)`, credencial de IA que cada empresa cadastra — mas continua
mono-tenant na **aparência**. A marca está cravada no código:

| Onde | O que está cravado |
|---|---|
| `apps/web/tailwind.config.ts` | 35 cores em hex literal (paleta "Technical Precision") |
| `apps/web/index.html` | `<title>Legends</title>`, favicons, `site.webmanifest` |
| `LoginPage`, `AppLayout` (3×), `AdminSidebar`, `OfficeNavRail`, `SuperAdminLayout`, `Skeleton` | `/illustration/horizontal_logo.png`, `l.png`, `horizontal_logo_trim.png`, `alt="Legends"` |
| `LoginPage` | tagline "Onde as lendas nascem" |
| `card-renderer.ts`, `certificate-renderer.ts`, `teams-client.ts` | verde `#52fba2` no PNG do Destaque, no certificado e no card do Teams |

Vender o produto para uma segunda empresa hoje exige fork ou build por cliente.

## O que joga a favor

O front **já é semântico**: são ~1080 usos de `*-primary`, ~1810 de `*-on-surface`,
~750 de `*-surface`, ~670 de `*-outline`, ~335 de `*-error`. Ninguém escreve
`bg-[#52fba2]` nas telas. E há apenas **6** usos de `dark:` no repo inteiro — o app
é dark-only *sem variantes*.

Consequência: trocar os 35 hex do `tailwind.config.ts` por CSS variables repinta o
app inteiro **sem tocar em componente nenhum**, e tema claro vira troca de valor das
mesmas variáveis, não uma segunda folha de estilo.

## Decisão

### 1. A empresa cadastra uma cor, não trinta e cinco

Pedir 35 hex a um admin produz paleta quebrada. O tenant informa:

- **cor de marca** (obrigatória) — ex. o verde EMR `#35bd78`;
- **tom neutro** (opcional) — matiz das superfícies; a EMR usa azul (h≈230), o
  Legends usa verde-acinzentado;
- **esquema** — `light` ou `dark`.

Uma função pura em `@legends/shared` deriva os 35 tokens Material 3 a partir disso,
variando L em OKLCH com C e h fixos. Overrides por token continuam possíveis para
quem quiser ajuste fino, mas o caminho padrão é uma cor só.

### 2. Cor de marca ≠ cor de texto — a rampa é obrigatória

Medição do verde da EMR (`#35bd78`) contra o fundo claro dela (`#f2fcff`):

| Papel | Contraste | WCAG AA |
|---|---|---|
| verde como texto sobre o fundo | **2.31:1** | reprova |
| branco sobre o verde | **2.41:1** | reprova |
| mesmo verde a L=0.52 (`#007f3d`) como texto | **4.91:1** | passa |
| branco sobre `#007f3d` | **5.12:1** | passa |

O verde institucional é **decorativo**: serve para preenchimento grande, selo e
gradiente, não para texto de 14px nem para botão com rótulo branco. Como
`text-primary` aparece ~1080 vezes, usar o verde cru no tema claro deixaria boa
parte do app ilegível — inclusive no portal EMR de origem, onde o problema já
existe.

Por isso o token `primary` recebe o **tom legível** derivado (L≈0.52 no claro,
L≈0.80 no escuro) e o verde institucional exato vive em `surface-tint` e
`primary-container`, onde nada de pequeno é escrito por cima. A marca continua a
mesma aos olhos; o que muda é onde cada tom é aplicado.

Um teste em `@legends/shared` reprova qualquer paleta derivada cujos pares
críticos (`on-surface`/`surface`, `on-primary`/`primary`, `on-surface-variant`/
`surface`, `outline`/`surface`) fiquem abaixo do mínimo. Isso vale para todo
tenant futuro, não só a EMR.

### 3. Tailwind lê CSS variables, com o preset como fallback

```ts
// tailwind.config.ts
primary: 'rgb(var(--brand-primary, 82 251 162) / <alpha-value>)'
```

Canal RGB separado por espaço, não hex, porque `bg-primary/30` (opacidade) é usado
à larga e `<alpha-value>` exige esse formato. O fallback vem do preset `legends`
importado do `@legends/shared` — então, sem nenhuma variável injetada, o app renderiza
exatamente como hoje. Sem flash, sem CSS duplicado, e o default não pode divergir do
contrato porque é a mesma fonte.

### 4. Resolução por subdomínio

`GET /branding` é **público** e resolve a empresa pelo header `Host`
(`emr.dominio.com` → `Company.slug = 'emr'`, que já é `@unique`). O nginx já
repassa `Host $host`. Assim a tela de login nasce com a marca certa no primeiro
paint, sem piscar.

**Sem variável de ambiente nova.** O domínio-base sai do host de `APP_BASE_URL`,
que já existe. Ele precisa vir de algum lugar porque `legends.com.br` e
`emr.legends.com.br` têm o mesmo número de rótulos e só o primeiro é o produto —
não dá para inferir do próprio `Host`. A consequência é que os tenants moram sob
o host do app; no dia em que o domínio dos clientes divergir do domínio do
produto, aí sim entra um env próprio. Enquanto forem o mesmo, ele seria uma
segunda fonte de verdade para o mesmo valor.

Sem subdomínio conhecido, responde o preset do produto. `?slug=` existe para
desenvolvimento local, onde não há wildcard de DNS.

Infra necessária: DNS wildcard e certificado curinga. Enquanto não existirem, o
front cai no preset e nada quebra.

### 5. Onde o dado mora

`AppSetting` sob a chave `branding`, com o JSON validado por Zod — mesmo padrão de
`ai-settings-service` e `calendar-settings-service`. Trinta e cinco colunas novas em
`Company` seria uma migration por ajuste de token; o JSON não custa migration nenhuma.

`Company.name` continua sendo o nome **legal** da empresa (usado em relatório e
organograma). O nome exibido do produto é `branding.appName` — a EMR pode se chamar
"EMR Legends" na interface sem que isso vaze para o resto do sistema.

Logos vão para o S3 pelo presign que já existe (`/uploads/images/presign`); o
`AppSetting` guarda só a URL pública.

### 6. Render de servidor

**Card do Destaque do Mês.** `cardBrandFrom` deriva as cinco cores da arte
(fundo do gradiente, aro da foto, textos das pílulas, fundo do avatar) a partir
da cor da empresa, mirando as claridades da arte histórica medidas em OKLCH. Na
prática: como a marca da EMR (`#35bd78`, h=156) está na mesma família do verde
do card de hoje (h≈150), o card sai praticamente igual — e o de uma marca
qualquer mantém as mesmas relações de contraste, que é o que faz a arte
funcionar. O wordmark "DESTAQUES ___" passa a ser o nome da empresa, com a fonte
encolhendo quando o nome é comprido. A logo da empresa entra embutida em data
URI (`lib/remote-image.ts`), porque o resvg não busca URL.

Empresa que **nunca cadastrou marca** cai em `DEFAULT_CARD_BRAND`, que é a arte
histórica byte a byte: o card é material de divulgação, e mudar a cor dele sem
ninguém pedir seria uma surpresa desagradável.

**Teams.** O rodapé usa `teamsBrandFor` (nome + logo). As cores do card não
entram: Adaptive Card no Teams só aceita a paleta nomeada do tema, e é ela que
se ajusta entre claro e escuro no cliente — hex fixo ficaria ilegível num dos
dois. Isso já era assim e continua.

**Certificado — fora de escopo, e de propósito.** O `certificate-renderer` já
tinha um mecanismo próprio e mais antigo de personalização por empresa
(`CertificateTemplateVisual`: `accentColor`, `logoUrl`, assinatura, por modelo
cadastrado), com um compromisso explícito de sair byte a byte igual quando não
há modelo. Enfiar o branding por cima criaria duas fontes de verdade para a
mesma decisão. Se um dia valer unificar, o caminho é o modelo de certificado
herdar a cor da marca como default — não o renderer passar a ignorá-lo.

## Contrato (`packages/shared/src/branding.ts`)

```ts
export const BRAND_COLOR_TOKENS = [/* os 35 do tailwind */] as const
export type BrandColorToken = (typeof BRAND_COLOR_TOKENS)[number]
export type BrandScheme = 'light' | 'dark'

export interface BrandingDTO {
  appName: string
  tagline: string | null
  logoWideUrl: string | null   // horizontal — login, sidebar
  logoMarkUrl: string | null   // quadrado — rail do escritório, favicon
  scheme: BrandScheme
  brandColor: string           // hex institucional, como cadastrado
  neutralColor: string | null
  colors: Record<BrandColorToken, string>  // derivado + overrides, já resolvido
}

export function deriveBrandPalette(input): Record<BrandColorToken, string>
export const BRAND_PRESETS: { legends: BrandingPreset; emr: BrandingPreset }
```

A API **resolve** a paleta e manda pronta; o front não deriva nada. Assim web,
renderer de PNG e certificado enxergam exatamente as mesmas cores.

## Rotas

| Método | Rota | Acesso | Efeito |
|---|---|---|---|
| `GET` | `/branding` | **público** | Marca da empresa do `Host` (ou preset) |
| `GET` | `/branding/manifest.webmanifest` | público | Manifest PWA da empresa |
| `GET` | `/admin/branding` | ADMIN | Marca da empresa do token, com os campos crus |
| `PUT` | `/admin/branding` | ADMIN | Grava; audita via `recordAuditLog` |

Marca é da empresa inteira, não de um setor — então `requireAdmin`, e **não**
`requireSectorFeature`.

## Front

- `BrandProvider` acima do `Router`: busca `/api/branding`, injeta as variáveis em
  `document.documentElement.style`, ajusta `class="dark"`, `color-scheme`,
  `<title>`, favicon, `theme-color` e o link do manifest.
- `<BrandLogo variant="wide" | "mark" />` substitui os 6 pontos que hoje apontam
  para `/illustration/*.png`. Sem logo cadastrada, cai na do produto.
- Tela **Administração › Marca**: cor, tom neutro, esquema, nome, tagline, upload
  das duas logos, com prévia ao vivo e aviso quando um par reprova em contraste.

## Riscos

**Os 410 hex literais soltos no front** — triados. A maioria não é marca:
`lib/badge-art.ts` (211) é arte de selo, `office/editor/editor.css` (46) e
`OfficeScene.ts` (15) são o cenário do escritório; todos têm cor própria, de
propósito. Das classes cravadas, `bg-black/50–90` são scrims de modal e de
lightbox e `text-white` está sobre avatar colorido e vídeo — corretos nos dois
temas. O único caso real de marca cravada era o `drop-shadow` dos emblemas no
`index.css`, que agora cai em `--brand-primary`. Fica de conhecido: as sombras
`rgba(0,0,0,.55)` foram calibradas para fundo escuro e pesam um pouco no claro —
incômodo estético, não quebra.

**Cache do `GET /branding` público.** Sem cache, é uma consulta ao banco em cada
carga de página anônima. Cache em memória por slug, invalidado no `PUT`.

**Tenant que cadastra cor ilegível.** Mitigado pela derivação (a rampa corrige o
tom) e pelo aviso de contraste na tela de admin, não por bloqueio — a marca é do
cliente.

## Fora de escopo

- Fonte por empresa (a EMR usa Poppins; Legends usa Geist/Inter). O contrato deixa
  espaço, a implementação fica para depois.
- Domínio próprio por cliente (`legends.empresa.com.br`) — só subdomínio do produto.
- Tema por **usuário** (preferência de claro/escuro individual). Aqui o esquema é
  da empresa.
