# Plano de execução — ordem de camadas da mobília

**Data:** 2026-07-30
**Spec:** `docs/superpowers/specs/2026-07-30-escritorio-ordem-camadas-design.md`

## Entregas

1. Criar a função pura de reordenação atômica de grupos e cobrir suas quatro
   direções com testes.
2. Expor a ação no hook de edição, integrando histórico, estado sujo, preview
   imediato e salvamento.
3. Adicionar os quatro botões à barra flutuante e conectá-los na página do
   escritório.
4. Sincronizar no Phaser a ordem entre sprites publicados e estampas pendentes.
5. Fazer o merge colaborativo preservar reordenações sem perder adições
   concorrentes.
6. Rodar os testes focados do editor/shared e a verificação final.

## Aceite

- Uma peça selecionada sobe ou desce exatamente um grupo visual.
- A peça pode ir diretamente para a frente ou para trás de todos os móveis da
  mesma layer.
- Assets fatiados continuam juntos e a colisão pareada não é alterada.
- A mudança aparece antes de salvar, pode ser desfeita e persiste após salvar.
- Ações sem efeito não sujam a sessão nem criam passo de undo.
