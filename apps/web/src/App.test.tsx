import { render, screen } from '@testing-library/react'
import { App } from './App'

describe('App', () => {
  it('redirects unauthenticated users to the login screen', async () => {
    localStorage.clear()
    render(<App />)
    expect(await screen.findByAltText(/legends/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /entrar/i })).toBeInTheDocument()
  })
})
