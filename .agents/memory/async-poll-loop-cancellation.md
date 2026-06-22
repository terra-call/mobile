---
name: Async self-rescheduling poll loops need an effect-local cancelled flag
description: Why clearTimeout alone fails to stop an async setTimeout polling loop in a React effect
---

A polling loop where `tick()` is `async` and schedules its next `setTimeout`
*after* an `await` cannot be stopped by `clearTimeout(timer)` in the effect
cleanup alone.

**Why:** when the timeout has already fired and `tick` is mid-`await`, the
`timer` the cleanup clears points at the already-elapsed timeout (a no-op). When
the await resolves, `tick` runs to completion and schedules a fresh timeout —
*after* cleanup ran — so the loop keeps going (and keeps spending money / hitting
the network) even though the gating condition went false. Checking only a mount
flag (`activeRef`) does not help, because the component is still mounted; the
*effect* was torn down, not the component.

**How to apply:** add an effect-local `let cancelled = false`, set it in the
cleanup, and check it both right after the `await` and again right before
scheduling the next `setTimeout`. This is the reliable stop signal whenever a
gating boolean (e.g. an `active`/`polling` prop, app foreground, a session cap)
can flip false while an async tick is in flight. Applies to the Reolink
`HomeCameraFeed` poll loop and any similar pseudo-live frame/poll loop.
