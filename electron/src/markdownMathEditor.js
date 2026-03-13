import katex from 'katex';
import {
  Decoration,
  EditorView,
  RangeSetBuilder,
  ViewPlugin,
  WidgetType,
} from '@uiw/react-codemirror';

import { collectMarkdownMathRanges } from './markdownMathAutoFormat.js';

class MarkdownMathWidget extends WidgetType {
  constructor(expression, display) {
    super();
    this.expression = expression;
    this.display = display;
  }

  eq(other) {
    return other.expression === this.expression && other.display === this.display;
  }

  toDOM() {
    const element = document.createElement(this.display ? 'div' : 'span');
    element.className = `cm-markdown-math-widget ${this.display ? 'display' : 'inline'}`;

    try {
      katex.render(this.expression, element, {
        displayMode: this.display,
        throwOnError: false,
      });
    } catch (error) {
      void error;
      element.textContent = this.expression;
    }

    return element;
  }
}

export function selectionTouchesMathRange(selection, from, to) {
  return selection.ranges.some((range) => {
    if (range.empty) {
      return range.head >= from && range.head < to;
    }
    return range.from < to && range.to > from;
  });
}

function buildMathDecorations(view) {
  const builder = new RangeSetBuilder();
  const ranges = collectMarkdownMathRanges(view.state.doc.toString(), { autoFormatMath: true });

  for (const range of ranges) {
    if (selectionTouchesMathRange(view.state.selection, range.from, range.to)) {
      continue;
    }

    builder.add(
      range.from,
      range.to,
      Decoration.replace({
        widget: new MarkdownMathWidget(range.expression, range.display),
      }),
    );
  }

  return builder.finish();
}

export const markdownMathEditorExtension = [
  EditorView.lineWrapping,
  ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = buildMathDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = buildMathDecorations(update.view);
      }
    }
  }, {
    decorations: (plugin) => plugin.decorations,
  }),
];
