import { Check, Copy, GitBranch, RotateCcw, Undo2, Volume2, VolumeX } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useRef, useState } from "react";
import type { ChatMessage } from "../types/arborlearn";
import { useArborLearnStore } from "../store/arborlearnStore";
import { cn } from "../lib/utils";
import { MarkdownContent } from "./MarkdownContent";
import { archiveBackfillPatch } from "../lib/api";

interface MessageBlockProps {
  nodeId: string;
  message: ChatMessage;
}

interface MessageTreeLink {
  id: string;
  text: string;
  matchTexts?: string[];
  title: string;
  summary: string;
  anchorRangeStart?: number;
  anchorRangeEnd?: number;
}

async function sha256(text: string) {
  const bytes = new TextEncoder().encode(text);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256Fallback(bytes);

  const digest = await subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function sha256Fallback(bytes: Uint8Array) {
  const rightRotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  new DataView(padded.buffer).setUint32(paddedLength - 4, bitLength, false);

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const words = new Array<number>(64).fill(0);
    const view = new DataView(padded.buffer, chunk, 64);
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(words[index - 15], 7) ^ rightRotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rightRotate(words[index - 2], 17) ^ rightRotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + constants[index] + words[index]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return `sha256:${hash.map((part) => part.toString(16).padStart(8, "0")).join("")}`;
}

function normalizeSelectionText(text: string) {
  return text.replace(/\u00a0/g, " ").trim();
}

function normalizeSearchText(text: string) {
  return text.replace(/\u00a0/g, " ");
}

function stripInlineMarkdown(text: string) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/gm, "")
    .trim();
}

function buildBackfillLinkMatches(text: string) {
  const candidates = [
    text,
    stripInlineMarkdown(text),
    ...text.split(/\n{2,}/),
    ...stripInlineMarkdown(text).split(/\n{2,}/),
  ];

  return candidates
    .map((candidate) => candidate.trim())
    .filter((candidate, index, array) => candidate.length >= 2 && array.indexOf(candidate) === index);
}

function isMessageTreeLink(link: MessageTreeLink | null): link is MessageTreeLink {
  return Boolean(link);
}

function findOccurrences(text: string, needle: string) {
  const starts: number[] = [];
  if (!needle) return starts;
  let index = text.indexOf(needle);
  while (index >= 0) {
    starts.push(index);
    index = text.indexOf(needle, index + Math.max(needle.length, 1));
  }
  return starts;
}

function isWhitespace(char: string) {
  return /\s/.test(char);
}

function findWhitespaceFlexibleOccurrences(text: string, needle: string) {
  const matches: Array<{ start: number; end: number }> = [];
  if (!needle) return matches;
  const haystack = normalizeSearchText(text);
  const target = normalizeSearchText(needle).trim();
  if (!target) return matches;

  for (let start = 0; start < haystack.length; start += 1) {
    let textIndex = start;
    let targetIndex = 0;

    while (textIndex < haystack.length && targetIndex < target.length) {
      const targetChar = target[targetIndex];
      const textChar = haystack[textIndex];

      if (isWhitespace(targetChar)) {
        if (!isWhitespace(textChar)) break;
        while (targetIndex < target.length && isWhitespace(target[targetIndex])) targetIndex += 1;
        while (textIndex < haystack.length && isWhitespace(haystack[textIndex])) textIndex += 1;
        continue;
      }

      if (targetChar !== textChar) break;
      targetIndex += 1;
      textIndex += 1;
    }

    if (targetIndex === target.length) {
      matches.push({ start, end: textIndex });
    }
  }

  return matches;
}

