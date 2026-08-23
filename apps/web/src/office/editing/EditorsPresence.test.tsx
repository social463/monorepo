import { render, screen } from '@testing-library/react'
import { EditorsPresence } from './EditorsPresence'

it('lista outros editores pelo nome, excluindo você', () => {
  render(
    <EditorsPresence
      editorUserIds={['me', 'u2']}
      youId="me"
      occupants={[{ userId: 'me', name: 'Eu' }, { userId: 'u2', name: 'Ana' }] as any}
    />,
  )
  expect(screen.getByText(/Ana/)).toBeInTheDocument()
  expect(screen.queryByText(/Eu/)).not.toBeInTheDocument()
})

it('não renderiza nada quando só você edita', () => {
  const { container } = render(
    <EditorsPresence editorUserIds={['me']} youId="me" occupants={[{ userId: 'me', name: 'Eu' }] as any} />,
  )
  expect(container).toBeEmptyDOMElement()
})
