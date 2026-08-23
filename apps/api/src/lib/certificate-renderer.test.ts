import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PNG } from 'pngjs'
import { buildCertificateSvg, buildResolvedCertificateSvg, renderCertificate } from './certificate-renderer'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // \x89PNG

const DATA = {
  userName: 'Ana Souza',
  courseTitle: 'Liderança na prática',
  hours: 3,
  code: 'EMR-A1B2C3D4',
  issuedAtLabel: '31 de julho de 2026',
  competencies: ['Liderança', 'Feedback'],
}

/**
 * Hash do SVG/PNG produzidos pelo `certificate-renderer` ANTES desta entrega
 * (`git show HEAD:apps/api/src/lib/certificate-renderer.ts`, mesmo `DATA` acima,
 * sem nenhum modelo). Um certificado emitido antes desta mudança, re-renderizado
 * sem modelo, precisa bater com este hash — byte a byte, não só "sem exceção".
 */
const GOLDEN_SVG_SHA256 = 'be3014f4c37d864f4bdef742854cca488a1726eab3e6b2da3f6b4c33f309f4a3'
const GOLDEN_PNG_SHA256 = 'ac111b392f9532afc333abe9e4e070adeed73bc86c66c95edc1149aa3fb0fa0a'

function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

describe('buildCertificateSvg', () => {
  it('escreve nome, curso, carga horária e código de verificação', () => {
    const svg = buildCertificateSvg(DATA)

    expect(svg).toContain('CERTIFICADO DE CONCLUSÃO')
    expect(svg).toContain('Ana Souza')
    expect(svg).toContain('Liderança na prática')
    expect(svg).toContain('com carga horária de 3 horas.')
    expect(svg).toContain('EMR-A1B2C3D4')
    expect(svg).toContain('31 de julho de 2026')
  })

  it('concorda o singular de hora', () => {
    expect(buildCertificateSvg({ ...DATA, hours: 1 })).toContain('carga horária de 1 hora.')
  })

  it('escapa texto que quebraria o XML', () => {
    const svg = buildCertificateSvg({ ...DATA, userName: 'Ana <script> & Cia' })

    expect(svg).toContain('Ana &lt;script&gt; &amp; Cia')
    expect(svg).not.toContain('<script>')
  })

  it('mostra no máximo quatro competências', () => {
    const svg = buildCertificateSvg({ ...DATA, competencies: ['A', 'B', 'C', 'D', 'E'] })

    expect(svg).toContain('>A<')
    expect(svg).toContain('>D<')
    expect(svg).not.toContain('>E<')
  })
})

describe('renderCertificate', () => {
  it('produz um PNG não vazio com as fontes embutidas', async () => {
    const png = await renderCertificate(DATA)

    expect(png.subarray(0, 4)).toEqual(PNG_SIGNATURE)
    expect(png.length).toBeGreaterThan(1000)
    const image = PNG.sync.read(png)
    expect(image.width).toBe(1600)
  })
})

const TEMPLATE = {
  accentColor: '#1a2b3c',
  signatureName: 'Maria Diretora',
  signatureRole: 'Diretora de Gente e Gestão',
  signatureImageUrl: 'https://cdn.example.com/assinaturas/maria.png',
  logoUrl: 'https://cdn.example.com/logos/empresa.svg',
}

// `buildCertificateSvg` é a camada PURA: embute o `href` que recebe, sem
// buscar nada — não sabe (nem precisa saber) se é `data:` ou `https:`. Os
// testes abaixo verificam só essa costura (o valor chega até o SVG); a
// resolução de verdade (buscar a URL remota) é `buildResolvedCertificateSvg`/
// `renderCertificate`, testada no describe "resolução de imagens remotas".
describe('modelo visual (cores, assinatura, logo)', () => {
  it('sem modelo, a cor de destaque é a embutida (verde)', () => {
    const svg = buildCertificateSvg(DATA)
    expect(svg).not.toContain(TEMPLATE.accentColor)
  })

  it('com modelo, a cor de destaque do modelo substitui o verde embutido', () => {
    const svg = buildCertificateSvg(DATA, TEMPLATE)
    expect(svg).toContain(TEMPLATE.accentColor)
  })

  it('sem modelo, não há bloco de assinatura', () => {
    const svg = buildCertificateSvg(DATA)
    expect(svg).not.toContain(TEMPLATE.signatureName)
    expect(svg).not.toContain(TEMPLATE.signatureRole)
  })

  it('com modelo, o bloco de assinatura mostra nome, cargo e imagem', () => {
    const svg = buildCertificateSvg(DATA, TEMPLATE)
    expect(svg).toContain(TEMPLATE.signatureName)
    expect(svg).toContain(TEMPLATE.signatureRole)
    expect(svg).toContain(TEMPLATE.signatureImageUrl)
  })

  it('modelo sem imagem de assinatura ainda mostra nome e cargo', () => {
    const svg = buildCertificateSvg(DATA, { ...TEMPLATE, signatureImageUrl: null })
    expect(svg).toContain(TEMPLATE.signatureName)
    expect(svg).toContain(TEMPLATE.signatureRole)
  })

  it('sem modelo, usa o logo embutido; com modelo, troca pelo logoUrl', () => {
    const withoutTemplate = buildCertificateSvg(DATA)
    expect(withoutTemplate).not.toContain(TEMPLATE.logoUrl)

    const withTemplate = buildCertificateSvg(DATA, TEMPLATE)
    expect(withTemplate).toContain(TEMPLATE.logoUrl)
  })

  it('modelo sem logoUrl mantém o logo embutido (mesmo com assinatura tendo imagem própria)', () => {
    const svg = buildCertificateSvg(DATA, { ...TEMPLATE, logoUrl: null, signatureImageUrl: null })
    expect(svg).not.toContain('<image')
  })

  it('escapa cores/textos do modelo que quebrariam o XML', () => {
    const svg = buildCertificateSvg(DATA, { ...TEMPLATE, signatureName: 'Ana <script> & Cia' })
    expect(svg).toContain('Ana &lt;script&gt; &amp; Cia')
    expect(svg).not.toContain('<script>')
  })
})

