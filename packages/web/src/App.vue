<script setup lang="ts">
import { Toaster } from '@kinora/ui/sonner'
import { useTitle } from '@vueuse/core'
import { computed } from 'vue'
import { RouterView } from 'vue-router'
import AppHeader from '@/components/app/AppHeader.vue'
import BootError from '@/components/app/BootError.vue'
import DemoBanner from '@/components/app/DemoBanner.vue'
import LoadingScreen from '@/components/app/LoadingScreen.vue'
import { useDemo } from '@/composables/queries'
import { session } from '@/lib/session'
// Boot useColorMode at startup so system/dark applies before any page mounts
import '@kinora/ui/theme'
import 'vue-sonner/style.css'

const ready = session.ready
const bootError = session.bootError

const isDemo = useDemo()
useTitle(computed(() => (isDemo.value ? 'kinora · demo' : 'kinora')))
</script>

<template>
  <Transition name="boot" mode="out-in">
    <LoadingScreen v-if="!ready" />
    <BootError v-else-if="bootError" :error="bootError" />
    <!-- Single element root so the boot transition can animate it; RouterView
         must not sit directly inside <Transition>. -->
    <div v-else>
      <RouterView v-slot="{ Component, route }">
        <!-- Public pages (login / signup) + the invite hand-off render standalone, no app chrome. -->
        <Transition v-if="route.meta.public || route.meta.invite" name="page" mode="out-in">
          <component :is="Component" :key="route.path" />
        </Transition>
        <!-- App pages get the header + control-room grid shell. -->
        <div v-else class="min-h-svh bg-background app-grid">
          <DemoBanner />
          <AppHeader />
          <main class="mx-auto max-w-7xl px-5 py-8">
            <!-- Settings tabs share one layout: collapse their key so switching tabs swaps
                 the child view instantly instead of re-running the page transition. -->
            <Transition name="page" mode="out-in">
              <component :is="Component" :key="route.path.startsWith('/settings/') ? 'settings' : route.path" />
            </Transition>
          </main>
        </div>
      </RouterView>
    </div>
  </Transition>
  <Toaster rich-colors position="bottom-right" />
</template>

<style>
/* Boot: crossfade from the loading screen to the app once the session resolves. */
.boot-enter-active,
.boot-leave-active {
  transition: opacity 0.3s ease;
}
.boot-enter-from,
.boot-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .boot-enter-active,
  .boot-leave-active {
    transition: none;
  }
}

/* Quick fade + nudge between routes; out-in so pages don't overlap. */
.page-enter-active,
.page-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active {
    transition: none;
  }
}

/* Faint control-room grid behind everything. */
.app-grid {
  background-image:
    linear-gradient(to right, color-mix(in oklch, var(--border) 40%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in oklch, var(--border) 40%, transparent) 1px, transparent 1px);
  background-size: 56px 56px;
  background-position: center top;
}
</style>
