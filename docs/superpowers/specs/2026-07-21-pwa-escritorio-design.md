# PWA do Escritório — design

## Contexto

O Legends já serve `apps/web/public/site.webmanifest` e ícones (`favicon-192.png`,
`favicon-512.png`) referenciados em `index.html`, mas não registra nenhum
service worker. Sem service worker, Chrome/Edge não disparam o prompt/critério
de instalabilidade — hoje não é possível "baixar" o app nem criar um atalho de
desktop a partir do navegador.

## Objetivo

Permitir instalar o Legends como app (PWA) a partir do navegador, com o atalho
resultante abrindo direto na rota `/escritorio` (Escritório Virtual), em vez da
tela inicial do produto.

Fora de escopo: funcionamento offline, cache de assets/API, ícone ou nome
dedicados ao Escritório (reaproveita o manifest/ícones atuais do Legends).

## Mudanças

### 1. `apps/web/public/sw.js` (novo)

Service worker mínimo, sem estratégia de cache — existe só para satisfazer o
critério de instalabilidade dos navegadores:

```js
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
```

Sem listener de `fetch`: nenhuma requisição é interceptada, então o
comportamento de rede (API, WebSocket, LiveKit) permanece inalterado.

### 2. Registro do service worker

Em `apps/web/src/main.tsx`, registrar o SW após o app montar, condicionado a
suporte do browser:

```ts
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
  })
}
```

Falha de registro não deve quebrar o app — `register()` retorna uma Promise;
não precisa de `.catch` com tratamento especial (erro só fica no console).

### 3. `apps/web/public/site.webmanifest`

Adicionar os campos que faltam para apontar o atalho instalado para o
Escritório:

```json
{
  "id": "/escritorio",
  "start_url": "/escritorio",
  "scope": "/",
  ...campos existentes (name, icons, theme_color, background_color, display)
}
```

`scope: "/"` mantém o app instalado navegável para o resto do Legends (login,
votação etc.) — só a tela de abertura do atalho muda para `/escritorio`. Se o
usuário não estiver autenticado, o roteamento existente do app já redireciona
para o login normalmente.

## Testes

Infraestrutura de browser (manifest + registro de SW) não tem um teste
automatizado significativo em Vitest/jsdom (não há `navigator.serviceWorker`
real em jsdom, e o critério de instalabilidade é avaliado pelo browser).
Validação será manual:

- Chrome DevTools → Application → Manifest: sem erros, ícones carregando,
  `start_url` correto.
- Chrome DevTools → Application → Service Workers: SW registrado e ativo.
- Instalar o app pelo ícone da barra de endereço e confirmar que o atalho
  criado abre direto em `/escritorio`.
