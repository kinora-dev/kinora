---
title: "Introducing Kinora: a Playwright test dashboard with history, flaky tracking, and traces"
description: Kinora is a dashboard for Playwright test reports across projects and over time. It keeps CI history, surfaces flaky tests, and opens traces inline.
date: 2026-10-04
tags:
  - playwright
  - testing
  - devops
  - opensource
slug: introducing-kinora
image: /og-image.png
imageAlt: Kinora Playwright test reporting dashboard
cover: overview
author:
  name: Joris Gallot
  url: https://jorisgallot.dev
draft: false
---

Playwright gives you an excellent HTML report for a single test run. You can open a failed test, inspect screenshots, read errors, and launch the trace viewer when you need the full story.

That works great when you are looking at one run.

It gets harder when your team wants to answer questions across many runs:

- Is this failure new, or has it been failing for days?
- Which tests are flaky across branches and projects?
- Did the pass rate improve after the last fix?
- Where is the trace for the CI failure someone reported yesterday?
- Can everyone on the team debug from the same place without downloading artifacts?

That is why I built Kinora.

## What is Kinora?

Kinora is a dashboard for Playwright test reports across projects and over time.

CI runs push their results to Kinora. The dashboard keeps the history, tracks pass rates and trends, surfaces flaky tests, and lets you open the full Playwright trace inline from a failed test.

The goal is not to replace Playwright's report. The goal is to keep the useful parts of every report after CI finishes and make them searchable, comparable, and easier to debug as a team.

You can use Kinora in two ways:

- Self-host it for free with Docker Compose.
- Use the hosted Kinora cloud when you do not want to run the infrastructure yourself.

The source is available on [GitHub](https://github.com/Kinora-dev/kinora), with MIT-licensed embeddable packages and fair-source app packages.

## Why not just use the Playwright HTML report?

The Playwright HTML report is optimized for one run. That is the right default.

But CI test debugging often needs a longer memory.

A single report can tell you that a test failed. It does not naturally tell you that the same test failed three times this week, passed on `main`, failed only on Chromium, or started getting slow after a specific change.

Teams usually fill that gap with a mix of CI artifacts, screenshots, Slack messages, local downloads, and tribal knowledge.

Kinora keeps the run data in one place so you can see:

- run history by project
- pass rate trends
- failed and flaky tests
- retries and durations
- git and CI metadata
- trace.zip artifacts attached to failures

That context makes triage faster because the first question is no longer "where is the report?". It becomes "what changed?".

## How it works

A typical setup looks like this:

1. Add the Kinora reporter to your Playwright config, or upload a `results.json` file with the CLI.
2. Run Playwright in CI like you already do.
3. Kinora normalizes the report and uploads the run through a simple REST API.
4. The dashboard stores the run, tests, metadata, and trace artifacts.
5. Your team opens Kinora to review the current run or compare it with history.

The important part is stable test identity.

Kinora derives a cross-run key from the test file, title path, and project name. That means the same test can be tracked over time even when it is uploaded from different CI jobs or ingestion paths.

## Debugging failures with traces inline

Playwright traces are one of the best parts of the Playwright ecosystem. They let you replay actions, inspect DOM snapshots, view network requests, and understand what happened before a failure.

But traces are often trapped inside CI artifacts.

Kinora keeps the trace attached to the failed test. From the dashboard, you can open it directly in the embedded trace viewer without downloading the zip or switching tools.

That makes traces part of the team workflow instead of a local debugging afterthought.

## Finding flaky tests over time

A flaky test is rarely obvious from a single run.

You need history to see that a test passes most of the time, fails sometimes, retries successfully, or fails only under one browser or CI condition.

Kinora keeps that history so flaky tests can be investigated as a pattern, not as isolated failures.

The dashboard helps you spot tests that repeatedly move between passed, failed, and flaky states. From there, you can open the run, inspect the trace, and decide whether the problem is test code, app behavior, infrastructure, or timing.

## Built for CI, self-hosting, and teams

Kinora is CI-agnostic. Anything that can run Playwright and send an HTTP request can publish a run.

The reporter is convenient for Playwright projects. The CLI is useful when you already generate a report and want to upload it as a separate step.

For deployment, there are two paths:

- Self-hosted: run the server, web app, Postgres, and artifact storage on your own infrastructure.
- Cloud: use Kinora without managing the stack.

Self-hosting matters because test reports can include sensitive URLs, logs, screenshots, traces, and environment metadata. If you want that data to stay on your infrastructure, it can.

## What is next?

Kinora already covers the core workflow: ingest Playwright runs, keep history, surface failures and flaky tests, and open traces inline.

The next steps are about making that workflow even more useful:

- better artifact previews for screenshots and videos
- richer local desktop workflows around traces and failed tests
- stronger integrations with alerts, pull requests, and agents
- more content and guides around Playwright reporting best practices

If you are using Playwright in CI and want a persistent dashboard for your test history, Kinora is available now.

- [Try the hosted app](https://app.kinora.dev/signup)
- [Open the live demo](https://demo.kinora.dev)
- [Read the docs](https://docs.kinora.dev)
- [Star the project on GitHub](https://github.com/Kinora-dev/kinora)

This is the first post in a series about Playwright reporting, flaky test tracking, CI debugging, and building Kinora in public.
