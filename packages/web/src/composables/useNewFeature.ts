import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

// Features announced with a "New" badge. The badge goes away once the user has opened the
// feature, and for everyone after the given day: drop the entry and its call sites then.
const NEW_UNTIL = {
  analytics: '2026-12-15',
  failureInbox: '2027-01-06',
} as const

export function useNewFeature(feature: keyof typeof NEW_UNTIL) {
  const seen = useLocalStorage(`kinora:seen:${feature}`, false)
  const isNew = computed(() => !seen.value && Date.now() < Date.parse(NEW_UNTIL[feature]))
  function markSeen() {
    seen.value = true
  }
  return { isNew, markSeen }
}
