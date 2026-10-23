<script setup lang="ts">
import type { DecorationSet } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { basicSetup } from 'codemirror'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface SourceError { line: number, message: string }

const props = defineProps<{ code: string, errors?: SourceError[], lang?: string, highlightLine?: number }>()

const el = ref<HTMLElement | null>(null)
let view: EditorView | undefined

// Colors come from CSS vars (defined in style.css), so one style adapts to light/dark.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier, t.self], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string), t.attributeValue], color: 'var(--code-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.number, t.integer, t.float], color: 'var(--code-number)' },
  { tag: [t.bool, t.null, t.atom, t.constant(t.variableName)], color: 'var(--code-constant)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'var(--code-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--code-type)' },
  { tag: [t.propertyName, t.special(t.propertyName)], color: 'var(--code-property)' },
  { tag: [t.variableName, t.definition(t.variableName), t.labelName], color: 'var(--code-variable)' },
  { tag: [t.operator, t.derefOperator, t.compareOperator, t.logicOperator, t.arithmeticOperator, t.bitwiseOperator], color: 'var(--code-operator)' },
  { tag: [t.punctuation, t.separator, t.bracket, t.brace, t.paren, t.squareBracket, t.angleBracket], color: 'var(--code-punctuation)' },
  { tag: [t.regexp, t.escape], color: 'var(--code-regexp)' },
  { tag: t.tagName, color: 'var(--code-tag)' },
  { tag: t.attributeName, color: 'var(--code-attribute)' },
  { tag: t.invalid, color: 'var(--fail)' },
])

// Chrome + search panel, all driven by our design tokens.
const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--background)', height: '100%', color: 'var(--foreground)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--foreground)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-gutters': { backgroundColor: 'var(--background)', color: 'color-mix(in oklch, var(--muted-foreground) 80%, transparent)', border: 'none', borderRight: '1px solid var(--border)', zIndex: '2' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--background)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'color-mix(in oklch, var(--signal) 28%, transparent)' },
  '.cm-targetLine': { backgroundColor: 'color-mix(in oklch, var(--signal) 16%, transparent)' },
  '.cm-errorLine': { backgroundColor: 'color-mix(in oklch, var(--fail) 14%, transparent)' },
  '.cm-errorMessage': { borderLeft: '2px solid var(--fail)', backgroundColor: 'color-mix(in oklch, var(--fail) 8%, transparent)', color: 'var(--fail)', fontFamily: 'var(--font-mono)', padding: '4px 10px', whiteSpace: 'pre-wrap' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, var(--flaky) 35%, transparent)', borderRadius: '2px', outline: '1px solid color-mix(in oklch, var(--flaky) 50%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklch, var(--signal) 45%, transparent)', outline: '1px solid var(--signal)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in oklch, var(--foreground) 10%, transparent)' },
  // search panel
  '.cm-panels': { backgroundColor: 'var(--card)', color: 'var(--foreground)', borderTop: '1px solid var(--border)' },
  '.cm-panel.cm-search': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', padding: '6px 8px', fontFamily: 'var(--font-sans)', fontSize: '12px' },
  '.cm-panel.cm-search br': { display: 'none' },
  '.cm-textfield': { backgroundColor: 'var(--background)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--foreground)', padding: '3px 8px', fontSize: '12px' },
  '.cm-textfield:focus-visible': { outline: 'none', borderColor: 'var(--signal)', boxShadow: '0 0 0 2px color-mix(in oklch, var(--signal) 25%, transparent)' },
  '.cm-button': { backgroundColor: 'var(--muted)', backgroundImage: 'none', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--foreground)', padding: '3px 8px', fontSize: '12px', cursor: 'pointer' },
  '.cm-button:hover': { backgroundColor: 'var(--accent)' },
  '.cm-button:active': { backgroundColor: 'var(--accent)' },
  '.cm-panel.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--muted-foreground)', fontSize: '11px' },
  '.cm-panel.cm-search input[type=checkbox]': { accentColor: 'var(--signal)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--muted-foreground)', cursor: 'pointer', fontSize: '16px' },
  '.cm-panel.cm-search [name=close]:hover': { color: 'var(--foreground)' },
})

function langExtension() {
  if (props.lang === 'md')
    return markdown()
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
      syntaxHighlighting(highlight),
      theme,
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
