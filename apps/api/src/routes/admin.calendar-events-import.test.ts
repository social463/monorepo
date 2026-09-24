import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { CALENDAR_IMPORT_COLUMNS, CALENDAR_IMPORT_MAX_ROWS } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { parseCsvTable } from '../lib/csv-parse'

const HEADER = CALENDAR_IMPORT_COLUMNS.join(';')
const BOUNDARY = 'legends-calendar-import-boundary'

function spreadsheet(...lines: string[]): Buffer {
  return Buffer.from(`﻿${[HEADER, ...lines].join('\r\n')}\r\n`, 'utf8')
}

/** Monta o corpo multipart na mão, como o teste da importação de lendas já faz. */
function multipart(content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="calendario.csv"\r\nContent-Type: text/csv\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ])
}

function uploadHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }
}

async function tokenFor(app: ReturnType<typeof buildApp>, role: 'ADMIN' | 'LEGEND') {
  const email = `${role.toLowerCase()}@empresa.com`
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: role, email, password: 'changeme123' } })
  await prisma.user.update({ where: { email }, data: { role } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

/** O catálogo padrão é semeado por migration e some no truncate de cada teste. */
async function tipo(name: string, slug: string) {
  return prisma.calendarEventType.create({ data: { name, slug, icon: 'event', color: '#ec4899' } })
}

function preview(app: ReturnType<typeof buildApp>, token: string, content: Buffer) {
  return app.inject({
    method: 'POST',
    url: '/admin/calendar-events/import/preview',
    headers: uploadHeaders(token),
    payload: multipart(content),
  })
}

function commit(app: ReturnType<typeof buildApp>, token: string, content: Buffer, fileHash: string) {
  return app.inject({
    method: 'POST',
    url: `/admin/calendar-events/import/commit?fileHash=${fileHash}`,
    headers: uploadHeaders(token),
    payload: multipart(content),
  })
}

const LINHA_DIA_DOS_PAIS =
  'Agosto;Data Comemorativa;Dia dos Pais;09/08/2026;09/08/2026;Dia todo;Dia todo;Dia de celebrar;Todos'

describe('GET /admin/calendar-events/import/template', () => {
  it('devolve CSV com nome de arquivo, BOM e as colunas da planilha da G&G', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    const res = await app.inject({
      method: 'GET',
      url: '/admin/calendar-events/import/template',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('modelo-importacao-calendario.csv')
    expect(res.body.startsWith('﻿')).toBe(true)

    const table = parseCsvTable(Buffer.from(res.body, 'utf8'))
    expect(table.headers).toEqual([...CALENDAR_IMPORT_COLUMNS])
    expect(table.rows).toHaveLength(1)
    await app.close()
  })

  it('exige autenticação e o bloco de Desenvolvimento de Produto', async () => {
    const app = buildApp()
    await app.ready()
    expect((await app.inject({ method: 'GET', url: '/admin/calendar-events/import/template' })).statusCode).toBe(401)
    const token = await tokenFor(app, 'LEGEND')
    const res = await app.inject({
      method: 'GET',
      url: '/admin/calendar-events/import/template',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('POST /admin/calendar-events/import/preview', () => {
  it('lê a planilha da G&G sem gravar nada, e avisa das colunas derivadas', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await tipo('Data comemorativa', 'data-comemorativa')

    const res = await preview(app, token, spreadsheet(LINHA_DIA_DOS_PAIS))

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.counts.CREATE).toBe(1)
    expect(body.blocked).toBe(false)
    expect(body.fileHash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.rows[0]).toMatchObject({
      title: 'Dia dos Pais',
      tag: 'Data Comemorativa',
      typeName: 'Data comemorativa',
      date: '2026-08-09',
      endDate: null,
      timeLabel: 'Dia todo',
      typeIsNew: false,
      audienceTags: ['Todos'],
    })
    expect(body.warnings.join(' ')).toContain('"Mês"')
    expect(body.warnings.join(' ')).toContain('"Duração"')
    expect(await prisma.calendarEvent.count()).toBe(0)
    await app.close()
  })

  it('casa a categoria da planilha com a que já existe, pelo slug', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await tipo('Reunião', 'reuniao')

    const res = await preview(
      app,
      token,
      // Grafia diferente da cadastrada: o slug é o mesmo, então não nasce tipo novo.
      spreadsheet('Agosto;REUNIAO;Reunião Geral;28/08/2026;;2h30;14h-16h30;Alinhamento;Todos'),
    )

    const body = res.json()
    expect(body.plan.typesToCreate).toEqual([])
    expect(body.rows[0].typeIsNew).toBe(false)
    expect(body.rows[0].timeLabel).toBe('14:00–16:30')
    await app.close()
  })

  it('a Tag da planilha cai numa categoria do catálogo, e não vira categoria nova', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await tipo('Evento', 'evento')

    const res = await preview(
      app,
      token,
      spreadsheet('Setembro;Porta de Prova;Porta de Prova ENAMED;13/09/2026;;Dia todo;Dia todo;Ação nacional;Todos'),
    )

    const body = res.json()
    // "Porta de Prova" não vira categoria: é etiqueta, e a categoria é Evento.
    expect(body.plan.typesToCreate).toEqual([])
    expect(body.rows[0]).toMatchObject({ tag: 'Porta de Prova', typeName: 'Evento', typeIsNew: false })
    await app.close()
  })

  it('categoria do catálogo que a empresa apagou renasce com a cor do catálogo', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')

    const res = await preview(
      app,
      token,
      spreadsheet('Setembro;Simulado;Simulado Inspirali - UniBH;05/08/2026;;Dia todo;Dia todo;;Todos'),
    )

    const body = res.json()
    // Verde de `evento` no catálogo — e não o indigo de fallback, que era o que
    // deixava o calendário inteiro da mesma cor.
    expect(body.plan.typesToCreate).toEqual([{ name: 'Evento', color: '#10b981' }])
    expect(body.rows[0].typeIsNew).toBe(true)
    await app.close()
  })

  it('tag fora do vocabulário entra como Evento, com aviso', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await tipo('Evento', 'evento')

    const res = await preview(
      app,
      token,
      spreadsheet('Setembro;Hackathon;Hackathon EMR;13/09/2026;;Dia todo;Dia todo;;Todos'),
    )

    const body = res.json()
    expect(body.blocked).toBe(false)
    expect(body.rows[0]).toMatchObject({ tag: 'Hackathon', typeName: 'Evento' })
    expect(body.warnings.join(' ')).toContain('"Hackathon"')
    await app.close()
  })

  it('trava o arquivo quando uma data ou um horário não é legível', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await tipo('Festa', 'festa')

    const res = await preview(
      app,
      token,
      spreadsheet(
        LINHA_DIA_DOS_PAIS,
        'Dezembro;Festa;Festa de Final de Ano;Sexta (verificando);;2h;;Confraternização;Todos',
        'Junho;Festa;Festa Junina;18/06/2026;;2h;a combinar;Arraiá;Todos',
      ),
    )

    const body = res.json()
    expect(body.blocked).toBe(true)
    expect(body.counts.ERROR).toBe(2)
    expect(body.rows[1].issues[0].column).toBe('Data de Início')
    expect(body.rows[2].issues[0].column).toBe('Horário')
    await app.close()
  })

  it('trava quando o mesmo evento aparece duas vezes na mesma data', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await tipo('Data comemorativa', 'data-comemorativa')

    const res = await preview(app, token, spreadsheet(LINHA_DIA_DOS_PAIS, LINHA_DIA_DOS_PAIS))

    const body = res.json()
    expect(body.blocked).toBe(true)
    expect(body.counts.ERROR).toBe(2)
    expect(body.rows[0].issues[0].message).toContain('mais de uma vez')
    await app.close()
  })

  it('recusa planilha sem as colunas obrigatórias', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')

    const res = await preview(app, token, Buffer.from('Mês;Descrição\r\nAgosto;nada\r\n', 'utf8'))

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('"Tag"')
    await app.close()
  })

  it('recusa planilha acima do teto de linhas', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    const linhas = Array.from(
      { length: CALENDAR_IMPORT_MAX_ROWS + 1 },
      (_, i) => `Agosto;Festa;Evento ${i};09/08/2026;;Dia todo;Dia todo;;Todos`,
    )

    const res = await preview(app, token, spreadsheet(...linhas))

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('o limite é')
    await app.close()
  })
})

