import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * O escritório nasceu dark-only, e a chegada do tema claro por empresa expôs
 * isso: a barra de mídia é um pill que tira a cor de `bg-surface`, mas os
 * ícones dentro dela eram `text-white`. Num tenant claro o pill ficava branco e
 * os ícones sumiam.
 *
 * A regra: **chrome** (barra, menus, painéis, radar, tooltip) segue os tokens;
 * **sobreposição de vídeo** continua branca, porque ali o fundo é a imagem da
 * câmera e não a superfície do app — e a imagem não muda com o tema.
 *
 * Este teste guarda a primeira metade. A segunda é a lista de exceções abaixo,
 * que existe para ser lida antes de crescer.
 */
const OFFICE = join(process.cwd(), 'src', 'office')

/** Arquivos cujo fundo é vídeo, imagem de câmera ou avatar — branco é correto. */
const SOBRE_VIDEO = [
  'media/MediaTiles.tsx',
  'media/UserVolumeControl.tsx',
  'pip/OfficePipWindow.tsx',
  'OfficeFloatingReactions.tsx',
  'PeopleList.tsx',
]

/** Chrome: flutua sobre o mapa, mas a cor é do app. Tem que seguir o tema. */
const CHROME = [
  'media/MediaBar.tsx',
  'media/MediaBarMoreMenu.tsx',
  'media/RoomChatPanel.tsx',
  'media/RoomPeoplePanel.tsx',
  'media/RaiseHandQueue.tsx',
  'media/ProximityRadar.tsx',
  'media/DeviceMenu.tsx',
  'media/CameraBackgroundMenu.tsx',
  'DeskHoverCard.tsx',
  'nav/OfficeNavRail.tsx',
]

const CRAVADO = /\b(?:text-white|bg-white\/\d+|border-white\/\d+|bg-neutral-\d+|bg-\[#[0-9a-fA-F]{3,8}\])\b/g

describe('chrome do escritório usa token, não branco cravado', () => {
  it.each(CHROME)('%s', (arquivo) => {
    const conteudo = readFileSync(join(OFFICE, arquivo), 'utf8')
    expect([...conteudo.matchAll(CRAVADO)].map((m) => m[0])).toEqual([])
  })

  it('as exceções são só as de sobreposição de vídeo, e estão listadas', () => {
    // Se este número mudar, alguém acrescentou uma exceção — leia o porquê
    // acima antes de aceitar. Fundo de vídeo é exceção; fundo do app não é.
    expect(SOBRE_VIDEO).toHaveLength(5)
  })
})
