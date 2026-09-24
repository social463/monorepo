# Identidade visual EMR 2026 — design

**Origem:** `Ajustes_Portal_EMR_Documento_3.md`, seção 10 ("Inserir a nova
identidade visual da EMR no portal… logo, paleta de cores, tipografia e demais
elementos de marca") e o material que a G&G enviou: o brandbook tokenizado
(`EMR-Design-Tokens-2026.pdf`) e o ZIP `Nova marca - Identidade Visual EMR 2027`.

## O que o material traz

O PDF é uma tokenização do Brandbook EMR 2026 (p. 78–104) e separa o que é
**oficial** do que foi **derivado** para a web — separação que este spec respeita.

**Primárias (oficial, p. 97):** Residente Green `#264641` (base institucional),
Residente Approved `#6CE190` (aprovação), Residente Lime `#B4F900` (performance,
ação), Residente Off White `#F8F8F8` (neutro), Residente Orange `#FF7013`
(call to action). Lime e Orange são **acentos** — usá-los como fundo de seção
grande contraria a hierarquia do brandbook.

**Complementares (oficial, p. 98):** azul, coral, roxo, amarelo e verde, com teto
de **30% de presença**.

**Tipografia (oficial, p. 93):** **Outfit**, nos pesos 400/500/700.

**Derivados para web:** `ink-2 #1B322E`, `ink-soft #5A736B`,
`green-deep #16603C`, `approved-t #E4F9EB`, `lime-t #F0FDCC`, `line #E1E8E4`,
`dark-text #B9D2C6`, `warn #C4381B`.

## O que descobri antes de mexer

Três coisas mudam o que "aplicar a identidade" significa aqui.

### 1. `EMR_PRESET` não é usado em runtime

`getBranding` lê o que está gravado em `AppSetting` (chave `branding`) e, na
falta, cai em `LEGENDS_PRESET` — a marca do **produto**. O `EMR_PRESET` do
código é referenciado **só pelos testes**. Editá-lo, sozinho, não mudaria uma
tela do portal da EMR.

Por isso este lote faz as duas coisas: reescreve o preset (onde o teste de
contraste prova que a paleta é legível antes de qualquer deploy) **e** grava a
paleta no `AppSetting` da EMR por migration.

A migration **preserva os logos já cadastrados**. Ela não tem como subir arquivo
para o S3, e apagar a arte atual deixaria o portal sem logo nenhum até alguém
fazer upload — trocar marca antiga por marca nenhuma é pior do que a marca
antiga conviver um dia com a paleta nova.

### 2. A tipografia não era parte da marca

Cor, logo, nome e domínio são por empresa; a **fonte** estava cravada no
`tailwind.config.ts` (Geist + Inter) e carregada no `index.html`. Trocar por
Outfit ali dentro faria o **Legends** — a marca do produto, que aparece no
console interno do super-admin — passar a usar a fonte da EMR, e tiraria do
próximo cliente a possibilidade de trazer a dele.

A fonte vira **token de marca**, pelo mesmo mecanismo das cores: um campo no
preset e no DTO, injetado como variável CSS pelo `applyBranding` e consumido por
`tailwind.config.ts` com o fallback do produto. Quem não configurar nada segue
com Geist/Inter.

A família é carregada **sob demanda**, com o `upsertLink` que o `applyBranding`
já usa para favicon e manifest — a EMR baixa Outfit, o Legends não baixa nada a
mais.

### 3. Não existe vetor da marca nova

O próprio PDF avisa (p. 85–86): *"Os SVGs em produção (`logo-green.svg`,
`logo-white.svg`, `logotipo-*.svg`) ainda são a marca antiga (escudo com cruz,
`#35BD78`). A marca de 2026 não existe em vetor nos assets públicos; foi
reconstruída como máscara PNG a partir do PDF. Pedir o vetor original ao
estúdio."*

O ZIP tem seis PNGs de 2880×1620 — capa, logotipo em Approved, logotipo em Lime
e aplicações. Nenhum SVG, nenhum símbolo isolado recortado.

Consequência: **os logos não entram neste lote**. E não só por falta de vetor —
o `EMR_PRESET` já documenta a regra: a arte de um cliente não vive no
repositório, entra por Administração › Marca e fica no S3. Versionar o PNG de
2,8 MB no bundle é o oposto do que white label deveria ser.

O que entrego é a arte **recortada e pronta para upload** (logotipo horizontal e
símbolo, em tinta clara e escura), fora do repo, para a G&G subir pelo console.

