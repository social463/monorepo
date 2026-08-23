import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { addTopic, createSeries, deleteTopic, getMeeting, saveNote, updateTopic } from './one-on-one-service'

async function makeUser(name: string) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@empresa.com`, passwordHash: 'x', companyId: DEFAULT_COMPANY_ID },
  })
}
const viewerOf = (user: { id: string }) => ({ userId: user.id, companyId: DEFAULT_COMPANY_ID })

async function umEncontro() {
  const ana = await makeUser('Ana')
  const bruno = await makeUser('Bruno')
  const { meetings } = await createSeries(viewerOf(ana), {
    counterpartId: bruno.id,
    date: '2026-08-10',
    startTime: '10:00',
    durationMinutes: 30,
    recurrence: 'NONE',
  })
  return { ana, bruno, meetingId: meetings[0].id }
}

describe('one-on-one — pauta', () => {
  it('os dois lados adicionam tópico e os dois enxergam', async () => {
    const { ana, bruno, meetingId } = await umEncontro()
    await addTopic(viewerOf(ana), meetingId, { text: 'Carreira', origin: 'CUSTOM' })
    await addTopic(viewerOf(bruno), meetingId, { text: 'Bloqueios', origin: 'TEMPLATE' })

    const detalhe = await getMeeting(viewerOf(ana), meetingId)
    expect(detalhe.topics.map((t) => t.text)).toEqual(['Carreira', 'Bloqueios'])
    expect(detalhe.topics[1].origin).toBe('TEMPLATE')
  })

  it('marca tópico como discutido', async () => {
    const { ana, meetingId } = await umEncontro()
    const topico = await addTopic(viewerOf(ana), meetingId, { text: 'Carreira', origin: 'CUSTOM' })

    const atualizado = await updateTopic(viewerOf(ana), topico.id, { discussed: true })
    expect(atualizado.discussed).toBe(true)
  })

  it('remove tópico', async () => {
    const { ana, meetingId } = await umEncontro()
    const topico = await addTopic(viewerOf(ana), meetingId, { text: 'Sai', origin: 'CUSTOM' })

    await deleteTopic(viewerOf(ana), topico.id)
    expect((await getMeeting(viewerOf(ana), meetingId)).topics).toEqual([])
  })

  it('terceiro não mexe na pauta', async () => {
    const { meetingId } = await umEncontro()
    const carla = await makeUser('Carla')

    await expect(
      addTopic(viewerOf(carla), meetingId, { text: 'Xereta', origin: 'CUSTOM' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('one-on-one — observação privada', () => {
  it('cada pessoa lê só a própria nota', async () => {
    const { ana, bruno, meetingId } = await umEncontro()
    await saveNote(viewerOf(ana), meetingId, 'Preciso falar de salário')
    await saveNote(viewerOf(bruno), meetingId, 'Notas do líder')

    expect((await getMeeting(viewerOf(ana), meetingId)).note).toBe('Preciso falar de salário')
    expect((await getMeeting(viewerOf(bruno), meetingId)).note).toBe('Notas do líder')
  })

  it('salvar de novo sobrescreve a própria nota, sem criar outra linha', async () => {
    const { ana, meetingId } = await umEncontro()
    await saveNote(viewerOf(ana), meetingId, 'primeira')
    await saveNote(viewerOf(ana), meetingId, 'segunda')

    expect((await getMeeting(viewerOf(ana), meetingId)).note).toBe('segunda')
    expect(await prisma.oneOnOnePrivateNote.count({ where: { meetingId } })).toBe(1)
  })

  it('nota vazia apaga a nota', async () => {
    const { ana, meetingId } = await umEncontro()
    await saveNote(viewerOf(ana), meetingId, 'algo')
    await saveNote(viewerOf(ana), meetingId, '   ')

    expect((await getMeeting(viewerOf(ana), meetingId)).note).toBeNull()
  })

  it('terceiro não escreve nota no 1:1 dos outros', async () => {
    const { meetingId } = await umEncontro()
    const carla = await makeUser('Carla')
    await expect(saveNote(viewerOf(carla), meetingId, 'oi')).rejects.toMatchObject({ status: 404 })
  })
})
