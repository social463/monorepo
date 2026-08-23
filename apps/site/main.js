/*
 * Landing do Legends — o único JavaScript da página.
 * Script clássico (sem `type="module"`) de propósito: assim o index.html
 * também abre direto por file:// , sem servidor.
 */
;(function () {
  'use strict'

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /* Animação de entrada ao rolar. Sem IntersectionObserver (ou com
     motion reduzido) tudo já nasce visível — o CSS cuida disso. */
  function setupReveal() {
    var targets = document.querySelectorAll('.reveal')
    if (reduceMotion || !('IntersectionObserver' in window)) {
      for (var i = 0; i < targets.length; i++) targets[i].classList.add('is-visible')
      return
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        })
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    )

    for (var j = 0; j < targets.length; j++) observer.observe(targets[j])
  }

  /* O header ganha borda e fundo sólido depois que a página sai do topo. */
  function setupHeader() {
    var header = document.querySelector('[data-header]')
    if (!header) return

    var ticking = false
    function update() {
      header.classList.toggle('is-stuck', window.scrollY > 24)
      ticking = false
    }

    window.addEventListener(
      'scroll',
      function () {
        if (ticking) return
        ticking = true
        window.requestAnimationFrame(update)
      },
      { passive: true },
    )
    update()
  }

  function setupYear() {
    var slot = document.querySelector('[data-year]')
    if (slot) slot.textContent = String(new Date().getFullYear())
  }

  setupReveal()
  setupHeader()
  setupYear()
})()
