import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import MarkdownMathText from './MarkdownMathText';
import { openExternal } from './api';

const KATEX_REFERENCE_URL = 'https://katex.org/docs/supported';
const KATEX_REFERENCE_SECTIONS = [
  {
    title: 'Delimiters',
    items: [
      {
        label: 'Inline math',
        input: '$x^2 + y^2 = z^2$',
      },
      {
        label: 'Display math',
        input: '$$\\int_0^1 x^2\\,dx$$',
      },
    ],
  },
  {
    title: 'Core Syntax',
    items: [
      {
        label: 'Fractions',
        input: '$\\frac{a+b}{c+d}$',
      },
      {
        label: 'Roots',
        input: '$\\sqrt{x^2 + 1}$\n\n$\\sqrt[3]{8}$',
        preview: '$\\sqrt{x^2 + 1}$\n\n$\\sqrt[3]{8}$',
      },
      {
        label: 'Superscripts and subscripts',
        input: '$a_{ij} = x_i^2 + y_j^2$',
      },
    ],
  },
  {
    title: 'Symbols',
    items: [
      {
        label: 'Greek letters',
        input: '$\\alpha + \\beta = \\gamma$',
      },
      {
        label: 'Relations',
        input: '$x \\le y \\neq z \\approx w$',
      },
      {
        label: 'Sets and logic',
        input: '$A \\subseteq B \\Rightarrow x \\in B$',
      },
    ],
  },
  {
    title: 'Structures',
    items: [
      {
        label: 'Matrices',
        input: '$$\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}$$',
      },
      {
        label: 'Cases',
        input: '$$f(x)=\\begin{cases}x^2 & \\text{if } x>0 \\\\ 0 & \\text{otherwise}\\end{cases}$$',
      },
    ],
  },
  {
    title: 'Calculus and Sums',
    items: [
      {
        label: 'Summation',
        input: '$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$',
      },
      {
        label: 'Integral',
        input: '$\\int_0^{\\infty} e^{-x}\\,dx = 1$',
      },
      {
        label: 'Limits',
        input: '$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$',
      },
    ],
  },
  {
    title: 'App Shortcut',
    items: [
      {
        label: 'Auto-formatted plain algebra',
        input: 'x^2 + y^2 = z^2',
        preview: '$x^2 + y^2 = z^2$',
        note: 'With the KaTeX toggle on, simple algebra like this can auto-render without typing $...$.',
      },
    ],
  },
];

export default function KaTeXReferenceDialog({ open, onClose }) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="short-answer-katex-reference-overlay"
      onClick={onClose}
    >
      <div
        className="card short-answer-katex-reference-card"
        role="dialog"
        aria-modal="true"
        aria-label="KaTeX reference"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="short-answer-katex-reference-header">
          <div className="short-answer-katex-reference-intro">
            <h3>KaTeX Reference</h3>
            <p>
              This guide covers the common syntax you can use in Modular Quiz.
              For the complete supported-function list, open the official KaTeX docs.
            </p>
          </div>
          <div className="short-answer-katex-reference-actions">
            <button
              type="button"
              onClick={() => {
                void openExternal(KATEX_REFERENCE_URL);
              }}
            >
              Full Docs
            </button>
            <button type="button" className="secondary" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="short-answer-katex-reference-note">
          Use <code>$...$</code> for inline math and <code>$$...$$</code> for display math.
        </div>

        <div className="short-answer-katex-reference-body">
          {KATEX_REFERENCE_SECTIONS.map((section) => (
            <section key={section.title} className="short-answer-katex-reference-section">
              <h4>{section.title}</h4>
              <div className="short-answer-katex-reference-grid">
                {section.items.map((item) => (
                  <article key={`${section.title}-${item.label}`} className="short-answer-katex-reference-item">
                    <div className="short-answer-katex-reference-item-label">{item.label}</div>
                    <pre className="short-answer-katex-reference-code">{item.input}</pre>
                    {item.note ? (
                      <div className="short-answer-katex-reference-item-note">{item.note}</div>
                    ) : null}
                    <div className="short-answer-katex-reference-preview-label">Preview</div>
                    <div className="short-answer-katex-reference-preview">
                      <MarkdownMathText
                        className="math-text markdown-math-content"
                        text={item.preview || item.input}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