## A paleta

Mapeamento das cores oficiais para os 35 tokens Material do produto. A regra do
`AGENTS.md` vale: **`primary` nunca recebe a cor institucional crua** — recebe o
tom legível do mesmo matiz, e a cor exata fica em `surface-tint`.

| Slot | Claro | Escuro | De onde vem |
|---|---|---|---|
| `surface-tint` | `#6CE190` | `#6CE190` | Approved, a cor de marca crua |
| `primary` | `#16603C` | `#6CE190` | `green-deep` (AA sobre claro); no escuro o Approved já é legível |
| `primary-container` | `#E4F9EB` | `#2F5D4A` | `approved-t` |
| `on-surface` | `#264641` | `#FFFFFF` | Residente Green como texto — 11.2:1, AAA |
| `on-surface-variant` | `#5A736B` | `#B9D2C6` | `ink-soft` / `dark-text` |
| `surface` / `background` | `#FFFFFF` / `#F8F8F8` | `#1B322E` | Off White; escuro derivado do Green |
| `outline-variant` | `#E1E8E4` | `#3A5A53` | `line` |
| `secondary` | `#4A6B00` | `#B4F900` | família do Lime |
| `secondary-container` | `#F0FDCC` | `#3F5400` | `lime-t` |
| `tertiary` | `#14618C` | `#50BCFF` | complementar azul |
| `error` | `#C4381B` | `#FF9E85` | `warn`, derivado do Orange |

**Por que o Lime não é `primary`.** Ele é o acento de performance, e o próprio
brandbook diz que usá-lo como fundo de seção grande contraria a hierarquia. Como
`primary` no Legends é ao mesmo tempo cor de texto (`text-primary` aparece ~1080
vezes) e fundo de botão, o Lime falharia nos dois papéis: 1.6:1 como texto sobre
branco. Ele entra como `secondary`, que é onde grifo e chip vivem.

**Onde o Orange ficou.** O conjunto de tokens Material não tem um slot de CTA
separado de `primary`, e o brandbook o classifica como acento com teto de
presença. Ele chega ao produto pela família `error` — que é a derivação que o
próprio PDF faz (`--warn: #C4381B`, "derivado do Orange, escurecido para
contraste AA"). Um Orange puro como `primary` contrariaria a hierarquia
declarada, em que o Green é predominante.

**Escuro é derivado.** O brandbook não trata modo escuro (é uma das "lacunas
conhecidas" do PDF). A escada escura é ancorada em `ink-2 #1B322E` e sobe pelo
Green, seguindo o mesmo princípio da paleta atual: o Legends eleva card
**clareando** a superfície, então a página precisa ser o degrau mais escuro.

**Contraste medido, não estimado.** Os 13 pares de `BRAND_CONTRAST_PAIRS` passam
nos dois esquemas — o mais apertado é a borda no escuro, em 4.53:1 contra um
mínimo de 3. O teste do `@legends/shared` trava isso.

## Escopo

| Entra | Não entra |
|---|---|
| Paleta 2026 no `EMR_PRESET`, validada pelo teste de contraste | Logos (sem vetor; e arte de cliente não vive no repo) |
| Migration gravando a paleta no `AppSetting` da EMR | Texturas (a wiki legada cita 4 padrões; não há equivalente no PDF de 2026) |
| Fonte como token de marca, com Outfit na EMR | Escala tipográfica (o brandbook define família e pesos, não tamanhos) |
| Carregamento sob demanda da família | Certificado (tem mecanismo próprio, `CertificateTemplateVisual`) |

## Pendências

1. **Vetor da marca** — pedir ao estúdio. Enquanto não chega, o logo do portal
   continua o antigo; a arte recortada que entreguei é bitmap e serve para o
   upload provisório.
2. **Data da virada** — a ATENÇÃO da seção 10 pede para definir. A migration faz
   a troca no deploy; se a G&G quiser escolher o dia, o caminho é colar o JSON de
   tokens no console em vez de subir a migration.
3. **Escala tipográfica** — o brandbook declara Outfit em 400/500/700. Os pesos
   300, 600 e 800 que o produto usa hoje são derivados; ficam como estão.
4. **Certificado** — `CertificateTemplateVisual` tem accent, logo e assinatura
   por modelo, fora do branding. Se a G&G quiser o certificado na marca nova, é
   ajuste por modelo em Administração.
