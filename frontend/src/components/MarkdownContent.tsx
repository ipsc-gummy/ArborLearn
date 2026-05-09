import { GitBranch } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ComponentProps, ReactNode } from "react";

interface TreeLink {
  id: string;
  text: string;
  title: string;
  summary: string;
}

interface MarkdownContentProps {
  content: string;
  treeLinks?: TreeLink[];
  onTreeLinkClick?: (nodeId: string) => void;
}

function TreeLinkPreview({
  link,
  onTreeLinkClick,
}: {
  link: TreeLink;
  onTreeLinkClick?: (nodeId: string) => void;
}) {
  const summary = link.summary.trim() || "摘要将在子对话更新后生成。";

  return (
    <span className="relative inline-flex">
      <button className="tree-link peer" onClick={() => onTreeLinkClick?.(link.id)}>
        {link.text}
      </button>
      <span className="tl-panel pointer-events-none absolute bottom-full left-0 z-40 mb-2 hidden w-72 rounded-md border bg-card/92 p-3 text-left text-sm leading-6 shadow-panel backdrop-blur-md peer-hover:block peer-focus:block">
        <span className="mb-2 flex items-center gap-2 font-medium text-foreground">
          <GitBranch className="tl-brand h-4 w-4" />
          {link.title}
        </span>
        <span className="line-clamp-3 block text-muted-foreground">{summary}</span>
      </span>
    </span>
  );
}

function renderTreeLinkedText(text: string, treeLinks: TreeLink[], onTreeLinkClick?: (nodeId: string) => void) {
  const nodes: ReactNode[] = [];
  let rest = text;
  let keyIndex = 0;

  while (rest) {
    const nextLink = treeLinks
      .filter((link) => link.text && rest.includes(link.text))
      .map((link) => ({ link, index: rest.indexOf(link.text) }))
      .sort((a, b) => a.index - b.index)[0];

    if (!nextLink) {
      nodes.push(rest);
      break;
    }

    if (nextLink.index > 0) nodes.push(rest.slice(0, nextLink.index));
    nodes.push(
      <TreeLinkPreview
        key={`${nextLink.link.id}-${keyIndex}`}
        link={nextLink.link}
        onTreeLinkClick={onTreeLinkClick}
      />,
    );
    rest = rest.slice(nextLink.index + nextLink.link.text.length);
    keyIndex += 1;
  }

  return nodes;
}

function renderTreeLinkedChildren(
  children: ReactNode,
  treeLinks: TreeLink[],
  onTreeLinkClick?: (nodeId: string) => void,
): ReactNode {
  if (typeof children === "string") {
    return renderTreeLinkedText(children, treeLinks, onTreeLinkClick);
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <span key={index}>{renderTreeLinkedChildren(child, treeLinks, onTreeLinkClick)}</span>
    ));
  }

  return children;
}

export function MarkdownContent({ content, treeLinks = [], onTreeLinkClick }: MarkdownContentProps) {
  return (
    <div className="space-y-3 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p({ children }) {
            return (
              <p className="whitespace-pre-wrap">
                {renderTreeLinkedChildren(children, treeLinks, onTreeLinkClick)}
              </p>
            );
          },
          h1({ children }) {
            return <h1 className="text-lg font-semibold leading-7">{renderTreeLinkedChildren(children, treeLinks, onTreeLinkClick)}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-base font-semibold leading-7">{renderTreeLinkedChildren(children, treeLinks, onTreeLinkClick)}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-sm font-semibold leading-6">{renderTreeLinkedChildren(children, treeLinks, onTreeLinkClick)}</h3>;
          },
          ul({ children }) {
            return <ul className="list-disc space-y-1 pl-5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal space-y-1 pl-5">{children}</ol>;
          },
          li({ children }) {
            return <li className="pl-1">{renderTreeLinkedChildren(children, treeLinks, onTreeLinkClick)}</li>;
          },
          strong({ children }) {
            return <strong>{renderTreeLinkedChildren(children, treeLinks, onTreeLinkClick)}</strong>;
          },
          em({ children }) {
            return <em>{renderTreeLinkedChildren(children, treeLinks, onTreeLinkClick)}</em>;
          },
          del({ children }) {
            return <del>{renderTreeLinkedChildren(children, treeLinks, onTreeLinkClick)}</del>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
                {renderTreeLinkedChildren(children, treeLinks, onTreeLinkClick)}
              </blockquote>
            );
          },
          a({ children, href }) {
            return (
              <a className="tree-link" href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          code({ inline, className, children, ...props }: ComponentProps<"code"> & { inline?: boolean }) {
            if (inline) {
              return (
                <code className="rounded bg-muted px-1.5 py-0.5 text-[0.92em]" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre({ children }) {
            return (
              <pre className="overflow-x-auto rounded-xl border border-border bg-muted p-3 text-xs leading-6">
                {children}
              </pre>
            );
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="min-w-full border-collapse text-left text-sm">{children}</table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-muted/70">{children}</thead>;
          },
          th({ children }) {
            return (
              <th className="border-b border-border px-3 py-2 font-semibold">
                {renderTreeLinkedChildren(children, treeLinks, onTreeLinkClick)}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border-t border-border px-3 py-2 align-top">
                {renderTreeLinkedChildren(children, treeLinks, onTreeLinkClick)}
              </td>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
