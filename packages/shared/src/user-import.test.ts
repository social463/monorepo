import { describe, it, expect } from 'vitest'
import { USER_ROLES } from './enums'
import {
  USER_IMPORT_COLUMNS,
  USER_IMPORT_COLUMN_ALIASES,
  USER_IMPORT_IGNORED_COLUMNS,
  USER_IMPORT_REQUIRED_COLUMNS,
  USER_IMPORT_ROLES,
  USER_IMPORT_ROW_ACTIONS,
  USER_IMPORT_ROW_ACTION_LABELS,
  USER_IMPORT_TEMPLATE_EXAMPLE,
} from './user-import'

/** Mesma normalização que o parser aplica no cabeçalho. */
function flatten(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

describe('contrato de importação de colaboradores', () => {
  it('tem uma célula de exemplo para cada coluna', () => {
    expect(USER_IMPORT_TEMPLATE_EXAMPLE).toHaveLength(USER_IMPORT_COLUMNS.length)
  })

  it('só exige colunas que existem no template', () => {
    for (const column of USER_IMPORT_REQUIRED_COLUMNS) {
      expect(USER_IMPORT_COLUMNS).toContain(column)
    }
  })

  it('não repete coluna no template', () => {
    expect(new Set(USER_IMPORT_COLUMNS).size).toBe(USER_IMPORT_COLUMNS.length)
  })

  it('tem lista de aliases para toda coluna', () => {
    expect(Object.keys(USER_IMPORT_COLUMN_ALIASES).sort()).toEqual([...USER_IMPORT_COLUMNS].sort())
  })

  it('não deixa dois cabeçalhos diferentes casarem com a mesma coluna', () => {
    // Se um alias colidisse com outra coluna (ou com o nome canônico dela), o
    // parser teria que escolher no par ou ímpar — e escolheria errado.
    const seen = new Map<string, string>()
    for (const column of USER_IMPORT_COLUMNS) {
      for (const candidate of [column, ...USER_IMPORT_COLUMN_ALIASES[column]]) {
        const key = flatten(candidate)
        expect(seen.has(key), `"${candidate}" casa com "${column}" e com "${seen.get(key)}"`).toBe(false)
        seen.set(key, column)
      }
    }
    for (const ignored of USER_IMPORT_IGNORED_COLUMNS) {
      expect(seen.has(flatten(ignored))).toBe(false)
    }
  })

  it('não permite papel administrativo pela planilha', () => {
    for (const role of USER_IMPORT_ROLES) {
      expect(USER_ROLES).toContain(role)
    }
    for (const forbidden of ['ADMIN', 'SUBADMIN', 'SUPER_ADMIN', 'THIRD_PARTY']) {
      expect(USER_IMPORT_ROLES as readonly string[]).not.toContain(forbidden)
    }
  })

  it('rotula toda ação de linha', () => {
    expect(Object.keys(USER_IMPORT_ROW_ACTION_LABELS).sort()).toEqual([...USER_IMPORT_ROW_ACTIONS].sort())
  })
})
