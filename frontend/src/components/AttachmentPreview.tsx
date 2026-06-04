import { FileText, Maximize2, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChatMessage, UploadedFile } from "../types/arborlearn";
import { cn } from "../lib/utils";

type MessageAttachment = NonNullable<ChatMessage["attachments"]>[number];
type AttachmentLike = UploadedFile | MessageAttachment;

interface AttachmentPreviewProps {
  file: AttachmentLike;
  onRemove?: () => void;
  variant?: "composer" | "message";
}

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|bmp)$/i;
const ESTIMATED_PARSE_DURATION_MS = 60_000;

function isImageAttachment(file: AttachmentLike) {
  return Boolean(file.mimeType?.startsWith("image/") || IMAGE_EXTENSION.test(file.filename));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function statusText(file: AttachmentLike) {
  if (file.extractionStatus === "pending") return "解析中";
  if (file.extractionStatus === "ready") return "已解析";
  return "解析失败";
}

function statusTitle(file: AttachmentLike) {
  if (file.extractionStatus !== "failed") return file.filename;
  return file.errorMessage ? `解析失败：${file.errorMessage}` : "解析失败";
}

function imageTitle(file: AttachmentLike) {
  if (file.extractionStatus === "failed") return statusTitle(file);
  return "图片附件";
}

function ProcessingSpinner() {
  return (
    <span
      className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary"
      aria-hidden="true"
    />
  );
}

export function AttachmentPreview({ file, onRemove, variant = "composer" }: AttachmentPreviewProps) {
  const isImage = isImageAttachment(file);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [estimatedProgress, setEstimatedProgress] = useState(8);

  useEffect(() => {
    if (!isImage) {
      setObjectUrl(null);
      return;
    }

    if (!file.localFile) {
      setObjectUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(file.localFile);
    setObjectUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [file.id, file.localFile, isImage]);

  useEffect(() => {
    if (file.extractionStatus === "ready") {
      setEstimatedProgress(100);
      return;
    }
    if (file.extractionStatus === "failed") {
      setEstimatedProgress(0);
      return;
    }

    setEstimatedProgress(8);
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const baseProgress = 8 + Math.min(1, elapsedMs / ESTIMATED_PARSE_DURATION_MS) * 82;
      const slowTailProgress = elapsedMs > ESTIMATED_PARSE_DURATION_MS
        ? Math.min(2, ((elapsedMs - ESTIMATED_PARSE_DURATION_MS) / 30_000) * 2)
        : 0;
      const nextProgress = Math.min(92, Math.round(baseProgress + slowTailProgress));
      setEstimatedProgress(nextProgress);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [file.id, file.extractionStatus]);

  const status = statusText(file);
  const title = statusTitle(file);
  const failed = file.extractionStatus === "failed";
  const pending = file.extractionStatus === "pending";
  const ready = file.extractionStatus === "ready";
  const progressText = pending ? `${estimatedProgress}%` : ready ? "100%" : "";

  if (!isImage) {
    return (
      <span
        className={cn(
          "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/55 px-2 text-xs text-muted-foreground",
          variant === "message" && "h-7 bg-background/60 text-[11px]",
        )}
        title={title}
      >
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-40 truncate">{file.filename}</span>
        <span className="text-muted-foreground/70">{formatFileSize(file.fileSize)}</span>
        {pending && <ProcessingSpinner />}
        <span className={failed ? "text-destructive" : "text-muted-foreground/70"}>{status}</span>
        {progressText && <span className="text-muted-foreground/70">{progressText}</span>}
        {onRemove && (
          <button
            type="button"
            className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground"
            title="删除附件"
            aria-label={`删除附件 ${file.filename}`}
            onClick={onRemove}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </span>
    );
  }

  if (!objectUrl) {
    return (
      <span
        className={cn(
          "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background/55 px-2 text-xs text-muted-foreground",
          variant === "message" && "h-7 bg-background/60 text-[11px]",
        )}
        title={imageTitle(file)}
      >
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span>{status}</span>
        {pending && <ProcessingSpinner />}
        {progressText && <span className="text-muted-foreground/70">{progressText}</span>}
        {onRemove && (
          <button
            type="button"
            className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground"
            title="删除图片"
            aria-label="删除图片"
            onClick={onRemove}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </span>
    );
  }

  return (
    <>
      <div
        className={cn(
          "group relative inline-flex w-24 flex-col overflow-hidden rounded-md border border-border/70 bg-background/60 text-xs text-muted-foreground shadow-sm",
          variant === "message" && "w-28",
        )}
        title={imageTitle(file)}
      >
        <div className="relative aspect-video w-full overflow-hidden bg-muted">
          <button
            type="button"
            className="block h-full w-full text-left"
            onClick={() => setIsOpen(true)}
            aria-label="查看图片"
          >
            <img src={objectUrl} alt={file.filename} className="h-full w-full object-cover" />
            <span className="absolute right-1 top-1 rounded bg-black/55 p-1 text-white opacity-0 transition group-hover:opacity-100">
              <Maximize2 className="h-3 w-3" />
            </span>
          </button>
          {onRemove && (
            <button
              type="button"
              className="absolute left-1 top-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-black/55 text-white opacity-0 transition hover:bg-black/70 group-hover:opacity-100"
              title="删除图片"
              aria-label="删除图片"
              onClick={onRemove}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className={cn("flex items-center gap-1 px-1.5 pb-1 text-[11px]", failed ? "text-destructive" : "text-muted-foreground/75")}>
          {pending && <ProcessingSpinner />}
          <span>{status}</span>
          {progressText && <span className="text-muted-foreground/70">{progressText}</span>}
        </div>
      </div>

      {isOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setIsOpen(false)}
        >
          <div className="relative max-h-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="absolute -right-2 -top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-background text-foreground shadow-md"
              title="关闭"
              aria-label="关闭图片预览"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
            <img src={objectUrl} alt={file.filename} className="max-h-[86vh] max-w-full rounded-md object-contain shadow-2xl" />
          </div>
        </div>
      )}
    </>
  );
}
