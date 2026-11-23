import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  h1: ({ children }) => <h1 className="my-3 text-lg font-semibold text-fg">{children}</h1>,
  h2: ({ children }) => <h2 className="my-3 text-base font-semibold text-fg">{children}</h2>,
  h3: ({ children }) => <h3 className="my-2 font-semibold text-fg">{children}</h3>,
  p: ({ children }) => <p className="my-2 whitespace-pre-wrap">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-link pl-3 text-fg-secondary">{children}</blockquote>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto border border-line bg-surface-panel p-3 font-mono text-xs leading-5 text-fg">{children}</pre>,
  code: ({ children, className }) => className
    ? <code className={className}>{children}</code>
    : <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[0.9em] text-warning-fg">{children}</code>,
  a: ({ children, href }) => href && /^(https?:|mailto:)/i.test(href)
    ? <a href={href} target="_blank" rel="noreferrer" className="text-link underline underline-offset-2">{children}</a>
    : <span>{children}</span>,
  table: ({ children }) => <div role="region" aria-label="Scrollable table response" tabIndex={0} className="my-3 max-w-full overflow-x-auto border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"><table className="min-w-full border-collapse text-left text-xs">{children}</table></div>,
  thead: ({ children }) => <thead className="bg-surface-raised text-fg">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-line">{children}</tbody>,
  tr: ({ children }) => <tr className="divide-x divide-line">{children}</tr>,
  th: ({ children }) => <th scope="col" className="whitespace-nowrap border-b border-control-border px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="max-w-80 px-3 py-2 align-top text-fg">{children}</td>,
};

export function MarkdownMessage({ content }: { content: string }) {
  return <div className="min-w-0 text-sm leading-6 [overflow-wrap:anywhere]"><ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown></div>;
}
