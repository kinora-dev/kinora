import type { ImageMetadata } from 'astro'
import a11yDark from '../assets/screenshots/a11y-card-dark.png'
import a11yLight from '../assets/screenshots/a11y-card-light.png'
import analyticsDark from '../assets/screenshots/analytics-card-dark.png'
import analyticsLight from '../assets/screenshots/analytics-card-light.png'
import compareDark from '../assets/screenshots/compare-card-dark.png'
import compareLight from '../assets/screenshots/compare-card-light.png'
import componentsDark from '../assets/screenshots/components-dark.png'
import componentsLight from '../assets/screenshots/components-light.png'
import projectDark from '../assets/screenshots/project-card-dark.png'
import projectLight from '../assets/screenshots/project-card-light.png'
import screenshotDiffDark from '../assets/screenshots/screenshot-diff-card-dark.png'
import screenshotDiffLight from '../assets/screenshots/screenshot-diff-card-light.png'
import testHistoryDark from '../assets/screenshots/test-history-card-dark.png'
import testHistoryLight from '../assets/screenshots/test-history-card-light.png'
import testsDark from '../assets/screenshots/tests-dark.png'
import testsLight from '../assets/screenshots/tests-light.png'
import { DOCS } from '../lib/site'

export interface PillarItem {
  eyebrow: string
  title: string
  body: string
  light: ImageMetadata
  dark: ImageMetadata
  alt: string
  docs?: { label: string, href: string, event: string }
}

export interface Pillar {
  id: string
  eyebrow: string
  title: string
  intro: string
  items: PillarItem[]
}

export const UNDERSTAND: Pillar = {
  id: 'features',
  eyebrow: 'Understand',
  title: 'Know which tests to trust.',
  intro: 'One level up from the HTML report: every run kept, every test followed, so a red build says whether it is noise or a real regression.',
  items: [
    {
      eyebrow: 'Flaky or broken',
      title: 'Tell flaky tests from broken ones.',
      body: 'Playwright only calls a test flaky when it passes on a retry. kinora also catches the ones that pass and fail on the same commit, or keep flipping from one run to the next, and tells them apart from broken tests: the ones that fail and keep failing since a commit. Each badge says why.',
      light: testsLight,
      dark: testsDark,
      alt: 'Tests page listing flaky and broken tests with their flaky rate, fail rate and run history',
      docs: { label: 'Flaky tests', href: DOCS.flakyTests, event: 'docs-flaky-tests' },
    },
    {
      eyebrow: 'Trends over time',
      title: 'Every run, one strip at a time.',
      body: 'Push from CI and kinora keeps the history. Pass rate, run count, and duration per project, with a sparkline trend and one colored strip per run, so a slow drift is obvious long before it breaks the build.',
      light: projectLight,
      dark: projectDark,
      alt: 'Project cards with their pass rate, a trend sparkline and one colored strip per run',
    },
    {
      eyebrow: 'Analytics',
      title: 'Is the suite getting better or worse?',
      body: 'The share of passed, flaky and failed results over the last 30 or 90 days, per day or per week, for every branch or just one. The flaky and failure rates get their own scale, so a flaky rate creeping from 2% to 8% shows here weeks before anyone complains about CI.',
      light: analyticsLight,
      dark: analyticsDark,
      alt: 'Analytics page with the share of passed, flaky and failed test results per week over 90 days, and a flaky rate climbing from 2% to 8% before dropping back',
    },
    {
      eyebrow: 'Per-test history',
      title: 'Follow a single test across runs.',
      body: 'Each test keeps a stable identity regardless of how it was uploaded, so you can track one test run-to-run: when it started flaking, when it was fixed, and how long it has been green.',
      light: testHistoryLight,
      dark: testHistoryDark,
      alt: 'Per-test history with pass, flaky and fail rates, a Broken badge and a status timeline',
    },
    {
      eyebrow: 'Run-to-run diff',
      title: 'See exactly what changed between two runs.',
      body: 'Pick any two runs and kinora groups every difference for you: newly failing, fixed, newly flaky, and still failing. No more diffing two HTML reports by eye to find the one test that regressed since green.',
      light: compareLight,
      dark: compareDark,
      alt: 'Run comparison grouping tests into broken, fixed, newly flaky and still failing, with the pass rate dropping from 98.2% to 97.3%',
    },
  ],
}

export const COVER: Pillar = {
  id: 'coverage',
  eyebrow: 'Cover',
  title: 'Beyond end-to-end tests.',
  intro: 'Storybook stories, accessibility scans and visual assertions land next to your Playwright runs, with the same history.',
  items: [
    {
      eyebrow: 'Component health',
      title: 'Every story of your design system, run after run.',
      body: 'Storybook stories run by Vitest and Playwright component tests are grouped by component and story, each with its status and history. See at a glance which component regressed and which story keeps flaking, then open the tests behind it.',
      light: componentsLight,
      dark: componentsDark,
      alt: 'Components page with accessibility hotspots and each component listed with its stories, their status and a run history timeline',
      docs: { label: 'Component testing', href: DOCS.componentTesting, event: 'docs-component-testing' },
    },
    {
      eyebrow: 'Accessibility',
      title: 'Know where accessibility breaks, and how badly.',
      body: 'kinora reads the axe scans of your Playwright tests and of your Storybook stories: the rules broken, their impact, the elements they hit. Hotspots rank your test files and components by their violations, critical ones first, so you know where fixing pays off.',
      light: a11yLight,
      dark: a11yDark,
      alt: 'A test with its axe violations: a critical missing alternative text and a moderate landmark rule, with the elements they hit',
      docs: { label: 'Accessibility', href: DOCS.a11y, event: 'docs-a11y' },
    },
    {
      eyebrow: 'Screenshot comparisons',
      title: 'See the visual regression, not just the error.',
      body: 'A failed toHaveScreenshot shows its expected, actual and diff images on the run and in the test\'s history: side by side, one over the other, or as the diff alone.',
      light: screenshotDiffLight,
      dark: screenshotDiffDark,
      alt: 'A failed screenshot assertion of a date picker, expected and actual images side by side',
      docs: { label: 'Screenshot comparisons', href: `${DOCS.reporter}#screenshot-comparisons`, event: 'docs-screenshot-comparisons' },
    },
  ],
}
