import { EditorView } from '@uiw/react-codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const DARK_EDITOR_THEME = EditorView.theme({
  '&': {
    backgroundColor: '#1e1e1e',
    color: '#d4d4d4',
  },
  '.cm-content': {
    caretColor: '#aeafad',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#aeafad',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#264f78',
  },
  '.cm-panels': {
    backgroundColor: '#1e1e1e',
    color: '#d4d4d4',
  },
  '.cm-gutters': {
    backgroundColor: '#252526',
    color: '#858585',
    borderRight: '1px solid #2d2d2d',
  },
  '.cm-activeLine': {
    backgroundColor: '#2a2d2e',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#2a2d2e',
    color: '#c6c6c6',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: '#515c6a',
    outline: '1px solid #515c6a',
  },
  '.cm-tooltip': {
    border: '1px solid #454545',
    backgroundColor: '#252526',
  },
}, { dark: true });

const LIGHT_EDITOR_THEME = EditorView.theme({
  '&': {
    backgroundColor: '#ffffff',
    color: '#1e1e1e',
  },
  '.cm-content': {
    caretColor: '#000000',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#000000',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#add6ff',
  },
  '.cm-panels': {
    backgroundColor: '#ffffff',
    color: '#1e1e1e',
  },
  '.cm-gutters': {
    backgroundColor: '#f3f3f3',
    color: '#237893',
    borderRight: '1px solid #dddddd',
  },
  '.cm-activeLine': {
    backgroundColor: '#f5f5f5',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#eaeaea',
    color: '#0b216f',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: '#d7d4f0',
    outline: '1px solid #b9b4d0',
  },
  '.cm-tooltip': {
    border: '1px solid #c8c8c8',
    backgroundColor: '#ffffff',
  },
}, { dark: false });

const DARK_HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: '#569cd6' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: '#9cdcfe' },
  { tag: [t.propertyName], color: '#9cdcfe' },
  { tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)], color: '#ce9178' },
  { tag: [t.function(t.variableName), t.labelName], color: '#dcdcaa' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#4fc1ff' },
  { tag: [t.definition(t.name), t.separator], color: '#d4d4d4' },
  { tag: [t.className, t.typeName], color: '#4ec9b0' },
  { tag: [t.number, t.changed, t.annotation, t.bool, t.special(t.variableName)], color: '#b5cea8' },
  { tag: [t.meta], color: '#d4d4d4' },
  { tag: [t.comment], color: '#6a9955' },
  { tag: [t.invalid], color: '#f44747' },
  { tag: [t.regexp], color: '#d16969' },
  { tag: [t.attributeName], color: '#92c5f8' },
]);

const LIGHT_HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: '#0000ff' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: '#001080' },
  { tag: [t.propertyName], color: '#001080' },
  { tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)], color: '#a31515' },
  { tag: [t.function(t.variableName), t.labelName], color: '#795e26' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#0070c1' },
  { tag: [t.definition(t.name), t.separator], color: '#1e1e1e' },
  { tag: [t.className, t.typeName], color: '#267f99' },
  { tag: [t.number, t.changed, t.annotation, t.bool, t.special(t.variableName)], color: '#098658' },
  { tag: [t.meta], color: '#1e1e1e' },
  { tag: [t.comment], color: '#008000' },
  { tag: [t.invalid], color: '#cd3131' },
  { tag: [t.regexp], color: '#811f3f' },
  { tag: [t.attributeName], color: '#e50000' },
]);

export function vscodeCodeThemeExtension(themeMode = 'light') {
  if (themeMode === 'dark') {
    return [DARK_EDITOR_THEME, syntaxHighlighting(DARK_HIGHLIGHT_STYLE)];
  }
  return [LIGHT_EDITOR_THEME, syntaxHighlighting(LIGHT_HIGHLIGHT_STYLE)];
}
