// `test` with kinora's `mount`: each mounted story is recorded on the test, which feeds the
// Components page. Users import this from `@kinora/reporter/ct`; in the repo that entry resolves
// to the reporter's build output, so the suite reads its source to run without a prior build.
export { expect, test } from '../../reporter/src/ct.ts'
