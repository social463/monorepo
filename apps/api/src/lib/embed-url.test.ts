import { describe, expect, it } from 'vitest'
import { assertEmbedUrlAllowed } from './embed-url'
import { HrDashboardError } from './hr-dashboard-error'

const HOSTS = ['app.powerbi.com', 'lookerstudio.google.com']

function expectRejected(raw: string, trecho: string) {
  try {
    assertEmbedUrlAllowed(raw, HOSTS)
    throw new Error(`esperava rejeitar ${raw}`)
  } catch (err) {
    expect(err).toBeInstanceOf(HrDashboardError)
    expect((err as HrDashboardError).status).toBe(400)
    expect((err as HrDashboardError).message).toContain(trecho)
  }
}

describe('assertEmbedUrlAllowed', () => {
  it('aceita URL https de host liberado e devolve normalizada', () => {
    expect(assertEmbedUrlAllowed('https://app.powerbi.com/view?r=abc', HOSTS)).toBe(
      'https://app.powerbi.com/view?r=abc',
    )
  })

  it('aceita host liberado escrito em maiúsculas', () => {
    expect(assertEmbedUrlAllowed('https://APP.POWERBI.COM/view', HOSTS)).toBe('https://app.powerbi.com/view')
  })

  it('recusa texto que não é URL', () => {
    expectRejected('não é uma url', 'Informe uma URL válida.')
  })

  it('recusa http', () => {
    expectRejected('http://app.powerbi.com/view', 'Somente endereços https são aceitos.')
  })

  it('recusa javascript:', () => {
    expectRejected('javascript:alert(1)', 'Somente endereços https são aceitos.')
  })

  it('recusa data:', () => {
    expectRejected('data:text/html,<h1>oi</h1>', 'Somente endereços https são aceitos.')
  })

  it('recusa host fora da allowlist', () => {
    expectRejected('https://evil.com/view', 'não está entre as ferramentas liberadas')
  })

  it('recusa subdomínio forjado que só termina com o host liberado', () => {
    expectRejected('https://app.powerbi.com.evil.com/view', 'não está entre as ferramentas liberadas')
  })

  it('recusa URL com credenciais embutidas', () => {
    expectRejected('https://app.powerbi.com@evil.com/view', 'não está entre as ferramentas liberadas')
    expectRejected('https://user:senha@app.powerbi.com/view', 'URL com credenciais não é aceita.')
  })

  it('recusa URL com porta explícita', () => {
    expectRejected('https://app.powerbi.com:8443/view', 'URL com porta não é aceita.')
  })
})