describe('compatibilidade: certificado já emitido, sem modelo', () => {
  it('buildCertificateSvg sem modelo produz exatamente o mesmo SVG de antes desta mudança', () => {
    const svg = buildCertificateSvg(DATA)
    expect(sha256(svg)).toBe(GOLDEN_SVG_SHA256)
  })

  it('renderCertificate sem modelo produz exatamente o mesmo PNG de antes desta mudança', async () => {
    const png = await renderCertificate(DATA)
    expect(sha256(png)).toBe(GOLDEN_PNG_SHA256)
  })
})

/**
 * O `@resvg/resvg-js` instalado não busca URL remota sozinho — sem resolver
 * antes, `<image href="https://...">` sai em branco no PNG, em silêncio (o
 * SVG "parece" certo). Estes testes provam o artefato final que
 * `renderCertificate` de fato manda pro resvg (via `buildResolvedCertificateSvg`,
 * exportada só pra isso), não a string de entrada — e que uma falha ao buscar
 * a imagem é best-effort: loga, não derruba a emissão.
 */
describe('resolução de imagens remotas (renderCertificate)', () => {
  const A_TINY_PNG_BYTES = new Uint8Array([1, 2, 3, 4]) // conteúdo não precisa ser um PNG de verdade pra provar a costura do data URI

  function fakeResponse(ok: boolean, opts: { contentType?: string; bytes?: Uint8Array; status?: number } = {}) {
    return {
      ok,
      status: opts.status ?? (ok ? 200 : 500),
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? (opts.contentType ?? 'image/png') : null) },
      arrayBuffer: async () => (opts.bytes ?? A_TINY_PNG_BYTES).buffer,
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('busca o logo e a assinatura e embute como data URI — o SVG final carrega data:, não https:', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(true, { contentType: 'image/svg+xml' }))
    vi.stubGlobal('fetch', fetchMock)

    const svg = await buildResolvedCertificateSvg(DATA, TEMPLATE)

    const expectedDataUri = `data:image/svg+xml;base64,${Buffer.from(A_TINY_PNG_BYTES).toString('base64')}`
    expect(svg).toContain(expectedDataUri)
    expect(svg).not.toContain('https://cdn.example.com')
    expect(fetchMock).toHaveBeenCalledWith(TEMPLATE.logoUrl, expect.anything())
    expect(fetchMock).toHaveBeenCalledWith(TEMPLATE.signatureImageUrl, expect.anything())
  })

  it('URL que já é data: passa direto, sem buscar de novo', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const dataUri = 'data:image/png;base64,QUJD'

    const svg = await buildResolvedCertificateSvg(DATA, { ...TEMPLATE, logoUrl: dataUri, signatureImageUrl: null })

    expect(svg).toContain(dataUri)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falha ao buscar a imagem é best-effort: não lança, loga, e o certificado sai sem aquela imagem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(false, { status: 404 })))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const svg = await buildResolvedCertificateSvg(DATA, TEMPLATE)

    // Sem logo resolvido, cai no logo embutido de sempre — nunca um `<image
    // href="https://...">` quebrado sobrevivendo no SVG final.
    expect(svg).not.toContain('https://cdn.example.com')
    // Assinatura ainda mostra nome/cargo — só a imagem por cima da linha some.
    expect(svg).toContain(TEMPLATE.signatureName)
    expect(svg).toContain(TEMPLATE.signatureRole)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('rede fora do ar (fetch rejeita) não derruba renderCertificate — ainda sai um PNG válido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const png = await renderCertificate(DATA, TEMPLATE)

    expect(png.subarray(0, 4)).toEqual(PNG_SIGNATURE)
    const image = PNG.sync.read(png)
    expect(image.width).toBe(1600)
  })
})