describe('POST /admin/calendar-events/import/commit', () => {
  it('cria os eventos e as categorias que faltavam, e reimportar não duplica', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await tipo('Data comemorativa', 'data-comemorativa')
    const arquivo = spreadsheet(
      LINHA_DIA_DOS_PAIS,
      'Setembro;B2B;COBEM (POA);17/09/2026;20/09/2026;4 dias;Dia todo;Congresso;Parceiros de Negócio',
    )
    const { fileHash } = (await preview(app, token, arquivo)).json()

    const res = await commit(app, token, arquivo, fileHash)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ created: 2, updated: 0, unchanged: 0, typesCreated: ['Evento'] })

    const cobem = await prisma.calendarEvent.findFirstOrThrow({
      where: { title: 'COBEM (POA)' },
      include: { type: true },
    })
    // A Tag vira etiqueta; a cor e o filtro continuam vindo da categoria.
    expect(cobem.tag).toBe('B2B')
    expect(cobem.type.slug).toBe('evento')
    expect(cobem.date.toISOString().slice(0, 10)).toBe('2026-09-17')
    expect(cobem.endDate?.toISOString().slice(0, 10)).toBe('2026-09-20')
    expect(cobem.startTime).toBeNull()
    expect(cobem.audienceTags).toEqual(['Parceiros de Negócio'])

    // Segunda passada com o mesmo arquivo: nada muda, nada duplica.
    const segundo = await preview(app, token, arquivo)
    expect(segundo.json().counts.UNCHANGED).toBe(2)
    const depois = await commit(app, token, arquivo, segundo.json().fileHash)
    expect(depois.json()).toMatchObject({ created: 0, updated: 0, unchanged: 2 })
    expect(await prisma.calendarEvent.count()).toBe(2)
    await app.close()
  })

  it('atualiza o que a planilha traz e preserva o que ela não tem', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await tipo('Data comemorativa', 'data-comemorativa')
    const original = spreadsheet(LINHA_DIA_DOS_PAIS)
    await commit(app, token, original, (await preview(app, token, original)).json().fileHash)

    // Lembrete e recorrência não existem na planilha: quem os configurou na tela
    // não pode perdê-los por causa de uma reimportação.
    await prisma.calendarEvent.updateMany({
      where: { title: 'Dia dos Pais' },
      data: { reminderDaysBefore: [1, 7], recurrence: 'YEARLY', isInternalComm: true },
    })

    const corrigido = spreadsheet(
      'Agosto;Data Comemorativa;Dia dos Pais;09/08/2026;09/08/2026;1h;14h-15h30;Ação especial no escritório;Pai, G&G',
    )
    const diagnostico = (await preview(app, token, corrigido)).json()
    expect(diagnostico.counts.UPDATE).toBe(1)
    expect(diagnostico.rows[0].changes).toEqual(['Descrição', 'Horário', 'Público-alvo'])

    const res = await commit(app, token, corrigido, diagnostico.fileHash)
    expect(res.json()).toMatchObject({ created: 0, updated: 1 })

    const evento = await prisma.calendarEvent.findFirstOrThrow({ where: { title: 'Dia dos Pais' } })
    expect(evento.startTime).toBe('14:00')
    expect(evento.endTime).toBe('15:30')
    expect(evento.description).toBe('Ação especial no escritório')
    expect(evento.audienceTags).toEqual(['Pai', 'G&G'])
    expect(evento.reminderDaysBefore).toEqual([1, 7])
    expect(evento.recurrence).toBe('YEARLY')
    expect(evento.isInternalComm).toBe(true)
    expect(await prisma.calendarEvent.count()).toBe(1)
    await app.close()
  })

  it('não grava nada quando o arquivo tem linha com erro', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    const arquivo = spreadsheet(LINHA_DIA_DOS_PAIS, 'Dezembro;Festa;Festa;Sexta;;2h;;;Todos')
    const { fileHash } = (await preview(app, token, arquivo)).json()

    const res = await commit(app, token, arquivo, fileHash)

    expect(res.statusCode).toBe(422)
    expect(res.json().issues.length).toBeGreaterThan(0)
    expect(await prisma.calendarEvent.count()).toBe(0)
    expect(await prisma.calendarEventType.count()).toBe(0)
    await app.close()
  })

  it('recusa quando o arquivo mudou depois da pré-visualização', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await tipo('Data comemorativa', 'data-comemorativa')

    const res = await commit(app, token, spreadsheet(LINHA_DIA_DOS_PAIS), 'a'.repeat(64))

    expect(res.statusCode).toBe(409)
    expect(await prisma.calendarEvent.count()).toBe(0)
    await app.close()
  })

  it('registra a importação e cada evento na auditoria', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await tipo('Data comemorativa', 'data-comemorativa')
    const arquivo = spreadsheet(LINHA_DIA_DOS_PAIS)

    await commit(app, token, arquivo, (await preview(app, token, arquivo)).json().fileHash)

    const tipos = await prisma.adminAuditLog.groupBy({ by: ['entityType'], _count: true })
    const contagem = Object.fromEntries(tipos.map((linha) => [linha.entityType, linha._count]))
    expect(contagem.CalendarEvent).toBe(1)
    expect(contagem.CalendarEventImport).toBe(1)
    await app.close()
  })
})

