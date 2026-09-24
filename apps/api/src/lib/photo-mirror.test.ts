import { describe, expect, it } from 'vitest'
import {
  buildImportedPhotoKey,
  isMirrorOf,
  mirrorPhoto,
  normalizePhotoSourceUrl,
  PhotoMirrorError,
} from './photo-mirror'

describe('normalizePhotoSourceUrl', () => {
  it('converte o link de compartilhamento do Drive na URL de conteúdo', () => {
    expect(normalizePhotoSourceUrl('https://drive.google.com/file/d/1AbC_dEfGhIjK/view?usp=sharing')).toBe(
      'https://drive.google.com/thumbnail?id=1AbC_dEfGhIjK&sz=w800',
    )
  })

  it('aceita as outras formas de link do Drive', () => {
    const esperado = 'https://drive.google.com/thumbnail?id=1AbC_dEfGhIjK&sz=w800'
    expect(normalizePhotoSourceUrl('https://drive.google.com/open?id=1AbC_dEfGhIjK')).toBe(esperado)
    expect(normalizePhotoSourceUrl('https://drive.google.com/uc?export=download&id=1AbC_dEfGhIjK')).toBe(esperado)
    expect(normalizePhotoSourceUrl('https://drive.google.com/file/d/1AbC_dEfGhIjK/preview')).toBe(esperado)
  })

  it('deixa passar inteira a URL que já aponta para a imagem', () => {
    expect(normalizePhotoSourceUrl('https://cdn.exemplo.com/fotos/maria.jpg')).toBe(
      'https://cdn.exemplo.com/fotos/maria.jpg',
    )
  })

  it('recusa o que não é link http(s)', () => {
    expect(normalizePhotoSourceUrl('maria.jpg')).toBeNull()
    expect(normalizePhotoSourceUrl('javascript:alert(1)')).toBeNull()
    expect(normalizePhotoSourceUrl('  ')).toBeNull()
  })

  it('recusa endereço interno — o fetch sai do nosso servidor', () => {
    expect(normalizePhotoSourceUrl('http://169.254.169.254/latest/meta-data/')).toBeNull()
    expect(normalizePhotoSourceUrl('http://localhost:3333/health')).toBeNull()
    expect(normalizePhotoSourceUrl('http://127.0.0.1/foto.jpg')).toBeNull()
    expect(normalizePhotoSourceUrl('http://10.0.0.5/foto.jpg')).toBeNull()
    expect(normalizePhotoSourceUrl('http://172.20.1.1/foto.jpg')).toBeNull()
    expect(normalizePhotoSourceUrl('http://192.168.0.7/foto.jpg')).toBeNull()
  })
})

describe('isMirrorOf', () => {
  const origem = 'https://drive.google.com/thumbnail?id=1AbC_dEfGhIjK&sz=w800'
  const chave = buildImportedPhotoKey('empresa-1', origem, 'image/jpeg')

  it('reconhece o espelho da mesma origem', () => {
    expect(isMirrorOf(`https://cdn.legends.test/${chave}`, 'empresa-1', origem)).toBe(true)
  })

  it('não confunde origem diferente, empresa diferente nem foto subida à mão', () => {
    expect(isMirrorOf(`https://cdn.legends.test/${chave}`, 'empresa-2', origem)).toBe(false)
    expect(isMirrorOf(`https://cdn.legends.test/${chave}`, 'empresa-1', 'https://outra.com/foto.jpg')).toBe(false)
    expect(isMirrorOf('https://cdn.legends.test/reviews/u1/abc.jpg', 'empresa-1', origem)).toBe(false)
    expect(isMirrorOf(null, 'empresa-1', origem)).toBe(false)
  })
})

/** Sem S3 configurado o espelho degrada para a própria origem — ver a lib. */
describe('mirrorPhoto sem S3 configurado', () => {
  it('devolve a URL de origem sem baixar nada', async () => {
    let chamou = false
    const fake: typeof fetch = async () => {
      chamou = true
      return new Response(null)
    }
    // O `.env` de dev traz bucket configurado; aqui o cenário é o oposto.
    const antes = { ...process.env }
    delete process.env.S3_BUCKET
    delete process.env.S3_REGION
    delete process.env.S3_PUBLIC_BASE_URL
    try {
      await expect(mirrorPhoto('https://cdn.exemplo.com/maria.jpg', 'empresa-1', fake)).resolves.toBe(
        'https://cdn.exemplo.com/maria.jpg',
      )
      expect(chamou).toBe(false)
    } finally {
      process.env = antes
    }
  })
})

describe('mirrorPhoto com S3 configurado', () => {
  const env = { S3_BUCKET: 'b', S3_REGION: 'us-east-1', S3_PUBLIC_BASE_URL: 'https://cdn.legends.test' }

  function comS3<T>(run: () => Promise<T>): Promise<T> {
    const antes = { ...process.env }
    Object.assign(process.env, env)
    return run().finally(() => {
      for (const key of Object.keys(env)) {
        if (antes[key] === undefined) delete process.env[key]
        else process.env[key] = antes[key]
      }
    })
  }

  it('recusa a página de login que o Drive devolve para arquivo fechado', async () => {
    const fake: typeof fetch = async () =>
      new Response('<html>Entrar</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
    await comS3(async () => {
      await expect(mirrorPhoto('https://drive.google.com/thumbnail?id=x', 'empresa-1', fake)).rejects.toThrow(
        PhotoMirrorError,
      )
      await expect(mirrorPhoto('https://drive.google.com/thumbnail?id=x', 'empresa-1', fake)).rejects.toThrow(
        /compartilhado como público/,
      )
    })
  })

  it('recusa resposta de erro', async () => {
    const fake: typeof fetch = async () => new Response('', { status: 404 })
    await comS3(async () => {
      await expect(mirrorPhoto('https://cdn.exemplo.com/x.jpg', 'empresa-1', fake)).rejects.toThrow(/404/)
    })
  })
})
