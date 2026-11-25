---
title: Failure triage
description: Group failures by cause, assign them, link a known issue, and see whether a fix held.
---

kinora groups the failures of a project by their error: tests that fail with the same message
(once run-specific parts such as paths, ids and timings are masked) form one **failure cause**.
Forty red tests often come down to two or three causes, and each one is triaged once.

The causes of a project are listed under **Top failure causes** on its Tests page. Every cause that
still needs a decision, across all your projects, also shows in the **Failure inbox** on the
overview.

## Triage a cause

Expand a cause on the Tests page to act on it:

- **Resolve** it once a fix landed. **Ignore** it when it is not worth fixing. Either one takes it
  out of the inbox. **Reopen** brings it back.
- **Assign** it to a member of the workspace.
- **Snooze** it for a day, a week, or until it fails again. A snoozed cause leaves the inbox but
  stays open.
- **Link issue** to pin a known issue (any `http(s)` URL) and a note for the team.

The page also shows when the cause was first seen, the run it last failed in, and the owners
from the project's CODEOWNERS.

Every member of the workspace can triage. Decisions are kept by error, so they carry over to
every later run that fails the same way.

## Did the fix hold?

kinora reads the runs that come after a decision:

- A resolved cause that fails again, in a run started after it was resolved, shows as
  **Regressed** and goes back to the inbox.
- An open cause whose tests then ran 3 times without that failure shows as **Not seen in N runs**:
  the fix probably landed, so resolve it.

Runs flagged as [environment incidents](/guides/environment-incidents/) are left out, so an outage
never reopens a cause.

## The failure inbox

The inbox on the overview sorts open causes into queues: **All open**, **Needs triage** (never
triaged), **Mine** (assigned to you), **Regressed**, **Stopped failing** and **Snoozed**.
Regressions come first, then the latest failures. The queue is part of the URL (`?queue=mine`), so
a copied link opens the same list.

The inbox reads the same runs as each project's Tests page. A cause that last failed before them
drops out of it, but its triage is kept and applies again if it comes back.
