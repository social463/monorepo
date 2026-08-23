# PWA do Escritório Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o Legends instalável como PWA, com o atalho abrindo direto em `/escritorio`.

**Architecture:** Service worker mínimo (sem cache, só para satisfazer o critério de instalabilidade dos navegadores) registrado no boot do app, mais ajustes no `site.webmanifest` existente (`start_url`, `scope`, `id`) apontando para a rota do Escritório.

**Tech Stack:** Vite + React (sem plugin de PWA — implementação manual, service worker vanilla).

## Global Constraints

- Sem estratégia de cache/offline: o service worker não deve interceptar `fetch` nem cachear API/assets (spec: "Fora de escopo: funcionamento offline").
- Reaproveitar nome/ícones atuais do manifest (`Legends`, `favicon-192.png`, `favicon-512.png`) — nada de ícone/nome dedicados ao Escritório.
- `scope` do manifest deve continuar `/` (app instalado navega para o resto do Legends normalmente; só o `start_url` do atalho muda).

---

### Task 1: Service worker mínimo + registro

**Files:**
- Create: `apps/web/public/sw.js`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Não expõe nenhuma função/tipo consumido por outras tasks — é infraestrutura de browser, sem interface de código.

- [ ] **Step 1: Criar o service worker**

Criar `apps/web/public/sw.js` com o conteúdo exato:

```js
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
```

Sem listener de `fetch` — nenhuma requisição é interceptada.

- [ ] **Step 2: Registrar o service worker no boot do app**

Editar `apps/web/src/main.tsx`, adicionando o registro após a chamada de `render`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
  })
}
```

- [ ] **Step 3: Validar manualmente com o dev server**

Rodar:
```bash
pnpm --filter @legends/web dev
```

Abrir `http://localhost:5173` no Chrome, abrir DevTools → Application →
Service Workers, e confirmar que `sw.js` aparece com status "activated and is running".
Não há teste automatizado aqui — `navigator.serviceWorker` não existe em jsdom
(ver spec, seção Testes).

- [ ] **Step 4: Commit**

```bash
git add apps/web/public/sw.js apps/web/src/main.tsx
git commit -m "feat: registra service worker mínimo para instalabilidade do PWA"
```

---

### Task 2: Apontar o manifest para o Escritório

**Files:**
- Modify: `apps/web/public/site.webmanifest`

**Interfaces:**
- Consome: nada de tasks anteriores.
- Produz: nada consumido por outras tasks — é a última task do plano.

- [ ] **Step 1: Atualizar o manifest**

Editar `apps/web/public/site.webmanifest` para o conteúdo exato:

```json
{
  "id": "/escritorio",
  "name": "Legends",
  "short_name": "Legends",
  "start_url": "/escritorio",
  "scope": "/",
  "icons": [
    { "src": "/favicon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/favicon-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "theme_color": "#0b0f0d",
  "background_color": "#0b0f0d",
  "display": "standalone"
}
```

- [ ] **Step 2: Validar manualmente**

Com o dev server rodando (`pnpm --filter @legends/web dev`), abrir Chrome
DevTools → Application → Manifest e confirmar:
- Nenhum erro/warning listado.
- `start_url` mostra `/escritorio`.
- Ícones 192x192 e 512x512 carregam (preview visível).

Em seguida, clicar no ícone de instalação na barra de endereço (ou menu ⋮ →
"Instalar Legends"), instalar o app, e confirmar que o atalho criado abre
direto em `/escritorio` (respeitando o redirecionamento de login existente,
se não autenticado).

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/site.webmanifest
git commit -m "feat: aponta manifest do PWA para a rota do Escritório"
```
