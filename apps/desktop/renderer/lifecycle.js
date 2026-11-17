/* Renderer of the launch/quit lifecycle window. Copy arrives composed by the main process. */
(() => {
  'use strict'

  const panel = document.getElementById('panel')
  const title = document.getElementById('title')
  const detail = document.getElementById('detail')
  const progress = document.getElementById('progress')
  const options = document.getElementById('options')
  const footnote = document.getElementById('footnote')
  let state
  let chosen = false

  /** Build one option card. */
  function optionCard(option, primary) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = primary ? 'option primary' : 'option'
    const label = document.createElement('span')
    label.className = 'option-label'
    label.textContent = option.label
    button.append(label)
    if (option.hint) {
      const hint = document.createElement('span')
      hint.className = 'option-hint'
      hint.textContent = option.hint
      button.append(hint)
    }
    button.addEventListener('click', () => choose(option.choice))
    return button
  }

  /** Report one choice once; later clicks and key presses are ignored. */
  function choose(choice) {
    if (chosen || !state || state.closing) return
    chosen = true
    panel.classList.add('busy')
    for (const button of options.querySelectorAll('button')) button.disabled = true
    window.dshLifecycle.choose(choice).catch(() => {
      chosen = false
      panel.classList.remove('busy')
      for (const button of options.querySelectorAll('button')) button.disabled = false
    })
  }

  /** Render one presentation without animating unchanged phases. */
  function render(next) {
    const phaseChanged = !state || state.phase !== next.phase
    state = next
    title.textContent = next.title
    detail.textContent = next.detail
    progress.hidden = next.phase !== 'searching' && next.phase !== 'starting'
    footnote.hidden = !next.footnote
    footnote.textContent = next.footnote || ''
    panel.classList.toggle('closing', next.closing === true)
    if (next.closing) {
      for (const button of options.querySelectorAll('button')) button.disabled = true
      return
    }
    if (phaseChanged) {
      const cards = []
      if (next.primary) cards.push(optionCard(next.primary, true))
      if (next.secondary) cards.push(optionCard(next.secondary, false))
      options.replaceChildren(...cards)
      if (cards[0]) cards[0].focus({ preventScroll: true })
    }
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' && event.key !== 'Enter') return
    const primary = state && state.primary
    if (!primary) return
    event.preventDefault()
    choose(primary.choice)
  })

  document.addEventListener('dragstart', (event) => { event.preventDefault() })

  window.dshLifecycle.onState(render)
  window.dshLifecycle.state().then((initial) => { if (initial) render(initial) }).catch(() => {})
})()
