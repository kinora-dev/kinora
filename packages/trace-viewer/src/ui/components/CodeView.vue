<script setup lang="ts">
import type { DecorationSet } from '@codemirror/view'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { markdown } from '@codemirror/lang-markdown'
import { xml } from '@codemirror/lang-xml'
import { EditorState, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { codeHighlight, codeTheme } from '../lib/codemirror'

export interface SourceError { line: number, message: string }

const props = defineProps<{ code: string, errors?: SourceError[], lang?: string, highlightLine?: number }>()

const el = ref<HTMLElement | null>(null)
let view: EditorView | undefined

function langExtension() {
  if (props.lang === 'md')
    return markdown()
  if (props.lang === 'css')
    return css()
  if (props.lang === 'html')
    return html()
  if (props.lang === 'xml')
    return xml()
  if (props.lang === 'text')
    return []
  const ts = props.lang === 'ts' || props.lang === 'tsx'
  const jsx = props.lang === 'tsx' || props.lang === 'jsx'
  return javascript({ typescript: ts, jsx })
}

class ErrorMessageWidget extends WidgetType {
  constructor(readonly message: string) {
    super()
  }

  eq(other: ErrorMessageWidget): boolean {
    return other.message === this.message
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-errorMessage'
    el.textContent = this.message
    return el
  }
}

function lineDecorations(state: EditorState): DecorationSet {
  const ranges = []
  const target = props.highlightLine
  const errorLines = new Set<number>()
  for (const error of props.errors ?? []) {
    if (error.line < 1 || error.line > state.doc.lines)
      continue
    const line = state.doc.line(error.line)
    if (!errorLines.has(error.line))
      ranges.push(Decoration.line({ class: 'cm-errorLine' }).range(line.from))
    errorLines.add(error.line)
    ranges.push(Decoration.widget({ block: true, side: 1, widget: new ErrorMessageWidget(error.message) }).range(line.to))
  }
  if (target && target >= 1 && target <= state.doc.lines)
    ranges.push(Decoration.line({ class: 'cm-targetLine' }).range(state.doc.line(target).from))
  return Decoration.set(ranges, true)
}

// Block widgets must come from a state field, not a view plugin.
const decorationsField = StateField.define<DecorationSet>({
  create: state => lineDecorations(state),
  update: (deco, tr) => (tr.docChanged ? lineDecorations(tr.state) : deco),
  provide: f => EditorView.decorations.from(f),
})

function buildState(): EditorState {
  return EditorState.create({
    doc: props.code,
    extensions: [
      basicSetup,
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      EditorView.contentAttributes.of({ tabindex: '0' }),
      langExtension(),
      decorationsField,
      codeHighlight,
      codeTheme,
    ],
  })
}

function scrollToTarget(): void {
  const line = props.highlightLine
  if (!view || !line || line > view.state.doc.lines)
    return
  const pos = view.state.doc.line(line).from
  view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
}

onMounted(() => {
  view = new EditorView({ state: buildState(), parent: el.value! })
  scrollToTarget()
})

watch([() => props.code, () => props.errors, () => props.lang, () => props.highlightLine], () => {
  view?.setState(buildState())
  scrollToTarget()
})

onBeforeUnmount(() => view?.destroy())
</script>

<template>
  <div ref="el" class="h-full overflow-hidden text-xs" />
</template>
