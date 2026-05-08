import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// 合并 Tailwind className：先用 clsx 处理条件 class，再用 tailwind-merge 去掉冲突项。
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 生成前端临时 id，适合 mock 数据；正式后端 id 应以服务端返回值为准。
export function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
