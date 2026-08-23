# @legends/site — landing page pública

Página única de marketing do Legends. **HTML, CSS e JS puros** — sem React, sem
Tailwind, sem build obrigatório. Fica separada de `apps/web` de propósito: a SPA
do produto carrega Phaser e LiveKit e dispara refresh de token no boot, coisas
que não têm o que fazer numa página pública.

## Rodar

Três formas, da mais simples para a mais completa:

```bash
# 1. Sem nada instalado — abre direto no navegador
open apps/site/index.html

# 2. Servidor estático qualquer
python3 -m http.server 5180 --directory apps/site

# 3. Vite, com hot reload (precisa de `pnpm install` na raiz)
pnpm --filter @legends/site dev        # http://localhost:5180
```

A página foi escrita para funcionar via `file://` — por isso o `main.js` é um
script clássico, não um módulo. Se você adicionar `import`/`export`, a opção 1
para de funcionar.

> Atenção: `pnpm dev` na raiz roda `-r --parallel dev` e vai subir esta landing
> junto com api e web, na 5180.

## Build

```bash
pnpm --filter @legends/site build      # gera apps/site/dist
```

A saída é estática pura: publique em S3 + CloudFront, Vercel, Netlify ou num
vhost separado do nginx. **Não** sirva a landing pelo mesmo `server` do
`nginx/default.conf`, porque lá o `try_files` cai no `index.html` da SPA.

## Estrutura

```
index.html            a página inteira, com a copy
styles.css            todos os estilos (tokens no topo)
main.js               scroll reveal + estado do header. ~2 kB
img/favicon.svg       favicon
img/og-image.png      card de compartilhamento (1200×630)
scripts/make-og.mjs   regera a og-image.png
```

## O que falta preencher

Tudo o que precisa de você está marcado com `PLACEHOLDER` ou `[colchetes]` no
HTML. Para achar:

```bash
grep -n "PLACEHOLDER\|TODO" apps/site/index.html
```

Resumo:

- **Domínio real** — `<link rel="canonical">` e as `og:url` / `og:image` usam
  `legends.example.com`. Trocar antes de publicar, senão o card de
  compartilhamento aponta pro vazio.
- **Preços** — três `[PREÇO]` nos cards e a linha "Suporte" na tabela.
- **Prova social** — o depoimento em destaque, os dois secundários e a faixa de
  logos (que está comentada no HTML; ative só quando houver logo real).
- **Hospedagem dos dados** — a última pergunta do FAQ.
- **Condição de entrada** — teste grátis, duração, se pede cartão.
- **Links do rodapé** — razão social, termos, privacidade.
- **Destinos dos CTAs** — hoje apontam para âncoras da própria página. Trocar
  por formulário, Cal.com ou `mailto:`.

## Imagens

Todos os blocos de screenshot são `<figure class="shot">` com a dimensão
recomendada escrita dentro. Cada um tem, logo acima no HTML, um comentário com o
`<img>` pronto para colar no lugar.

| Onde | Conteúdo | Dimensão |
|---|---|---|
| Herói | Vídeo mudo em loop: dois personagens se aproximando, áudio abrindo | 1600 × 900 |
| Escritório | Escritório em uso, radar de proximidade, balões de fala | 1600 × 1000 |
| PiP | Janela flutuante sobre um editor de código | 1600 × 1000 |
| Perfil | Galeria de selos + um feedback aberto | 1400 × 1050 |
| Destaque | O card PNG gerado pelo sistema | 1200 × 900 |
| Retro | Board com votos e uma ação herdada da retro anterior | 1600 × 1000 |
| Clima | Painel do líder com a curva do squad (agregada) | 1400 × 1050 |
| Setores | Painel de setores com os toggles de módulos | 1600 × 1000 |

Recomendações:

- Exporte em **WebP** (`cwebp -q 82`) com PNG de fallback só se precisar.
- Sempre `loading="lazy"` e `width`/`height` explícitos, para não causar layout shift.
- **Use dados de seed, não gente real.** `pnpm --filter @legends/api run db:seed`
  popula usuários fictícios.
- No herói, prefira `<video>` a GIF: um GIF de 1600×900 com 10s passa de 10 MB.

## Acessibilidade e performance

Já contemplado: HTML semântico, skip link, contraste AA em todos os pares de
cor, foco visível, `prefers-reduced-motion` respeitado, FAQ em `<details>`
nativo (funciona sem JS), tabela com `<th scope>` e `<caption>`.

A página não tem nenhuma dependência de runtime. A única requisição externa é o
Google Fonts. Se quiser zerar isso, baixe Bricolage Grotesque e Inter para
`img/../fonts/` e troque o `<link>` por `@font-face` com `font-display: swap`.

## Créditos obrigatórios

O rodapé credita o projeto LPC (Liberated Pixel Cup). Os assets de pixel-art do
produto são CC-BY-SA 3.0 / GPL 3.0 e **exigem atribuição** — não remova esse
bloco, e mantenha `/lpc/CREDITS.txt` acessível se a landing exibir arte do
personagem.
