import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultCharacterFromSeed } from '@legends/shared'
import { Avatar } from './Avatar'

vi.mock('../lib/character', () => ({
  characterPortraitDataUri: vi.fn(() => Promise.resolve('data:image/png;base64,retrato')),
}))

describe('Avatar', () => {
  it('renderiza o retrato quando avatarStyle é lpc', async () => {
    render(
      <Avatar
        user={{
          name: 'Ana Souza',
          avatarStyle: 'lpc',
          avatarSeed: 'ana',
          avatarOptions: defaultCharacterFromSeed('ana'),
        }}
      />,
    )
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,retrato'))
  })

  it('legado open-peeps ganha o personagem padrão da seed', async () => {
    render(<Avatar user={{ name: 'Ana', avatarStyle: 'open-peeps', avatarSeed: 'ana', avatarOptions: null }} />)
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument())
  })

  it('sem estilo cai para photoUrl', () => {
    render(<Avatar user={{ name: 'Ana', photoUrl: 'https://x/foto.jpg' }} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/foto.jpg')
  })

  // Quem identifica a pessoa na plataforma é a foto do cadastro; o personagem
  // LPC é do jogo e vale no Escritório Virtual, que não passa por este componente.
  it('a foto ganha do personagem quando a pessoa tem os dois', async () => {
    render(
      <Avatar
        user={{
          name: 'Ana Souza',
          photoUrl: 'https://x/foto.jpg',
          avatarStyle: 'lpc',
          avatarSeed: 'ana',
          avatarOptions: defaultCharacterFromSeed('ana'),
        }}
      />,
    )
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/foto.jpg')
    // Mesmo depois de o retrato terminar de ser gerado, a foto continua valendo.
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'https://x/foto.jpg'))
  })

  it('sem nada cai para iniciais', () => {
    render(<Avatar user={{ name: 'Ana Souza' }} />)
    expect(screen.getByText('AS')).toBeInTheDocument()
  })
})
