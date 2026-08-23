# Plano de execução — karts posicionáveis

**Data:** 2026-07-30
**Spec:** `docs/superpowers/specs/2026-07-30-escritorio-karts-posicionaveis-design.md`

## Entregas

1. Adicionar variantes 16/32/48 do kart aos catálogos builtin e nomeado.
2. Criar tipos/helpers compartilhados para descobrir os karts publicados.
3. Trocar o booleano de montaria por estado autoritativo de veículos no hub.
4. Sincronizar snapshots e eventos no WebSocket, bridge e sessão React.
5. Renderizar karts estacionados/montados e preservar a âncora do editor.
6. Implementar a interação por proximidade com `E`, dica contextual e
   prioridade sobre links.
7. Atualizar os testes focados e executar a verificação final.

## Aceite

- É possível publicar vários karts pela paleta de mobília.
- `E` só monta quando há um kart livre ao alcance.
- Duas pessoas não ocupam o mesmo kart.
- O veículo acompanha o piloto e permanece onde ele estaciona.
- Quem entra depois recebe o estado correto de todos os veículos.
- O editor continua movendo a posição publicada, independentemente do estado
  efêmero da sessão.
- `K` não cria nem remove veículo.
