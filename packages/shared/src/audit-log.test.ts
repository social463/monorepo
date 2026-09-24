import { describe, expect, it } from 'vitest'
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_ACTION_LABELS,
  auditChangedFields,
  auditEntityLabel,
  auditFieldLabel,
  auditSubjectName,
} from './audit-log'

describe('ADMIN_AUDIT_ACTION_LABELS', () => {
  it('cobre todas as ações', () => {
    for (const action of ADMIN_AUDIT_ACTIONS) {
      expect(ADMIN_AUDIT_ACTION_LABELS[action]).toBeTruthy()
    }
  })
})

describe('auditEntityLabel', () => {
  it('traduz o nome do model', () => {
    expect(auditEntityLabel('User')).toBe('Colaborador')
    expect(auditEntityLabel('OfficeMapPublication')).toBe('Publicação de mapa')
  })

  // Tipo novo auditado antes de ganhar rótulo tem que degradar, não sumir.
  it('cai no próprio nome quando não há rótulo', () => {
    expect(auditEntityLabel('EntidadeQueAindaNaoExiste')).toBe('EntidadeQueAindaNaoExiste')
  })
})

describe('auditSubjectName', () => {
  it('acha o nome do alvo no payload', () => {
    expect(auditSubjectName({ before: null, after: { name: 'Lucca Secco' } })).toBe('Lucca Secco')
  })

  // Numa edição, o estado final é o que a pessoa quis — e é o que identifica a
  // linha depois de uma renomeação.
  it('prefere o depois ao antes', () => {
    expect(auditSubjectName({ before: { name: 'Nome velho' }, after: { name: 'Nome novo' } })).toBe('Nome novo')
  })

  it('usa o antes quando não há depois (exclusão)', () => {
    expect(auditSubjectName({ before: { name: 'Categoria apagada' }, after: null })).toBe('Categoria apagada')
  })

  it('cai para outros campos legíveis quando não há nome', () => {
    expect(auditSubjectName({ before: null, after: { title: 'Curso de Go' } })).toBe('Curso de Go')
    expect(auditSubjectName({ before: null, after: { email: 'ana@x.com' } })).toBe('ana@x.com')
  })

  it('devolve null quando não há nada legível', () => {
    expect(auditSubjectName({ before: null, after: { revision: 3 } })).toBeNull()
    expect(auditSubjectName({ before: null, after: null })).toBeNull()
    expect(auditSubjectName({ before: 'texto', after: 42 })).toBeNull()
  })

  it('ignora string vazia ou só espaços', () => {
    expect(auditSubjectName({ before: null, after: { name: '   ', title: 'Vale este' } })).toBe('Vale este')
  })

  // `subject` é o rótulo que um service escreve de propósito (ex.: recorte do
  // texto de um comunicado sem título) — vence qualquer outro campo homônimo.
  it('prioriza subject sobre os demais campos', () => {
    expect(auditSubjectName({ before: null, after: { subject: 'Recorte do texto', title: 'outro' } })).toBe(
      'Recorte do texto',
    )
  })
})

describe('auditChangedFields', () => {
  it('lista só o que mudou', () => {
    const before = { name: 'Ana', role: 'LEGEND', position: 'Dev' }
    const after = { name: 'Ana', role: 'LEAD', position: 'Dev' }
    expect(auditChangedFields(before, after)).toEqual(['role'])
  })

  // Sem isso, toda edição listaria "updatedAt" junto do que importa.
  it('descarta os campos que mudam sozinhos', () => {
    const before = { adminAccess: false, updatedAt: '2026-08-15T00:00:00Z', id: 'u1' }
    const after = { adminAccess: true, updatedAt: '2026-08-15T12:00:00Z', id: 'u1' }
    expect(auditChangedFields(before, after)).toEqual(['adminAccess'])
  })

  it('compara valor, não referência', () => {
    expect(auditChangedFields({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toEqual([])
    expect(auditChangedFields({ tags: ['a'] }, { tags: ['a', 'b'] })).toEqual(['tags'])
  })

  it('é vazio para criação e exclusão', () => {
    expect(auditChangedFields(null, { name: 'Nova' })).toEqual([])
    expect(auditChangedFields({ name: 'Antiga' }, null)).toEqual([])
  })
})

describe('auditFieldLabel', () => {
  it('traduz os campos conhecidos', () => {
    expect(auditFieldLabel('adminAccess')).toBe('acesso administrativo')
    expect(auditFieldLabel('role')).toBe('papel')
  })

  it('cai no próprio nome quando não há rótulo', () => {
    expect(auditFieldLabel('campoNovo')).toBe('campoNovo')
  })
})
