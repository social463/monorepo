import { describe, expect, it } from 'vitest'
import { parseYouTubePlaylistId, parseYouTubeVideoId } from './office-audio-share'
import { toVideoEmbedUrl } from './learning'

const ID = 'dQw4w9WgXcQ'

describe('parseYouTubeVideoId', () => {
  it('lê o id das formas que a pessoa copia do navegador', () => {
    expect(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID)
    expect(parseYouTubeVideoId(`https://youtube.com/watch?v=${ID}&list=PLabc`)).toBe(ID)
    expect(parseYouTubeVideoId(`https://youtu.be/${ID}`)).toBe(ID)
    expect(parseYouTubeVideoId(`https://youtu.be/${ID}?t=42`)).toBe(ID)
    expect(parseYouTubeVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID)
    expect(parseYouTubeVideoId(`https://www.youtube.com/live/${ID}`)).toBe(ID)
    expect(parseYouTubeVideoId(`https://www.youtube.com/v/${ID}`)).toBe(ID)
    expect(parseYouTubeVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID)
    expect(parseYouTubeVideoId(`https://music.youtube.com/watch?v=${ID}`)).toBe(ID)
    expect(parseYouTubeVideoId(`https://www.youtube-nocookie.com/embed/${ID}`)).toBe(ID)
    expect(parseYouTubeVideoId(`http://youtube.com/watch?v=${ID}`)).toBe(ID)
  })

  it('aceita o id cru e ignora espaços em volta', () => {
    expect(parseYouTubeVideoId(ID)).toBe(ID)
    expect(parseYouTubeVideoId(`  https://youtu.be/${ID}  `)).toBe(ID)
  })

  it('recusa o que não é vídeo do YouTube', () => {
    expect(parseYouTubeVideoId('')).toBeNull()
    expect(parseYouTubeVideoId('   ')).toBeNull()
    expect(parseYouTubeVideoId('https://vimeo.com/12345')).toBeNull()
    expect(parseYouTubeVideoId(`https://example.com/watch?v=${ID}`)).toBeNull()
    // Sósia de host: só igualdade exata passa, nunca sufixo.
    expect(parseYouTubeVideoId(`https://youtube.com.evil.com/watch?v=${ID}`)).toBeNull()
    expect(parseYouTubeVideoId('https://www.youtube.com/playlist?list=PLabc')).toBeNull()
    expect(parseYouTubeVideoId('https://www.youtube.com/@algumcanal')).toBeNull()
    expect(parseYouTubeVideoId('não é link nenhum')).toBeNull()
  })

  it('recusa id de tamanho errado', () => {
    expect(parseYouTubeVideoId('abc')).toBeNull()
    expect(parseYouTubeVideoId(`https://youtu.be/${ID}extra`)).toBeNull()
  })
})

describe('parseYouTubePlaylistId', () => {
  it('lê playlist normal, de álbum e de canal', () => {
    expect(parseYouTubePlaylistId(`https://www.youtube.com/watch?v=${ID}&list=PLabcdefghijkl`)).toBe('PLabcdefghijkl')
    expect(parseYouTubePlaylistId('https://www.youtube.com/playlist?list=PLabcdefghijkl')).toBe('PLabcdefghijkl')
    expect(parseYouTubePlaylistId(`https://youtu.be/${ID}?list=OLAK5uy_abcdefghijkl`)).toBe('OLAK5uy_abcdefghijkl')
    expect(parseYouTubePlaylistId('https://www.youtube.com/playlist?list=UUabcdefghijkl')).toBe('UUabcdefghijkl')
    expect(parseYouTubePlaylistId('https://www.youtube.com/playlist?list=RDCLAK5uy_abcdefghijkl')).toBe(
      'RDCLAK5uy_abcdefghijkl',
    )
  })

  it('recusa mix, listas privadas e link sem playlist', () => {
    // O "Mix" que o YouTube gera sozinho não abre em embed — cai pro vídeo.
    expect(parseYouTubePlaylistId(`https://www.youtube.com/watch?v=${ID}&list=RD${ID}&start_radio=1`)).toBeNull()
    expect(parseYouTubePlaylistId(`https://www.youtube.com/watch?v=${ID}&list=WL`)).toBeNull()
    expect(parseYouTubePlaylistId(`https://www.youtube.com/watch?v=${ID}&list=LL`)).toBeNull()
    expect(parseYouTubePlaylistId(`https://www.youtube.com/watch?v=${ID}`)).toBeNull()
    expect(parseYouTubePlaylistId('https://vimeo.com/12345?list=PLabcdefghijkl')).toBeNull()
    expect(parseYouTubePlaylistId('não é link nenhum')).toBeNull()
  })

  it('aceita o id cru — é o que o cliente manda ao hub', () => {
    expect(parseYouTubePlaylistId('PLabcdefghijkl')).toBe('PLabcdefghijkl')
    expect(parseYouTubePlaylistId('OLAK5uy_abcdefghijkl')).toBe('OLAK5uy_abcdefghijkl')
    // Mix e lista privada continuam recusados, venham como id ou como link.
    expect(parseYouTubePlaylistId(`RD${ID}xxxxx`)).toBeNull()
    expect(parseYouTubePlaylistId('WL')).toBeNull()
    expect(parseYouTubePlaylistId('naoehplaylist')).toBeNull()
  })

  it('o vídeo do link continua sendo lido junto com a playlist', () => {
    const url = `https://www.youtube.com/watch?v=${ID}&list=PLabcdefghijkl&index=3`
    expect(parseYouTubeVideoId(url)).toBe(ID)
    expect(parseYouTubePlaylistId(url)).toBe('PLabcdefghijkl')
  })
})

describe('toVideoEmbedUrl continua respondendo o mesmo', () => {
  it('mantém as conversões que o player de aula depende', () => {
    expect(toVideoEmbedUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(`https://www.youtube.com/embed/${ID}`)
    expect(toVideoEmbedUrl(`https://youtu.be/${ID}?t=90`)).toBe(`https://www.youtube.com/embed/${ID}?start=90`)
    expect(toVideoEmbedUrl('https://vimeo.com/12345')).toBe('https://player.vimeo.com/video/12345')
  })
})
