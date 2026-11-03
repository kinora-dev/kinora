<script setup lang="ts">
import type { ProjectListing } from '@kinora/core'
import type { ColorMode } from '@kinora/ui/theme'
import type { SessionUser } from '../../../src/bridge'
import { Avatar, AvatarFallback, AvatarImage } from '@kinora/ui/avatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@kinora/ui/dropdown-menu'
import { SegmentedControl } from '@kinora/ui/segmented-control'
import { colorMode } from '@kinora/ui/theme'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@kinora/ui/tooltip'
import { ArrowUpCircle, Check, ChevronsUpDown, ExternalLink, FolderGit2, FolderOpen, LogOut, Monitor, Moon, Settings, Sun } from '@lucide/vue'
import { computed } from 'vue'

const props = defineProps<{ projects: ProjectListing[], activeId: string | null, user: SessionUser | null, projectPath: string | null, highlightLink: boolean, updateReady: boolean }>()
defineEmits<{ select: [id: string], openTrace: [], logout: [], openAccount: [], linkFolder: [], restartUpdate: [] }>()

const isDev = window.kinora.isDev
const isMac = window.kinora.platform === 'darwin'
const active = computed(() => props.projects.find(p => p.id === props.activeId))
const initial = computed(() => (props.user?.name || props.user?.email || '?').charAt(0).toUpperCase())
const folderName = computed(() => props.projectPath?.replace(/\/$/, '').split('/').pop() ?? '')

const themeOptions = [
  { value: 'auto', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]
function setTheme(value: ColorMode): void {
  colorMode.value = value
}
</script>

<template>
  <header class="app-drag sticky top-0 z-30 shrink-0 border-b border-border/80 bg-background/80 backdrop-blur-md">
    <TooltipProvider :delay-duration="150">
      <div class="flex h-12 items-center gap-3 pr-5" :class="isMac ? 'pl-28' : 'pl-5'">
        <div class="flex items-center gap-2.5">
          <span
            class="rec-dot size-2.5 rounded-full bg-signal"
            aria-hidden="true"
          />
          <span class="font-mono text-[15px] font-semibold tracking-tight lowercase">kinora</span>
          <span class="font-mono text-[11px] text-muted-foreground">desktop</span>
          <span v-if="isDev" class="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-amber-400 uppercase">dev</span>
        </div>

        <DropdownMenu v-if="projects.length">
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <span class="max-w-44 truncate">{{ active?.name ?? 'Select project' }}</span>
              <ChevronsUpDown class="size-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-56">
            <DropdownMenuItem
              v-for="p in projects"
              :key="p.id"
              class="gap-2"
              @click="$emit('select', p.id)"
            >
              <Check class="size-4 shrink-0" :class="p.id === activeId ? 'text-signal opacity-100' : 'opacity-0'" />
              <span class="truncate">{{ p.name }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip v-if="active">
          <TooltipTrigger as-child>
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              :class="{ 'link-pulse': highlightLink }"
              @click="$emit('linkFolder')"
            >
              <FolderGit2 class="size-3 opacity-60" />
              <span class="max-w-40 truncate">{{ projectPath ? folderName : 'Link folder' }}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ projectPath ? `Local repo: ${projectPath}` : 'Link a local repo to open & re-run tests' }}</TooltipContent>
        </Tooltip>

        <div class="ml-auto flex items-center gap-4">
          <Tooltip v-if="updateReady">
            <TooltipTrigger as-child>
              <button
                type="button"
                class="flex items-center gap-1.5 rounded-md border border-signal/40 bg-signal/10 px-2.5 py-1.5 font-mono text-xs text-signal transition-colors hover:bg-signal/15"
                @click="$emit('restartUpdate')"
              >
                <ArrowUpCircle class="size-3.5" />
                Restart to update
              </button>
            </TooltipTrigger>
            <TooltipContent>A new version downloaded. Restart to install it.</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                class="flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                @click="$emit('openTrace')"
              >
                <FolderOpen class="size-3 opacity-60" />
                Open trace
              </button>
            </TooltipTrigger>
            <TooltipContent>Open a local trace.zip in the viewer</TooltipContent>
          </Tooltip>
          <DropdownMenu v-if="user">
            <DropdownMenuTrigger as-child>
              <button type="button" class="rounded-full ring-1 ring-signal/30 transition-shadow hover:ring-signal/60" :title="user.name || user.email">
                <Avatar class="size-8">
                  <AvatarImage v-if="user.image" :src="user.image" :alt="user.name" />
                  <AvatarFallback v-else class="bg-signal/15 text-xs font-semibold text-signal">
                    {{ initial }}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-56">
              <DropdownMenuLabel>
                <div class="flex min-w-0 flex-col">
                  <span v-if="user.name && user.name !== user.email" class="truncate text-sm font-medium">{{ user.name }}</span>
                  <span class="truncate text-xs font-normal text-muted-foreground">{{ user.email }}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div class="px-2 py-1.5" @click.stop>
                <p class="mb-1.5 font-mono text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                  Theme
                </p>
                <SegmentedControl
                  icon-only
                  :model-value="colorMode"
                  :options="themeOptions"
                  @update:model-value="(v) => setTheme(v as ColorMode)"
                />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem @click="$emit('openAccount')">
                <Settings class="size-4" />
                Account settings
                <ExternalLink class="ml-auto size-3 opacity-60" />
              </DropdownMenuItem>
              <DropdownMenuItem @click="$emit('logout')">
                <LogOut class="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  </header>
</template>
