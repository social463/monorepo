---
name: web-design-guidelines
description: Revisa código de interface do Legends contra as Web Interface Guidelines da Vercel (acessibilidade, teclado, formulário, animação, performance). Use ao terminar uma tela, ao pedir "revisa minha UI", "confere acessibilidade" ou antes de abrir PR de frontend.
---

# Diretrizes de interface (Vercel) aplicadas ao Legends

As regras vivem no repositório da Vercel e mudam com o tempo — **busque a versão
de hoje, não confie em memória**:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

Baseado na skill `web-design-guidelines` de
[vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills).

## Como revisar

1. **Baixe as regras** com `WebFetch` na URL acima. Sem rede, diga que está
   revisando de memória e siga assim mesmo — melhor uma revisão parcial e
   declarada do que nenhuma.
2. **Escolha o alvo.** Sem arquivo indicado, revise o diff da branch
   (`git diff origin/main...HEAD -- 'apps/web/**'`). Pergunte só se o diff
   estiver vazio.
3. **Confira cada regra** contra o código e reporte em `arquivo:linha`, do mais
   grave para o mais leve. Nada de repetir regra que o código já cumpre.
4. **Não aplique correção** sem o usuário pedir; termine com o que você mudaria.

## O que é específico deste repo

Antes de apontar "cor fora do padrão" ou "fonte fora do padrão", leia o
`AGENTS.md`: aqui a paleta é **por empresa** (white label). As regras locais que
valem mais que o costume da Vercel:

- **Cor sai de token**, nunca de hex no componente: `bg-primary`,
  `text-on-surface`, `border-outline-variant`. Hex cravado em `apps/web/src` é
  achado, salvo o `MeetingSeal` e o `program-theme` do Eu Aprendiz, que são
  arte de marca declarada.
- **`text-primary` precisa passar contraste** no tema da empresa; dentro do Eu
  Aprendiz o texto verde é `text-on-primary-container`.
- **Tema claro/escuro é do tenant.** `dark:` NÃO resolve: o Tailwind daqui não
  usa `darkMode: 'class'`, e a variante segue o sistema operacional. Quem
  precisa decidir por tema lê `useBrandContext().scheme`.
- **Texto em português**, sentence case, sem jargão de sistema.
- **Responsivo até ~400px** e sem rolagem horizontal.
- **Teclado e foco visível** em tudo que é clicável; diálogo fecha no Esc, no X
  e no clique fora (veja `MeetingDetailDialog` e `VacationDialog`).
- **Estado vazio e erro** dizem o que fazer, em vez de só informar que deu
  errado.

## Para ver de verdade

Achado de layout, contraste ou foco vale mais com a tela na frente: a skill
`verify` sobe o app, e o MCP `chrome-devtools` abre o navegador. Screenshot do
antes e do depois é o que fecha a revisão.
