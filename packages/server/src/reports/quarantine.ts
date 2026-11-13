import type { NormTest } from '@kinora/core'
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import { db } from '../db'
import { test, testQuarantine } from '../db/schemas/index'

interface ProjectRow { id: string }

export function activeQuarantineWhere(projectId: string) {
  return and(
    eq(testQuarantine.projectId, projectId),
    or(isNull(testQuarantine.expiresAt), gt(testQuarantine.expiresAt, new Date())),
  )
}

export interface QuarantinedTest {
  testKey: string
  reason?: string
  expiresAt?: string
  // Where the test lives, from its stored results; absent once retention removed every one of them.
  test?: Pick<NormTest, 'file' | 'titlePath' | 'projectName'>
}

// Active quarantines with the identity CI needs to name each test in a Playwright test list. Every
// result of a test key shares that identity, so any one row gives it.
export async function loadQuarantinedTests(p: ProjectRow): Promise<QuarantinedTest[]> {
  const rows = await db.query.testQuarantine.findMany({ where: activeQuarantineWhere(p.id), orderBy: testQuarantine.testKey })
  if (!rows.length)
    return []
  const located = await db.selectDistinctOn([test.testKey], { testKey: test.testKey, file: test.file, titlePath: test.titlePath, projectName: test.projectName })
    .from(test)
    .where(and(eq(test.projectId, p.id), inArray(test.testKey, rows.map(r => r.testKey))))
    .orderBy(test.testKey)
  const byKey = new Map(located.map(t => [t.testKey, t]))
  return rows.map((q) => {
    const t = byKey.get(q.testKey)
    return {
      testKey: q.testKey,
      ...(q.reason && { reason: q.reason }),
      ...(q.expiresAt && { expiresAt: q.expiresAt.toISOString() }),
      ...(t && { test: { file: t.file, titlePath: t.titlePath, projectName: t.projectName } }),
    }
  })
}
