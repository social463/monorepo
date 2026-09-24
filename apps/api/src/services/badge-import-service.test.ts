import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma'
import {
  BadgeImportError,
  buildBadgeImportTemplate,
  commitBadgeImport,
  exportBadgesCsv,
  previewBadgeImport,
} from './badge-import-service'

/**
 * Documento 4, seção 11.5: a G&G já mantém os selos numa planilha, e o
 * cadastro era um por um.
 */

const COMPANY = 'company-emr'
const ATOR = { id: 'ator', companyId: COMPANY }

const CABECALHO = 'Nome;Descrição;Tipo;Tema;Ícone;Limiar;Categoria de reconhecimento;Pontos;EMR Coins'

function planilha(...linhas: string[]): Buffer {
  return Buffer.from(`﻿${[CABECALHO, ...linhas].join('\r\n')}\r\n`, 'utf8')
}

async function tema(nome: string, slug: string) {
  return prisma.badgeCategory.create({ data: { name: nome, slug, companyId: COMPANY } })
}

async function ator() {
  const user = await prisma.user.create({
    data: { name: 'G&G', email: `gg-${Math.random()}@empresa.com`, passwordHash: 'x' },
  })
  return { id: user.id, companyId: COMPANY }
}

describe('template', () => {
  it('sai com ; e BOM — é o que o Excel em pt-BR abre sem assistente', () => {
    const csv = buildBadgeImportTemplate()
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.replace('\ufeff', '').split('\r\n')[0]).toBe(CABECALHO)
  })
})

describe('previewBadgeImport', () => {
  it('linha nova é CREATE e não grava nada', async () => {
    await tema('Feedback', 'feedback')
    const preview = await previewBadgeImport(ATOR, planilha('Voz que constrói;Deu dez feedbacks.;Por impacto;Feedback;star;10;;50;20'))

    expect(preview.counts.CREATE).toBe(1)
    expect(preview.blocked).toBe(false)
    expect(await prisma.badge.count()).toBe(0)
  })

  it('slug que já existe vira UPDATE, com a lista do que muda', async () => {
    await prisma.badge.create({
      data: { slug: 'voz-que-constroi', name: 'Voz que constrói', description: 'Antiga.', kind: 'IMPACT', iconKey: 'star', threshold: 5, companyId: COMPANY },
    })

    const preview = await previewBadgeImport(ATOR, planilha('Voz que constrói;Nova descrição.;Por impacto;;star;10;;;'))

    expect(preview.counts.UPDATE).toBe(1)
    expect(preview.rows[0].changes).toContain('descrição')
    expect(preview.rows[0].changes.some((c) => c.startsWith('limiar'))).toBe(true)
  })

  it('reimportar o mesmo arquivo é UNCHANGED — é o que prova que não duplica', async () => {
    const arquivo = planilha('Voz que constrói;Deu dez feedbacks.;Por impacto;;star;10;;50;20')
    const primeiro = await previewBadgeImport(ATOR, arquivo)
    await commitBadgeImport(await ator(), arquivo, primeiro.fileHash)

    const segundo = await previewBadgeImport(ATOR, arquivo)
    expect(segundo.counts.UNCHANGED).toBe(1)
    expect(segundo.counts.UPDATE).toBe(0)
  })

  it('tema desconhecido é erro da linha, e não tema criado em silêncio', async () => {
    const preview = await previewBadgeImport(ATOR, planilha('Selo X;Descrição.;Por impacto;Inexistente;star;1;;;'))

    expect(preview.blocked).toBe(true)
    expect(preview.rows[0].issues[0].column).toBe('Tema')
    expect(await prisma.badgeCategory.count()).toBe(0)
  })

  it('tipo desconhecido trava a linha', async () => {
    const preview = await previewBadgeImport(ATOR, planilha('Selo X;Descrição.;Tipo inventado;;star;1;;;'))
    expect(preview.rows[0].issues[0].column).toBe('Tipo')
  })

  it('categoria de reconhecimento só vale no tipo "Por categoria"', async () => {
    await prisma.recognitionCategory.create({
      data: { name: 'Colaboração', slug: 'colaboracao', companyId: COMPANY },
    })

    const errado = await previewBadgeImport(ATOR, planilha('Selo X;Descrição.;Por impacto;;star;1;colaboracao;;'))
    expect(errado.rows[0].issues[0].column).toBe('Categoria de reconhecimento')

    // "Por categoria" é o rótulo LONGO da tela do admin; o canônico é
    // "Categoria". Os dois entram — quem copia da tela escreve o longo.
    const certo = await previewBadgeImport(ATOR, planilha('Selo Y;Descrição.;Por categoria;;star;1;colaboracao;;'))
    expect(certo.blocked).toBe(false)
  })

  it('recompensa não numérica trava a linha', async () => {
    const preview = await previewBadgeImport(ATOR, planilha('Selo X;Descrição.;Por impacto;;star;1;;muitos;'))
    expect(preview.rows[0].issues[0].column).toBe('Pontos')
  })

  it('o mesmo selo duas vezes no arquivo trava', async () => {
    const preview = await previewBadgeImport(
      ATOR,
      planilha('Selo X;A.;Por impacto;;star;1;;;', 'Selo X;B.;Por impacto;;star;2;;;'),
    )
    expect(preview.blocked).toBe(true)
  })

  it('planilha sem coluna obrigatória é 400, com instrução de baixar o modelo', async () => {
    const semTipo = Buffer.from('﻿Nome;Descrição\r\nSelo X;Descrição.\r\n', 'utf8')
    await expect(previewBadgeImport(ATOR, semTipo)).rejects.toThrow(/Baixe o modelo/)
  })

  it('coluna fora do modelo vira aviso, não erro', async () => {
    const arquivo = Buffer.from(`﻿${CABECALHO};Responsável\r\nSelo X;Descrição.;Por impacto;;star;1;;;;Ana\r\n`, 'utf8')
    const preview = await previewBadgeImport(ATOR, arquivo)

    expect(preview.blocked).toBe(false)
    expect(preview.warnings.join(' ')).toMatch(/Responsável/)
  })
})

