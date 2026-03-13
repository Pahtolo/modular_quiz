import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import renderMathInElement from 'katex/contrib/auto-render';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

import { openExternal } from './api';
import {
  AUTO_INLINE_MATH_CLOSE,
  AUTO_INLINE_MATH_OPEN,
  autoFormatMathMarkdown,
} from './markdownMathAutoFormat';

const KATEX_DELIMITERS = [
  { left: AUTO_INLINE_MATH_OPEN, right: AUTO_INLINE_MATH_CLOSE, display: false },
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false },
  { left: '\\(', right: '\\)', display: false },
  { left: '\\[', right: '\\]', display: true },
];

export default function MarkdownMathText({ className, text, autoFormatMath = false }) {
  const ref = useRef(null);
  const renderedText = autoFormatMath ? autoFormatMathMarkdown(text) : String(text || '');

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    renderMathInElement(ref.current, {
      delimiters: KATEX_DELIMITERS,
      throwOnError: false,
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
    });
  }, [renderedText]);

  return (
    <div ref={ref} className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
        components={{
          a: ({ node, href, children, ...props }) => {
            void node;
            const targetHref = String(href || '').trim();
            if (!targetHref) {
              return <span>{children}</span>;
            }
            return (
              <a
                {...props}
                href={targetHref}
                onClick={(event) => {
                  event.preventDefault();
                  void openExternal(targetHref);
                }}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {renderedText}
      </ReactMarkdown>
    </div>
  );
}
