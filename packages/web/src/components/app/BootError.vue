<script setup lang="ts">
import ErrorState from './ErrorState.vue'

// Shown instead of the app when the session could not be resolved at boot. A full reload is the
// retry: it reruns the whole boot (session, route guards) and keeps the URL the user was on.
defineProps<{ error: unknown }>()

function reload(): void {
  window.location.reload()
}
</script>

<template>
  <div class="grid min-h-svh place-items-center bg-background px-5 app-grid">
    <div class="flex w-full max-w-lg flex-col gap-5">
      <div class="flex items-center gap-2.5">
        <span class="size-2.5 rounded-full bg-signal" aria-hidden="true" />
        <span class="font-mono text-xl font-semibold tracking-tight lowercase">kinora</span>
      </div>
      <ErrorState :error="error" @retry="reload" />
    </div>
  </div>
</template>
