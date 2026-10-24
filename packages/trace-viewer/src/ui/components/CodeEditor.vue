<script setup lang="ts">
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { codeHighlight, codeTheme } from '../lib/codemirror'

const props = defineProps<{ lang?: string, placeholder?: string }>()
const model = defineModel<string>({ required: true })

const el = ref<HTMLElement | null>(null)
let view: EditorView | undefined
// Outside changes (a new pick, a reset) replace the text without being reported back as an edit.
let syncing = false

onMounted(() => {
  view = new EditorView({
    parent: el.value!,
    state: EditorState.create({
      doc: model.value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        props.lang === 'javascript' ? javascript() : [],
        placeholderExtension(props.placeholder ?? ''),
        codeHighlight,
        codeTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncing)
            model.value = update.state.doc.toString()
        }),
      ],
    }),
  })
})

watch(model, (value) => {
  if (!view || value === view.state.doc.toString())
    return
  syncing = true
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  syncing = false
})

onBeforeUnmount(() => view?.destroy())
</script>

<template>
  <div ref="el" class="overflow-hidden rounded-md border border-border bg-background text-xs focus-within:border-signal/60" />
</template>
