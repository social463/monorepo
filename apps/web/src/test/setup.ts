import '@testing-library/jest-dom'

// Node pode expor um `localStorage` experimental sem implementação quando o
// processo não recebe `--localstorage-file`, sobrescrevendo o Storage do jsdom.
// Mantém os testes determinísticos com a mesma interface síncrona do browser.
if (!globalThis.localStorage) {
  class MemoryStorage implements Storage {
    private values = new Map<string, string>()

    get length() {
      return this.values.size
    }

    clear() {
      this.values.clear()
    }

    getItem(key: string) {
      return this.values.get(key) ?? null
    }

    key(index: number) {
      return Array.from(this.values.keys())[index] ?? null
    }

    removeItem(key: string) {
      this.values.delete(key)
    }

    setItem(key: string, value: string) {
      this.values.set(key, String(value))
    }
  }

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })
}

// jsdom não implementa IntersectionObserver; stub para evitar crash nos testes.
class _IO {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}
globalThis.IntersectionObserver = (globalThis.IntersectionObserver ?? _IO) as typeof IntersectionObserver

// jsdom não implementa ResizeObserver; stub para evitar crash nos testes. Sem ele o
// ArenaPlayground estourava dentro do efeito assíncrono que monta a cena — rejeição
// sem dono, que o Vitest conta como erro e cobra no código de saída.
class _RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = (globalThis.ResizeObserver ?? _RO) as typeof ResizeObserver

// jsdom não implementa PointerEvent; stub baseado em MouseEvent pra fireEvent.pointerDown/Move/Up
// preservarem pointerId/clientX/clientY (ver @testing-library/dom/dist/events.js: cai pro Event
// genérico sem isso, que descarta essas propriedades).
class _PointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params)
    this.pointerId = params.pointerId ?? 0
  }
}
globalThis.PointerEvent = (globalThis.PointerEvent ?? _PointerEvent) as typeof PointerEvent
