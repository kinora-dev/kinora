---
title: Environment incidents
description: How kinora recognizes a run that failed because the app under test was down, and keeps it out of histories, baselines and alerts.
---

When the environment under test is down, every test fails at once: staging refuses connections,
a DNS name stops resolving, the browser crashes on a starved runner. None of those failures says
anything about the tests or the code. kinora flags such a run as an **environment incident** and
keeps it out of everything that compares runs.

## How a run is recognized

When a run finishes (for a [sharded run](/guides/reporter/#sharded-runs), when its last shard
lands), kinora reads its failures. The run is flagged when at least 3 tests failed, at least 80%
of the executed tests failed, and either:

| Rule | 70% of the failures or more were |
|---|---|
| Host unreachable | Navigating or connecting to the app's host, and getting no answer |
| Browser crash | The browser crashing, closing, or failing to launch |

A failure counts as reaching the app's host when it is a network error (`net::ERR_CONNECTION_REFUSED`,
a name that does not resolve, a reset connection, `ECONNREFUSED` from a request fixture) or a
`page.goto` that timed out, and the address it names is the host of a Playwright project's
`baseURL`. The [reporter](/guides/reporter/) sends the `baseURL`s, and a
[CLI upload](/guides/cli/) takes them with `--base-url`. Without one (Vitest, a CLI upload without
the option), the host most failures named stands in for it.

What never counts: a third-party host going down (a CDN, an analytics script), and a failing
assertion, however many tests it breaks. A login page broken by a commit is a regression, not an
incident. A test that timed out and then saw its browser close is a timeout, not a crash.

## What a flagged run changes

- **The run page** says *Environment incident · not counted*, with the reason (*41 of 44 tests
  failed, 39 of them navigating or connecting to staging.example.test (connection refused).*) and
  whether a rule or a person decided. Run lists show an **Incident** badge.
- **Test histories, flaky and broken flags, and failure causes** leave the run out. A test that
  failed only in the incident does not become flaky or broken.
- **Baselines** skip it: the next run is compared with the last run before the incident, so it
  does not report every test as fixed.
- **[Alerts](/guides/alerts/)** send one message naming the outage instead of the newly failing
  tests, on every policy, including *on regression*. Webhooks carry it under `incident`, with empty
  `newlyFailing` and `newlyFlaky`.
- **The [PR comment](/guides/pr-comments/)** says the run was an environment incident and lists no
  regressions. The reporter and the CLI also print a warning with the reason.
- **[MCP](/guides/mcp/)**: `list_failures` and `get_run` include the incident, so an agent does
  not read an outage as a regression.

The run itself stays: its tests, errors and traces are kept like any other run's, and analytics
still count it.

## Stopping a run before it starts

With [`@kinora/reporter/check-base-url`](/guides/reporter/#checking-the-app-is-up) in
`globalSetup`, Playwright checks that each `baseURL` answers before any worker starts, and stops
the run when one does not. No test runs, so the outage costs no CI time and no run reaches the
dashboard.

## Marking and clearing by hand

The rules can miss an outage or flag a real regression. On the run page:

- **Mark as incident** on a run with failures the rules did not flag (the payment sandbox was
  down, a shared account was locked). It is left out the same way.
- **Clear the flag** on a flagged run whose failures are real. It counts again everywhere.

The decision is kept on the run, and a shard landing later never overrides it. The run page says
who decided.

## Limits

- An outage that hits only part of the suite (one service down, 30% of the tests failing) stays
  below the thresholds: mark it by hand.
- Marking or clearing a run does not send the alerts it skipped, or withdraw the ones it sent.
