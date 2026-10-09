import { h } from 'vue'
import { Table, TableBody, TableCaption, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '.'

const RUNS = [
  { sha: '1de4783', health: 'Failing', passRate: '85.7%' },
  { sha: 'b59ad22', health: 'Passing', passRate: '100.0%' },
]

function head() {
  return h(TableHeader, null, () => h(TableRow, null, () => ['SHA', 'Health', 'Pass rate'].map(label => h(TableHead, { key: label }, () => label))))
}

export function Runs() {
  return h(Table, null, () => [
    h(TableCaption, null, () => 'Latest runs'),
    head(),
    h(TableBody, null, () => RUNS.map(run => h(TableRow, { key: run.sha }, () => [
      h(TableCell, null, () => run.sha),
      h(TableCell, null, () => run.health),
      h(TableCell, null, () => run.passRate),
    ]))),
  ])
}

export function Empty() {
  return h(Table, null, () => [head(), h(TableBody, null, () => h(TableEmpty, { colspan: 3 }, () => 'No runs yet.'))])
}
