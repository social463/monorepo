import { describe, expect, it } from 'vitest'
import {
  defaultCharacterFromSeed,
  isCharacterOptions,
  PAINTBALL_MARKER_LAYERS,
  type CharacterOptions,
} from '@legends/shared'
import { occupantCharacterOptions, occupantExtraLayers, occupantTextureKey } from './officeAvatar'

const base = { userId: 'u1', avatarStyle: null, avatarSeed: null, avatarOptions: null }

// Fixture v1 (shape da curadoria antiga, persistida no banco antes da migração para o catálogo LPC).
const CHARACTER_V1 = {
  bodyType: 'male' as const,
  skinTone: 'olive',
  hair: { style: 'buzzcut', color: 'black' },
  beard: null,
  torso: { item: 'shortsleeve', color: 'blue' },
  legs: { item: 'pants', color: 'black' },
  feet: { item: 'boots', color: 'brown' },
  glasses: null,
  hat: null,
}

describe('occupantCharacterOptions', () => {
  it('usa as options lpc quando válidas', () => {
    const options = defaultCharacterFromSeed('x')
    expect(occupantCharacterOptions({ ...base, avatarStyle: 'lpc', avatarOptions: options })).toEqual(options)
  })
  it('migra avatarOptions v1 (curadoria antiga) para v2, em vez de cair para o default da seed', () => {
    const migrated = occupantCharacterOptions({
      ...base,
      avatarSeed: 'ana',
      // Runtime real: o Prisma tipa avatarOptions como Json, então um registro
      // v1 no banco chega aqui sem checagem estática — o cast reflete isso.
      avatarOptions: CHARACTER_V1 as unknown as CharacterOptions,
    })
    expect(isCharacterOptions(migrated)).toBe(true)
    expect(migrated).not.toEqual(defaultCharacterFromSeed('ana'))
    expect(migrated.bodyType).toBe('male')
    expect(migrated.items.body).toEqual({ item: 'body', variant: 'olive' })
  })
  it('deriva da seed quando não há personagem salvo (ninguém fica sem boneco)', () => {
    // Também cobre o caso de um registro legado (avatarStyle 'open-peeps'):
    // a API sanitiza esses valores na borda (ver serialize.ts), então o único
    // shape "legado" que este cliente pode receber é avatarStyle/avatarOptions
    // nulos — daí o fallback determinístico pela seed.
    const derived = occupantCharacterOptions({ ...base, avatarSeed: 'ana' })
    expect(isCharacterOptions(derived)).toBe(true)
    expect(derived).toEqual(defaultCharacterFromSeed('ana'))
  })
  it('cai para o userId sem seed', () => {
    expect(occupantCharacterOptions(base)).toEqual(defaultCharacterFromSeed('u1'))
  })
})

describe('occupantTextureKey', () => {
  it('muda quando o personagem muda', () => {
    const a = occupantTextureKey({ ...base, avatarSeed: 'ana' })
    const b = occupantTextureKey({ ...base, avatarSeed: 'outra' })
    expect(a).not.toBe(b)
    expect(a).toContain('u1')
  })

  // Sem isto, o personagem armado reusaria a textura composta enquanto ele
  // estava desarmado — e a arma simplesmente não apareceria.
  it('muda ao equipar o marcador de paintball', () => {
    const desarmado = occupantTextureKey({ ...base, avatarSeed: 'ana' })
    const armado = occupantTextureKey({ ...base, avatarSeed: 'ana', paintMarker: true })
    expect(armado).not.toBe(desarmado)
  })

  it('guardar o marcador volta exatamente para a textura de antes', () => {
    expect(occupantTextureKey({ ...base, avatarSeed: 'ana', paintMarker: false })).toBe(
      occupantTextureKey({ ...base, avatarSeed: 'ana' }),
    )
  })
})

describe('occupantExtraLayers', () => {
  it('o marcador é a única camada fora do guarda-roupa, e só para quem o equipou', () => {
    expect(occupantExtraLayers(base)).toEqual([])
    expect(occupantExtraLayers({ ...base, paintMarker: true })).toEqual(PAINTBALL_MARKER_LAYERS)
  })
})

describe('marcador equipado esvazia as mãos', () => {
  const comEspadaEEscudo: CharacterOptions = {
    bodyType: 'male',
    items: {
      body: { item: 'body', variant: 'light' },
      weapon: { item: 'weapon_sword_arming', variant: 'steel' },
      shield: { item: 'shield', variant: 'crusader' },
    },
  }

  // Ninguém segura duas coisas: somando o marcador por cima do que a pessoa
  // escolheu, o estilingue saía desenhado EM CIMA da espada e do escudo.
  it('tira o que ocupa as mãos enquanto o marcador está equipado', () => {
    const armado = occupantCharacterOptions({
      ...base,
      avatarStyle: 'lpc',
      avatarOptions: comEspadaEEscudo,
      paintMarker: true,
    })

    expect(armado.items.weapon).toBeUndefined()
    expect(armado.items.shield).toBeUndefined()
    // O resto do personagem fica intacto.
    expect(armado.items.body).toEqual({ item: 'body', variant: 'light' })
  })

  it('guardar o marcador devolve o que estava na mão — nada foi persistido', () => {
    const desarmado = occupantCharacterOptions({
      ...base,
      avatarStyle: 'lpc',
      avatarOptions: comEspadaEEscudo,
    })

    expect(desarmado.items.weapon).toEqual({ item: 'weapon_sword_arming', variant: 'steel' })
    expect(desarmado.items.shield).toEqual({ item: 'shield', variant: 'crusader' })
  })

  it('a textura distingue armado de desarmado também para quem já tinha arma', () => {
    const comArma = { ...base, avatarStyle: 'lpc' as const, avatarOptions: comEspadaEEscudo }
    expect(occupantTextureKey({ ...comArma, paintMarker: true })).not.toBe(occupantTextureKey(comArma))
  })
})
