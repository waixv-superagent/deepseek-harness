# Launch window evidence

English | [中文](README.zh.md)

`lifecycle-*.png` are captures of the launch window's shipped renderer (`apps/desktop/renderer/lifecycle.html`,
`lifecycle.css`, `lifecycle.js`) and its shipped preload, opened in a 640×470 frameless transparent Electron
window with the same web preferences as `DesktopLifecycleWindow`. The harness supplied only the presentation
objects the main process composes from the shell locale; no renderer or preload code was mocked.

- `lifecycle-found.png`: a running Host was discovered; connecting to it is the primary action, stopping and
  restarting it is the secondary action, and the last exit's interruption note is shown.
- `lifecycle-searching.png`: the pre-decision splash.
- `lifecycle-stale.png`: a Host from another app build (or an unresponsive one) needs a restart before launch.

The launch window did not exist before this change, so this screen has no before capture: the previous shell
had no running Host to reconnect to and always spawned a new one. The native quit dialog's new "Also stop the
Host" checkbox cannot be captured with Electron's `capturePage`, and the running production application was
not quit to take a desktop screenshot, so that baseline is missing.

## Remote Hosts

`remote-*.png` capture the same shipped renderer (`lifecycle.html`, `lifecycle.css`, `lifecycle.js`) and the
shipped `preload-lifecycle.cjs`, served from a same-origin local HTTP page because the renderer's
`script-src 'self'` CSP cannot match a `file://` document. The window is 640×620, frameless, transparent,
at 125% capture scale, with the same web preferences as `DesktopLifecycleWindow`; the harness supplied only
the presentation objects the main process composes.

- `remote-found-before.png`: the launch window at this branch's base (`fork/master`); a running local Host
  offers connect and restart only.
- `remote-found-after.png`: the same scenario plus the discovered remote card and the manual-address card.
- `remote-only-after.png`: no local Host; a gateway was discovered, so start-local, the remote, and manual
  entry are offered.
- `remote-manual-after.png` and `remote-credentials-after.png`: the remote-address form and the gateway's
  sign-in form.

No GIF is embedded: the added states are static cards and forms, and the panel and card entrance animations
are unchanged; the capture harness runs offscreen and the desktop session is not interactive.
