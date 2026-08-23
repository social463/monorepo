# Chat por perto: conter texto longo no balão

**Data:** 2026-07-31
**Status:** em implementação
**Tarefa:** 22059

## Contexto

O "Chat por perto" fica na `MediaBar` do escritório. Ao enviar a mensagem, o
frontend dispara `nearby-message` pelo `OfficeBridge`; o `OfficeScene` recebe o
evento e renderiza a fala/pensamento como balão preso ao personagem pelo método
`showNearbyBubble`.

Hoje o balão já limita o texto recebido a 80 caracteres e usa `wordWrap` com
largura fixa para mensagens não emoji. Ainda assim, quando o usuário digita uma
sequência longa e aperta Enter, há casos em que o texto excede o limite visual
do balão/quadrante do personagem. O problema é mais provável com palavras sem
espaço, URLs, códigos ou sequências repetidas, porque a quebra por palavra do
Phaser pode não fragmentar tokens longos o suficiente para caber dentro da
largura do balão.

## Objetivo

Garantir que mensagens enviadas pelo Chat por perto nunca vazem visualmente para
fora do balão do personagem, mantendo o comportamento efêmero atual e sem mexer
no chat persistente da sala de reunião.

## Regras de produto

- Ao digitar no Chat por perto e pressionar Enter, a mensagem continua sendo
  exibida como balão de fala ou pensamento acima do personagem.
- O balão deve conter qualquer texto aceito pela UI, inclusive palavra única
  muito longa, URL, sequência sem espaços e texto com espaços.
- O texto não deve ultrapassar a borda visual do balão nem invadir o quadrante
  visual de outro personagem.
- A mensagem continua efêmera: não persiste, não aparece na lista do painel e
  some após a animação atual.
- O comportamento de reações rápidas (`kind: "reaction"`) permanece separado:
  emojis curtos continuam sem fundo de balão e sem quebra de linha forçada.
- O comportamento do chat de sala (`RoomChatPanel` / `room-chat-message`) fica
  fora desta correção.

## Escopo técnico

### Entrada do Chat por perto

`apps/web/src/office/media/MediaBar.tsx`:

- Avaliar se o input deve impor um limite explícito de tamanho para
  `nearby-message`.
- Se houver limite novo, centralizar em constante compartilhável ou local com
  nome explícito, evitando número mágico no submit.
- O envio vazio continua fechando o chat, como hoje.
- Após envio válido, o input continua limpando sem fechar o painel.

### Render do balão no Phaser

`apps/web/src/office/scenes/OfficeScene.ts`:

- Ajustar `showNearbyBubble` para que fala/pensamento tenham largura e altura
  estáveis e compatíveis com o sprite/personagem.
- Garantir quebra de texto para tokens sem espaço. Caminhos aceitáveis:
  normalizar/inserir pontos de quebra no texto antes de `this.add.text`, ou usar
  configuração do Phaser que force quebra avançada se disponível na versão em
  uso.
- Manter truncamento defensivo para payloads recebidos por WebSocket, porque o
  servidor e outros clientes não devem conseguir forçar um balão gigante.
- Evitar uma solução que dependa apenas de CSS: o balão é desenhado dentro do
  canvas Phaser.

### Testes

`apps/web/src/office/scenes/OfficeScene.test.ts`:

- Cobrir `showNearbyBubble` com palavra única longa e garantir que o texto
  passado ao Phaser é quebrável/truncado e que a largura do fundo continua
  limitada.
- Cobrir texto com espaços para preservar quebra normal.
- Cobrir pensamento (`kind: "thought"`) se a solução diferir do balão de fala.
- Preservar teste de reação/emoji para garantir que esse caminho não ganhou
  fundo nem quebra indevida.

`apps/web/src/office/media/MediaBar.test.tsx`:

- Se a UI limitar o tamanho de entrada, cobrir que o submit envia o texto
  normalizado/limitado esperado.
- Se o limite ficar só no render do Phaser, não é necessário alterar o teste do
  `MediaBar` além de manter o comportamento de envio atual.

## Critérios de aceite

- WHEN o usuário envia uma palavra única maior que a largura do balão pelo Chat
  por perto THEN o balão SHALL quebrar/truncar o conteúdo sem texto sair da
  borda.
- WHEN o usuário envia uma URL ou sequência longa sem espaços THEN o balão SHALL
  manter largura limitada e não invadir outro quadrante.
- WHEN o usuário envia uma frase comum com espaços THEN o balão SHALL continuar
  legível e centralizado acima do personagem.
- WHEN o usuário envia uma reação rápida THEN o render SHALL permanecer no modo
  emoji/reação existente, sem fundo de balão.
- WHEN um payload remoto maior que o limite chega pelo WebSocket THEN o cliente
  SHALL aplicar defesa local antes de renderizar.

## Fora de escopo

- Persistir histórico de mensagens do Chat por perto.
- Alterar `RoomChatPanel` ou o contrato `room-chat-message`.
- Criar painel novo de chat.
- Mudar posição/tempo de animação do balão, exceto se necessário para acomodar a
  altura do texto contido.
- Alterar layout da grade de câmeras.

## Concorrência e riscos conhecidos

- PR ativo em 2026-07-31: `10689` (`sync: integração dos 7 PRs abertos`), de
  `sync/prs-abertos` para `main`.
- Branch remota relacionada por nome: `origin/fix/chat-input-focus-grid`.
  Antes da implementação, comparar essa branch contra `origin/main`, porque ela
  toca arquivos grandes do escritório e pode conter correções/reestruturações
  próximas ao fluxo de input/chat.
- A branch `origin/fix/chat-input-focus-grid` parece divergente e remove muitos
  docs recentes quando comparada diretamente a `origin/main`; tratar como fonte
  de contexto, não como base de trabalho.

## Verificação manual recomendada

1. Entrar no escritório com pelo menos um personagem visível.
2. Abrir o Chat por perto pela `MediaBar`.
3. Enviar, com Enter, uma palavra longa como
   `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`.
4. Confirmar que o balão fica contido acima do personagem.
5. Repetir com URL longa e com modo `Pensar`.
6. Confirmar que reações rápidas continuam com o comportamento visual atual.
