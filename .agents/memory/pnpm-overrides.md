---
name: pnpm overrides for vulnerable transitive deps
description: How to safely force-patch transitive npm deps in this monorepo without breaking parent ranges
---

# Fix vulnerable transitive deps via overrides in pnpm-workspace.yaml

The four scanner-flagged packages (axios, protobufjs, @grpc/grpc-js,
@xmldom/xmldom) are ALL transitive — none in any package.json. Patch them with
`overrides:` in `pnpm-workspace.yaml` (the overrides block, not catalog).

# Caret in an override does NOT keep you in the minor

`"@grpc/grpc-js": "^1.9.16"` resolved to **1.14.4** (caret = highest in the
major) and silently dragged `@grpc/proto-loader` from 0.7.15 → 0.8.1. That
bypassed `@firebase/firestore@4.x`'s declared `~1.9.0` range.

**Why:** chased a "no breaking changes" claim that wasn't true — the override
jumped two minors past what firestore was built against.

**How to apply:** when a parent pins a transitive to a narrow range
(`~x.y.0`), pin the override to the EXACT patched version (`"1.9.16"`), not a
caret. Always re-grep the lockfile after install to confirm the resolved
version AND that sibling deps (proto-loader) didn't move. Check the parent's
declared range first: `npm view <parent>@<ver> dependencies.<child>`.

# Prefer the in-range patch over "latest"

Don't blindly take registry-latest. protobufjs CVE was fixed within 7.x (no
need for major v8 that breaks proto-loader's `^7` peer); xmldom fixed in 0.8.13
(no need for breaking 0.9.x); the advisory `fix.requiresMajorUpdate:false` flag
from `runDependencyAudit()` confirms a non-breaking patch exists.

# axios lives only in api-server (via twilio), not the mobile bundle

So the axios fix is a server-side change shipped by a normal server deploy, NOT
by an Expo OTA update. xmldom is Expo build tooling (only matters at build
time). protobufjs/grpc-js sit under firebase; RN firestore uses webchannel, so
they may be tree-shaken out of the mobile JS bundle entirely.
