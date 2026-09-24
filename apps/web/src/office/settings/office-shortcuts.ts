export interface OfficeShortcutItem {
  keys: string[]
  label: string
  context: string
}

export interface OfficeShortcutGroup {
  title: string
  icon: string
  items: OfficeShortcutItem[]
}

export const OFFICE_SHORTCUT_GROUPS: OfficeShortcutGroup[] = [
  {
    title: 'Movimento',
    icon: 'directions_run',
    items: [
      { keys: ['WASD'], label: 'Mover personagem', context: 'também funciona com as setas; duas teclas juntas andam na diagonal' },
      { keys: ['Shift'], label: 'Correr', context: 'segure enquanto se move' },
      { keys: ['Botão direito'], label: 'Andar até um ponto', context: 'clique em um tile do mapa' },
      { keys: ['Botão esquerdo'], label: 'Mover o mapa', context: 'arraste o cenário' },
    ],
  },
  {
    title: 'Interações',
    icon: 'touch_app',
    items: [
      { keys: ['E'], label: 'Interagir', context: 'kart, links e objetos próximos' },
      { keys: ['WASD'], label: 'Conduzir a bola', context: 'ande por cima dela e ela vai no seu pé' },
      { keys: ['Z'], label: 'Tocar na bola', context: 'empurrão de um tile, com a bola ao alcance' },
      { keys: ['X'], label: 'Chutar a bola', context: 'com a bola ao alcance; com Shift, chute com corrida' },
      { keys: ['C'], label: 'Chute alto', context: 'a bola sobe e passa por cima de mesas e gente' },
      { keys: ['Q'], label: 'Pegar ou guardar o marcador', context: 'a arma de paintball; desarmado, o tiro não sai' },
      { keys: ['V'], label: 'Atirar paintball', context: 'na direção que você encara; deixa uma marca de tinta em quem levar' },
      { keys: ['Ctrl/Cmd', 'D'], label: 'Ir para minha mesa', context: 'quando houver mesa reivindicada' },
      { keys: ['Enter'], label: 'Abrir chat por perto', context: 'fora de campos de texto' },
      { keys: ['F'], label: 'Soltar confete', context: 'segure para manter ativo' },
      { keys: ['R'], label: 'Girar personagem', context: 'um quarto de volta por toque' },
      { keys: ['1-8'], label: 'Enviar reação', context: 'usa os emojis configurados na barra' },
    ],
  },
  {
    title: 'Áudio e reunião',
    icon: 'groups',
    items: [
      { keys: ['M'], label: 'Ligar ou desligar microfone', context: 'quando o áudio está conectado' },
      { keys: ['Espaço'], label: 'Push-to-talk', context: 'segure para falar e solte para silenciar' },
      { keys: ['H'], label: 'Levantar ou abaixar a mão', context: 'em sala ou zona onde a ação está disponível' },
      { keys: ['L'], label: 'Trancar ou destrancar sala', context: 'em sala travável' },
    ],
  },
  {
    title: 'Tela e painéis',
    icon: 'space_dashboard',
    items: [
      { keys: ['P'], label: 'Riscar ou parar de riscar tela', context: 'quando houver tela compartilhada em destaque' },
      { keys: ['Esc'], label: 'Fechar camada aberta', context: 'cards, menus, modais e painéis compatíveis' },
    ],
  },
]
