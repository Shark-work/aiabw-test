// Node 测试 loader：解析 @/* 别名（→src/*.ts）与无扩展相对导入（→.ts）
// 用法: node --experimental-loader ./tests/_paths-loader.mjs --test tests/blindbox-draw.test.mjs
import { pathToFileURL } from "node:url";
import path from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const abs = path.join(process.cwd(), "src", specifier.slice(2)) + ".ts";
    return { url: pathToFileURL(abs).href, shortCircuit: true };
  }
  if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) {
    try {
      const abs = path.resolve(path.dirname(context.parentURL.replace("file:///", "")), specifier) + ".ts";
      const url = pathToFileURL(abs).href;
      const r = await nextResolve(url, context);
      if (r?.url) return { url: r.url, shortCircuit: true };
    } catch {
      /* 回退默认解析 */
    }
  }
  return nextResolve(specifier, context);
}