describe('a planilha do Calendário Endomarketing 2026', () => {
  it('entra inteira, e reimportar não duplica', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    // O arquivo versionado é o mesmo que o script `import-calendar-events.ts`
    // carrega: se a planilha da G&G mudar de formato, é aqui que quebra.
    const arquivo = readFileSync(resolve(__dirname, '../../scripts/data/calendario-endomarketing-2026.csv'))

    const diagnostico = (await preview(app, token, arquivo)).json()
    expect(diagnostico.blocked).toBe(false)
    expect(diagnostico.counts.CREATE).toBe(diagnostico.totalRows)

    const res = await commit(app, token, arquivo, diagnostico.fileHash)
    expect(res.statusCode).toBe(200)
    expect(res.json().created).toBe(diagnostico.totalRows)
    expect(await prisma.calendarEvent.count()).toBe(diagnostico.totalRows)

    const segundo = (await preview(app, token, arquivo)).json()
    expect(segundo.counts.UNCHANGED).toBe(segundo.totalRows)

    // O que motivou tudo isto: as 25 tags da planilha caem nas categorias do
    // catálogo, cada uma com a sua cor. Uma categoria por tag deixava os 135
    // eventos com a mesma cor de fallback.
    const porCategoria = await prisma.calendarEvent.groupBy({ by: ['typeId'], _count: true })
    expect(porCategoria.length).toBeGreaterThan(5)
    const cores = await prisma.calendarEventType.findMany({ select: { color: true } })
    expect(new Set(cores.map((tipo) => tipo.color)).size).toBe(cores.length)
    expect(await prisma.calendarEvent.count({ where: { tag: null } })).toBe(0)
    await app.close()
  })
})