function buildRenderedMarkdownMap(rawContent: string) {
  let rendered = "";
  const rawByRenderedIndex: number[] = [];
  let lineStart = true;
  let inLinkLabel = false;
  let skipLinkUrl = false;

  for (let index = 0; index < rawContent.length; index += 1) {
    const char = rawContent[index];
    const next = rawContent[index + 1] ?? "";

    if (lineStart) {
      const rest = rawContent.slice(index);
      const marker = rest.match(/^(#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/);
      if (marker) {
        index += marker[0].length - 1;
        lineStart = false;
        continue;
      }
    }

    if (skipLinkUrl) {
      if (char === ")") skipLinkUrl = false;
      continue;
    }
    if (char === "[" && !inLinkLabel) {
      inLinkLabel = true;
      continue;
    }
    if (char === "]" && inLinkLabel && next === "(") {
      inLinkLabel = false;
      skipLinkUrl = true;
      index += 1;
      continue;
    }
    if ((char === "*" && next === "*") || (char === "_" && next === "_") || (char === "~" && next === "~")) {
      index += 1;
      continue;
    }
    if (char === "`" || char === "*" || char === "_") continue;

    rendered += char;
    rawByRenderedIndex.push(index);
    lineStart = char === "\n";
  }

  return { rendered, rawByRenderedIndex };
}

function locateRawMarkdownSelection(rawContent: string, selectedText: string) {
  const target = normalizeSelectionText(selectedText);
  const exactStarts = findOccurrences(rawContent, target);
  if (exactStarts.length === 1) {
    const start = exactStarts[0];
    return buildLocatedSelection(rawContent, start, start + target.length, target);
  }

  const flexibleRawMatches = findWhitespaceFlexibleOccurrences(rawContent, target);
  if (flexibleRawMatches.length === 1) {
    const { start, end } = flexibleRawMatches[0];
    return buildLocatedSelection(rawContent, start, end, rawContent.slice(start, end));
  }

  const mapped = buildRenderedMarkdownMap(rawContent);
  const renderedStarts = findOccurrences(normalizeSearchText(mapped.rendered), target);
  const flexibleRenderedMatches = renderedStarts.length === 1
    ? [{ start: renderedStarts[0], end: renderedStarts[0] + target.length }]
    : findWhitespaceFlexibleOccurrences(mapped.rendered, target);
  if (flexibleRenderedMatches.length !== 1) return null;
  const renderedStart = flexibleRenderedMatches[0].start;
  const renderedEnd = flexibleRenderedMatches[0].end - 1;
  const start = mapped.rawByRenderedIndex[renderedStart];
  const end = mapped.rawByRenderedIndex[renderedEnd] + 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
  return buildLocatedSelection(rawContent, start, end, rawContent.slice(start, end));
}

function buildLocatedSelection(rawContent: string, start: number, end: number, anchorText: string) {
  const paragraphStart = Math.max(rawContent.lastIndexOf("\n\n", start) + 2, 0);
  const nextBreak = rawContent.indexOf("\n\n", end);
  const paragraphEnd = nextBreak >= 0 ? nextBreak : rawContent.length;
  return {
    start,
    end,
    anchorText,
    beforeContext: rawContent.slice(paragraphStart, start),
    afterContext: rawContent.slice(end, paragraphEnd),
    prefix: rawContent.slice(Math.max(0, start - 80), start),
    suffix: rawContent.slice(end, end + 80),
  };
}

function ThinkingIndicator({ label = "正在思考" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className="animate-pulse">{label}</span>
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.24s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.12s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
      </span>
    </div>
  );
}

// 单条聊天消息：根据角色切换左右布局，并把已创建子对话的选中文本渲染为可点击链接。
export function MessageBlock({ nodeId, message }: MessageBlockProps) {
  const nodes = useArborLearnStore((state) => state.nodes);
  const user = useArborLearnStore((state) => state.user);
  const setActiveNode = useArborLearnStore((state) => state.setActiveNode);
  const setSelectionDraft = useArborLearnStore((state) => state.setSelectionDraft);
  const retryAssistantMessage = useArborLearnStore((state) => state.retryAssistantMessage);
  const hydrateFromBackend = useArborLearnStore((state) => state.hydrateFromBackend);
  const isNodeRunning = Boolean(useArborLearnStore((state) => state.chatRunStatusByNode[nodeId]));
  const children = Object.values(nodes).filter((node) => node.parentId === nodeId && node.selectedText);
  const nodeMessages = nodes[nodeId]?.messages ?? [];
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const messageIndex = nodeMessages.findIndex((item) => item.id === message.id);
  const canRetry =
    message.role === "assistant" &&
    messageIndex > 0 &&
    nodeMessages.slice(0, messageIndex).some((item) => item.role === "user");
  const isThinking =
    !isUser &&
    (message.content === "正在思考..." ||
      message.content === "正在联网检索..." ||
      message.content === "正在重新生成...");
  const thinkingLabel = message.content === "正在联网检索..." ? "正在联网检索" : "正在思考";
  const showAttachmentChips = message.role === "user" && (message.attachments?.length ?? 0) > 0;
  const [copied, setCopied] = useState(false);
  const [manualCopyHint, setManualCopyHint] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const userLabel = user?.displayName?.trim() || "用户";
  const [showOriginal, setShowOriginal] = useState(false);
  const patches = message.patches ?? [];
  const hasAppliedPatches = patches.some((patch) => patch.status === "applied");
  const messageTreeLinks: MessageTreeLink[] = [
    ...patches
      .filter((patch) => patch.status === "applied" && patch.sourceChildNodeId && patch.replacementText)
      .map((patch): MessageTreeLink | null => {
        const child = nodes[patch.sourceChildNodeId ?? ""];
        return child
          ? {
              id: child.id,
              text: patch.replacementText,
              matchTexts: buildBackfillLinkMatches(patch.replacementText),
              title: child.title,
              summary: child.summary,
            }
          : null;
      })
      .filter(isMessageTreeLink),
    ...children
      .filter((child) => child.selectedText)
      .map((child) => ({
        id: child.id,
        text: child.selectedText ?? "",
        anchorRangeStart:
          child.sourceMetadata?.type === "backfill_anchor" &&
          child.sourceMetadata.targetMessageId === message.id
            ? child.sourceMetadata.anchorRangeStart
            : undefined,
        anchorRangeEnd:
          child.sourceMetadata?.type === "backfill_anchor" &&
          child.sourceMetadata.targetMessageId === message.id
            ? child.sourceMetadata.anchorRangeEnd
            : undefined,
        title: child.title,
        summary: child.summary,
      })),
  ];

  const copySelectedElement = (element: HTMLElement, restoreOnFailure = true) => {
    const selection = window.getSelection();
    if (!selection) return false;
    const previousRanges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange());
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    let didCopy = false;
    try {
      didCopy = document.execCommand("copy");
      return didCopy;
    } finally {
      if (didCopy || restoreOnFailure) {
        selection.removeAllRanges();
        previousRanges.forEach((previousRange) => selection.addRange(previousRange));
      }
    }
  };

  const writeToClipboard = async (content: string, sourceElement: HTMLElement | null) => {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(content);
        return "copied";
      } catch {
        // Fall back to the selection-based copy path below.
      }
    }

    let copiedFromEvent = false;
    const handleCopyEvent = (event: ClipboardEvent) => {
      event.clipboardData?.setData("text/plain", content);
      event.preventDefault();
      copiedFromEvent = true;
    };
    document.addEventListener("copy", handleCopyEvent);
    try {
      const didCopy = document.execCommand("copy");
      if (copiedFromEvent || didCopy) return "copied";
    } finally {
      document.removeEventListener("copy", handleCopyEvent);
    }

    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "0";
    textarea.style.top = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    try {
      if (document.execCommand("copy")) return "copied";
    } finally {
      document.body.removeChild(textarea);
      activeElement?.focus();
    }

    if (sourceElement) {
      return copySelectedElement(sourceElement, false) ? "copied" : "selected";
    }

    return "failed";
  };

  const handleCopy = async () => {
    const copyResult = await writeToClipboard(message.content, contentRef.current);
    const didCopy = copyResult === "copied";
    setCopied(didCopy);
    setManualCopyHint(copyResult === "selected");
    if (didCopy) window.setTimeout(() => setCopied(false), 1600);
    if (copyResult === "selected") window.setTimeout(() => setManualCopyHint(false), 2200);
  };

  const handleSpeak = () => {
    if (!("speechSynthesis" in window)) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message.content);
    utterance.lang = /[\u4e00-\u9fff]/.test(message.content) ? "zh-CN" : "en-US";
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleRetry = () => {
    if (!canRetry) return;
    if (hasAppliedPatches) {
      const confirmed = window.confirm(
        "重新生成会替换这条回复，并使这条回复上的所有回填失效。原回填记录会被归档，后续上下文不再使用它们。",
      );
      if (!confirmed) return;
    }
    retryAssistantMessage(nodeId, message.id);
  };

  const handleMouseUp = async () => {
    if (isSystem) return;
    const selection = window.getSelection();
    const text = normalizeSelectionText(selection?.toString() ?? "");
    if (!selection || !text || text.length < 2 || selection.rangeCount === 0) return;
    const rawContent = message.originalContent || message.content;
    const located = locateRawMarkdownSelection(rawContent, text);
    const range = selection.getRangeAt(0);
    setSelectionDraft({
      text,
      rect: range.getBoundingClientRect(),
      sourceNodeId: nodeId,
      sourceMetadata: located
        ? {
            type: "backfill_anchor",
            parentNodeId: nodeId,
            targetMessageId: message.id,
            targetMessageRole: message.role,
            targetMessageCreatedAt: message.createdAt,
            baseMessageContentHash: await sha256(rawContent),
            baseContentLength: rawContent.length,
            coordinateSpace: "raw_markdown",
            selectorStrategy: "dom_to_raw_exact",
            anchorRangeStart: located.start,
            anchorRangeEnd: located.end,
            anchorText: located.anchorText,
            anchorPrefix: located.prefix,
            anchorSuffix: located.suffix,
            beforeContext: located.beforeContext,
            afterContext: located.afterContext,
          }
        : undefined,
    });
  };

  const archivePatch = async (patchId: string) => {
    await archiveBackfillPatch(patchId);
    await hydrateFromBackend();
  };

  const renderLinkedContent = () => {
    // 逐个查找当前节点下由 selectedText 创建的子节点，把原文片段替换为链接按钮。
    let content: Array<string | ReactElement> = [message.content];

    messageTreeLinks.forEach((link) => {
      const childSummary = link.summary.trim() || "摘要将在子对话更新后生成。";
      content = content.flatMap((part) => {
        // ReactElement 不再继续切分；没有匹配片段时保持原样。
        if (typeof part !== "string") return [part];
        const matchText = [link.text, ...(link.matchTexts ?? [])]
          .map((candidate) => candidate.trim())
          .filter(Boolean)
          .find((candidate) => part.includes(candidate));
        if (!matchText) return [part];

        const [before, ...rest] = part.split(matchText);

        return [
          before,
          <span key={`${message.id}-${link.id}`} className="relative inline-flex">
            <button className="tree-link peer" onClick={() => setActiveNode(link.id)}>
              {matchText}
            </button>
            {/* 使用 peer-hover 限定触发区域：只有鼠标真正悬停在超链接按钮上时才显示预览。 */}
            <span className="tl-panel pointer-events-none absolute bottom-full left-0 z-40 mb-2 hidden w-72 rounded-md border bg-card/92 p-3 text-left text-sm leading-6 shadow-panel backdrop-blur-md peer-hover:block peer-focus:block">
              <span className="mb-2 flex items-center gap-2 font-medium text-foreground">
                <GitBranch className="tl-brand h-4 w-4" />
                {link.title}
              </span>
              <span className="line-clamp-3 block text-muted-foreground">{childSummary}</span>
            </span>
          </span>,
          rest.join(matchText),
        ];
      });
    });

    return content;
  };

  if (isSystem) {
    // system 消息作为时间线提示展示，不进入左右气泡对话样式。
    return (
      <div className="flex justify-center px-2">
        <div className="max-w-[78%] rounded-full border border-border bg-muted px-3 py-2 text-center text-xs leading-5 text-muted-foreground">
          {renderLinkedContent()}
        </div>
      </div>
    );
  }

  return (
    <article className={cn("tl-message-row flex w-full px-2", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("tl-message-wrap group flex max-w-[82%] flex-col md:max-w-[72%]", isUser ? "items-end" : "items-start")}>
        <div
        data-tour-message-role={message.role}
        data-tour-message-id={message.id}
        className={cn(
          "tl-message-bubble rounded-[1.15rem] px-4 py-3 text-sm leading-7 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md",
          isUser
            ? "rounded-br-md border"
            : "tl-assistant-message tl-panel rounded-bl-md border text-card-foreground",
        )}
        style={
          isUser
            ? {
                background: "var(--tl-user-bubble)",
                borderColor: "var(--tl-user-bubble-border)",
                color: "var(--tl-user-bubble-fg)",
              }
            : undefined
        }
        onMouseUp={handleMouseUp}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className={cn("text-xs font-semibold", isUser ? "opacity-70" : "text-muted-foreground")}>
            {isUser ? userLabel : "ArborLearn AI"}
          </span>
          <div className="flex items-center gap-2">
            {message.stale && (
              <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                回填前生成
              </span>
            )}
            {hasAppliedPatches && (
              <button
                className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowOriginal((current) => !current);
                }}
              >
                {showOriginal ? "查看回填" : "包含回填"}
              </button>
            )}
          </div>
        </div>
        {showOriginal && message.originalContent && (
          <div className="mb-3 rounded-lg border border-dashed border-border bg-muted/45 px-3 py-2 text-xs leading-5 text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">原文</p>
            <p className="whitespace-pre-wrap">{message.originalContent}</p>
          </div>
        )}
        {showAttachmentChips && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {(message.attachments ?? []).map((file) => (
              <span
                key={file.id}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/70 bg-background/60 px-2 text-[11px] text-muted-foreground"
                title={file.errorMessage ?? file.filename}
              >
                <span className="max-w-36 truncate">{file.filename}</span>
              </span>
            ))}
          </div>
        )}
        <div ref={contentRef}>
          {isThinking ? (
            <ThinkingIndicator label={thinkingLabel} />
          ) : isUser ? (
            <p className="whitespace-pre-wrap break-words">{renderLinkedContent()}</p>
          ) : (
            <MarkdownContent
              content={message.content}
              treeLinks={messageTreeLinks}
              onTreeLinkClick={setActiveNode}
            />
          )}
        </div>
        </div>
        {!isThinking && (
          <div className={cn("tl-reveal-actions mt-1 flex items-center gap-1 px-1 text-muted-foreground", isUser ? "justify-end" : "justify-start")}>
            <MessageActionButton title="复制" onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </MessageActionButton>
            {manualCopyHint && <span className="px-1 text-[11px]">已选中，按 ⌘C 复制</span>}
            {!isUser && (
              <>
                <MessageActionButton title={isSpeaking ? "停止朗读" : "朗读"} onClick={handleSpeak}>
                  {isSpeaking ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </MessageActionButton>
                {canRetry && (
                  <MessageActionButton
                    title="重试"
                    onClick={handleRetry}
                    disabled={isNodeRunning}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </MessageActionButton>
                )}
                {patches.map((patch) => (
                  <MessageActionButton
                    key={patch.id}
                    title="撤回回填"
                    onClick={() => void archivePatch(patch.id)}
                    disabled={isNodeRunning}
                  >
                    <Undo2 className="h-4 w-4" />
                  </MessageActionButton>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function MessageActionButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}
