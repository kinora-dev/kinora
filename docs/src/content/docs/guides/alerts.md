---
title: Alerts
description: Get notified on Slack, email, or a webhook when a run brings new failures or regressions.
---

Each project can send a notification when a run brings new failures or regressions. Alerts are
configured per project in the dashboard; there is nothing to add to your CI.

On cloud, alerts are a paid feature. **Self-host is unlimited** (`KINORA_CLOUD=false` turns every
feature on).

## Channels

A project can notify any combination of:

- **Slack** - connect a workspace with "Add to Slack", then pick a channel.
- **Email** - one or more addresses (needs SMTP configured on the server; see
  [Configuration](/self-hosting/configuration/) for the `SMTP_*` variables).
- **Webhook** - a custom URL that receives a JSON payload, for wiring alerts into your own
  systems.

Set them up under a project's alert settings in the dashboard.

## Policy

Each channel fires on one of three policies:

| Policy | Fires when |
| --- | --- |
| `always` | Every run, pass or fail. |
| `on-failure` | The run has any unexpected failure, or is a [sharded run](/guides/reporter/#sharded-runs) closed with shards missing. |
| `on-regression` | The run has a test that is **newly failing or newly flaky** versus the previous run. |

`on-regression` is the quiet default for a healthy suite: it stays silent while things are green
and only pings you when something actually breaks or starts flaking.

## What's in an alert

- The project name and a link to the run in the dashboard.
- The run's pass/fail counts.
- The lists of newly failing and newly flaky tests (capped, with an "and N more" overflow).
- For a sharded run closed with shards missing, how many landed ("3 of 4 shards"). Webhooks get
  it as `incomplete: { landed, total }`.
- For an [environment incident](/guides/environment-incidents/) (the app under test was down), one
  message naming the outage instead of the test lists, whatever the policy. Webhooks get it as
  `incident: { rule, reason, host }`.

A sharded run alerts once, when its last shard lands, or when it is closed as incomplete.

Regressions are computed by comparing the run against the previous run on the same branch
(skipping environment incidents), so an alert distinguishes a fresh break from a test that was
already red.

## Bulk-imported runs

Runs pushed via `kinora import` do **not** trigger alerts, so backfilling history from an archive
never floods your channels.
