/* Renderer of the launch and credential lifecycle window. Copy arrives composed by the main process. */
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
  let manualOpen = false
  let optionsSignature = ''
  let formSignature = ''

  /** Build one element with text content, never markup. */
  function element(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  /** Build one selectable card. */
  function optionCard(option, primary, extraClass) {
    const button = element('button', (primary ? 'option primary' : 'option') + (extraClass ? ` ${extraClass}` : ''))
    button.type = 'button'
    button.append(element('span', 'option-label', option.label))
    if (option.hint) button.append(element('span', 'option-hint', option.hint))
    button.addEventListener('click', () => send(option.choice))
    return button
  }

  /** Build the card for one remote Host. */
  function remoteCard(remote) {
    return optionCard({ label: remote.label, hint: remote.hint, choice: { choice: 'remote', url: remote.url } }, false)
  }

  /** Build the card that opens the remote-address form. */
  function manualCard(manual) {
    const button = element('button', 'option')
    button.type = 'button'
    button.append(element('span', 'option-label', manual.label))
    if (manual.hint) button.append(element('span', 'option-hint', manual.hint))
    button.addEventListener('click', () => { manualOpen = true; formSignature = ''; render(state) })
    return button
  }

  /** A labelled text field; the person may select and paste into it. */
  function field(label, type, value, placeholder) {
    const wrapper = element('label', 'field')
    wrapper.append(element('span', 'field-label', label))
    const input = element('input', 'field-input')
    input.type = type
    input.value = value ?? ''
    if (placeholder) input.placeholder = placeholder
    input.spellcheck = false
    input.autocomplete = type === 'password' ? 'current-password' : 'off'
    wrapper.append(input)
    return { wrapper, input }
  }

  /** One form action button. */
  function action(label, primary, onClick) {
    const button = element('button', primary ? 'option primary action' : 'option action')
    button.type = 'submit'
    button.dataset.action = primary ? 'primary' : 'secondary'
    if (onClick) { button.type = 'button'; button.addEventListener('click', onClick) }
    button.append(element('span', 'option-label', label))
    return button
  }

  /** A remote address must be an absolute http(s) URL the Host can serve. */
  function validRemoteUrl(text) {
    try {
      const url = new URL(text.trim())
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
    } catch { return false }
  }

  /** Report one choice once; later clicks and key presses are ignored. */
  function send(choice) {
    if (chosen || !state || state.closing) return
    chosen = true
    panel.classList.add('busy')
    for (const button of options.querySelectorAll('button')) button.disabled = true
    for (const input of options.querySelectorAll('input')) input.disabled = true
    window.dshLifecycle.choose(choice).catch(() => {
      chosen = false
      panel.classList.remove('busy')
      for (const button of options.querySelectorAll('button')) button.disabled = false
      for (const input of options.querySelectorAll('input')) input.disabled = false
    })
  }

  /** Render the options: local Host actions, discovered remotes, then the manual entry. */
  function renderOptions(next) {
    const signature = JSON.stringify([
      next.phase,
      next.primary?.label,
      next.secondary?.label,
      (next.remotes ?? []).map(remote => remote.url),
      next.manual?.label,
    ])
    if (signature === optionsSignature) return
    optionsSignature = signature
    formSignature = ''
    const cards = []
    if (next.primary) cards.push(optionCard(next.primary, true))
    if (next.secondary) cards.push(optionCard(next.secondary, false))
    for (const remote of next.remotes ?? []) cards.push(remoteCard(remote))
    if (next.manual) cards.push(manualCard(next.manual))
    options.replaceChildren(...cards)
    const first = cards[0]
    if (first instanceof HTMLElement) first.focus({ preventScroll: true })
  }

  /** Render the remote-address form. */
  function renderManual(next) {
    const form = next.form
    const signature = JSON.stringify(['manual', next.remoteUrl, next.error, form?.url])
    if (signature === formSignature) return
    formSignature = signature
    const urlField = field(form?.url ?? '', 'text', next.remoteUrl, form?.urlPlaceholder)
    const userField = field(form?.username ?? '', 'text', '')
    const passwordField = field(form?.password ?? '', 'password', '')
    const error = element('p', 'form-error', next.error ?? '')
    error.hidden = next.error === undefined
    const back = action(form?.back ?? '', false, () => {
      manualOpen = false
      optionsSignature = ''
      formSignature = ''
      render(state)
    })
    const connect = action(form?.connect ?? '', true)
    const actions = element('div', 'form-actions')
    actions.append(back, connect)
    const formNode = element('form', 'manual-form')
    formNode.append(urlField.wrapper, userField.wrapper, passwordField.wrapper, error, actions)
    formNode.addEventListener('submit', (event) => {
      event.preventDefault()
      const url = urlField.input.value.trim()
      if (!validRemoteUrl(url)) {
        error.textContent = form?.invalidUrl ?? ''
        error.hidden = false
        urlField.input.focus()
        return
      }
      const username = userField.input.value
      const password = passwordField.input.value
      send({ choice: 'remote', url, ...(username === '' ? {} : { username }), ...(password === '' ? {} : { password }) })
    })
    options.replaceChildren(formNode)
    urlField.input.focus()
  }

  /** Render the gateway credential form. */
  function renderCredentials(next) {
    const form = next.form
    const credentials = next.credentials
    const signature = JSON.stringify(['credentials', credentials?.origin, credentials?.username, credentials?.error, form?.username])
    if (signature === formSignature) return
    formSignature = signature
    const origin = element('p', 'form-origin', credentials?.origin ?? '')
    const userField = field(form?.username ?? '', 'text', credentials?.username)
    const passwordField = field(form?.password ?? '', 'password', '')
    const error = element('p', 'form-error', credentials?.error ?? '')
    error.hidden = credentials?.error === undefined
    const cancel = action(form?.cancel ?? '', false, () => send({ choice: 'cancel' }))
    const signIn = action(form?.signIn ?? '', true)
    const actions = element('div', 'form-actions')
    actions.append(cancel, signIn)
    const formNode = element('form', 'manual-form')
    formNode.append(origin, userField.wrapper, passwordField.wrapper, error, actions)
    formNode.addEventListener('submit', (event) => {
      event.preventDefault()
      send({ choice: 'credentials', username: userField.input.value, password: passwordField.input.value })
    })
    options.replaceChildren(formNode)
    ;(credentials?.username ? passwordField.input : userField.input).focus()
  }

  /** Render one presentation. */
  function render(next) {
    if (!next) return
    const previousError = state?.error
    state = next
    title.textContent = next.title
    detail.textContent = next.detail
    progress.hidden = next.phase !== 'searching' && next.phase !== 'starting'
    footnote.hidden = !next.footnote
    footnote.textContent = next.footnote || ''
    panel.classList.toggle('closing', next.closing === true)
    // A new main-process error means the submitted address was refused: keep the form open and
    // show the reason. An error already on the previous presentation does not reopen it.
    if (next.error !== undefined && next.error !== previousError) {
      manualOpen = true
      chosen = false
      panel.classList.remove('busy')
    }
    if (next.closing) {
      for (const button of options.querySelectorAll('button')) button.disabled = true
      for (const input of options.querySelectorAll('input')) input.disabled = true
      return
    }
    if (next.credentials !== undefined || next.phase === 'credentials') {
      manualOpen = false
      renderCredentials(next)
      return
    }
    if (manualOpen || next.phase === 'manual') {
      renderManual(next)
      return
    }
    renderOptions(next)
  }

  document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return
    if (event.key !== 'Escape' && event.key !== 'Enter') return
    if (manualOpen) {
      if (event.key === 'Escape') {
        event.preventDefault()
        manualOpen = false
        formSignature = ''
        optionsSignature = ''
        render(state)
      }
      return
    }
    if (state?.credentials !== undefined) {
      if (event.key === 'Escape') { event.preventDefault(); send({ choice: 'cancel' }) }
      return
    }
    const primary = state && state.primary
    if (!primary) return
    event.preventDefault()
    send(primary.choice)
  })

  document.addEventListener('dragstart', (event) => { event.preventDefault() })

  window.dshLifecycle.onState(render)
  window.dshLifecycle.state().then((initial) => { if (initial) render(initial) }).catch(() => {})
})()