describe('commitBadgeImport', () => {
  it('cria e atualiza pelo slug', async () => {
    const feedback = await tema('Feedback', 'feedback')
    await prisma.badge.create({
      data: { slug: 'selo-antigo', name: 'Selo antigo', description: 'Antiga.', kind: 'IMPACT', iconKey: 'star', companyId: COMPANY },
    })

    const arquivo = planilha(
      'Selo antigo;Descrição nova.;Por impacto;Feedback;fire;3;;10;5',
      'Selo novo;Nasce aqui.;Tempo de casa;;;2;;;',
    )
    const preview = await previewBadgeImport(ATOR, arquivo)
    const resultado = await commitBadgeImport(await ator(), arquivo, preview.fileHash)

    expect(resultado).toMatchObject({ created: 1, updated: 1, unchanged: 0 })

    const antigo = await prisma.badge.findFirstOrThrow({ where: { slug: 'selo-antigo' } })
    expect(antigo.description).toBe('Descrição nova.')
    expect(antigo.badgeCategoryId).toBe(feedback.id)
    expect(antigo.rewardPoints).toBe(10)
    expect(antigo.rewardCoins).toBe(5)

    // Ícone vazio na planilha cai no padrão ao criar — a coluna é opcional e a
    // planilha da G&G não a tinha.
    const novo = await prisma.badge.findFirstOrThrow({ where: { slug: 'selo-novo' } })
    expect(novo.iconKey).toBe('trophy')
    expect(novo.kind).toBe('TENURE')
  })

  it('ícone vazio numa atualização NÃO apaga o que já está cadastrado', async () => {
    await prisma.badge.create({
      data: { slug: 'com-icone', name: 'Com ícone', description: 'd', kind: 'IMPACT', iconKey: 'fire', companyId: COMPANY },
    })

    const arquivo = planilha('Com ícone;Outra descrição.;Por impacto;;;1;;;')
    const preview = await previewBadgeImport(ATOR, arquivo)
    await commitBadgeImport(await ator(), arquivo, preview.fileHash)

    expect((await prisma.badge.findFirstOrThrow({ where: { slug: 'com-icone' } })).iconKey).toBe('fire')
  })

  it('arquivo diferente do previsto é 409', async () => {
    const arquivo = planilha('Selo X;Descrição.;Por impacto;;star;1;;;')
    await expect(commitBadgeImport(ATOR, arquivo, 'f'.repeat(64))).rejects.toThrow(BadgeImportError)
  })

  it('linha com erro trava o arquivo inteiro — nada é criado', async () => {
    const arquivo = planilha('Bom;Descrição.;Por impacto;;star;1;;;', 'Ruim;Descrição.;Tipo inventado;;star;1;;;')
    const preview = await previewBadgeImport(ATOR, arquivo)

    await expect(commitBadgeImport(ATOR, arquivo, preview.fileHash)).rejects.toThrow(/Nada foi criado/)
    expect(await prisma.badge.count()).toBe(0)
  })
})

describe('exportBadgesCsv', () => {
  it('sai com as MESMAS colunas do template — é o que fecha o ciclo', async () => {
    const feedback = await tema('Feedback', 'feedback')
    await prisma.badge.create({
      data: {
        slug: 'exportavel',
        name: 'Exportável',
        description: 'Descrição.',
        kind: 'IMPACT',
        iconKey: 'star',
        threshold: 4,
        badgeCategoryId: feedback.id,
        rewardPoints: 10,
        rewardCoins: null,
        companyId: COMPANY,
      },
    })

    const { csv, fileName } = await exportBadgesCsv(COMPANY)
    const [header, linha] = csv.replace('﻿', '').split('\r\n')

    expect(fileName).toBe('selos.csv')
    expect(header).toBe(CABECALHO)
    expect(linha).toBe('Exportável;Descrição.;Impacto;Feedback;star;4;;10;')
  })

  it('o que sai do export volta pelo import sem mudar nada', async () => {
    await tema('Cultura', 'cultura')
    await prisma.badge.create({
      data: { slug: 'ida-e-volta', name: 'Ida e volta', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 3, companyId: COMPANY },
    })

    const { csv } = await exportBadgesCsv(COMPANY)
    const preview = await previewBadgeImport(ATOR, Buffer.from(csv, 'utf8'))

    expect(preview.counts.UNCHANGED).toBe(1)
    expect(preview.blocked).toBe(false)
  })
})
