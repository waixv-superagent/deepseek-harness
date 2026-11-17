# Launch window evidence

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
