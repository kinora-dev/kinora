<script setup lang="ts">
import type { DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { codeHighlight, codeTheme } from '../lib/codemirror'

export interface EditorError { line: number, column: number, message: string }

const props = defineProps<{ errors?: EditorError[], lang?: string, placeholder?: string }>()
const model = defineModel<string>({ required: true })

const el = ref<HTMLElement | null>(null)
let view: EditorView | undefined

const setErrors = StateEffect.define<EditorError[]>()

// Each error underlines its line from the reported column (1-based), with the message as a tooltip.
function errorDecorations(state: EditorState, errors: EditorError[]): DecorationSet {
  const ranges = errors
    .filter(error => error.line >= 1 && error.line <= state.doc.lines)
    .map((error) => {
      const line = state.doc.line(error.line)
      const from = Math.min(line.from + Math.max(error.column - 1, 0), line.to)
      return from < line.to
        ? Decoration.mark({ class: 'cm-subtleError', attributes: { title: error.message } }).range(from, line.to)
        : Decoration.line({ class: 'cm-subtleErrorLine', attributes: { title: error.message } }).range(line.from)
    })
  return Decoration.set(ranges, true)
}

const errorsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (deco, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setErrors))
        return errorDecorations(tr.state, effect.value)
    }
    return deco.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})

const errorTheme = EditorView.theme({
  '.cm-subtleError': { textDecoration: 'underline wavy var(--fail)', textUnderlineOffset: '3px' },
  '.cm-subtleErrorLine': { backgroundColor: 'color-mix(in oklch, var(--fail) 10%, transparent)' },
})
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
        errorsField,
        errorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncing)
            model.value = update.state.doc.toString()
        }),
      ],
    }),
  })
  if (props.errors?.length)
    view.dispatch({ effects: setErrors.of(props.errors) })
})

watch(model, (value) => {
  if (!view || value === view.state.doc.toString())
    return
  syncing = true
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  syncing = false
})

watch(() => props.errors, errors => view?.dispatch({ effects: setErrors.of(errors ?? []) }), { deep: true })

onBeforeUnmount(() => view?.destroy())
</script>

<template>
  <div ref="el" class="overflow-hidden rounded-md border border-border bg-background text-xs focus-within:border-signal/60" />
</template>
