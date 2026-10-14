/**
 * Rive 资产上架探测（**服务端专用**：node:fs——客户端组件禁止 import 本模块）。
 *
 * 背景：worker-cat.riv 二进制资产由美术交付、随部署上架。未上架期间
 * /api/pet/play|movie 聚合响应下发 riveAvailable=false，前端**零请求直降**
 * 静态立绘（不再产生 404 / console.error / toast 噪音）；资产随部署上架后
 * 同一代码自动切换 Rive 渲染——本探测即「自动切换」的开关。
 *
 * 部署红线：.riv 为运行时 fs 读取（非静态 import），必须经 next.config
 * outputFileTracingIncludes 纳入 serverless 文件追踪（已覆盖
 * /api/pet/asset|play|movie），否则部署后 existsSync 恒 false。
 */

import { existsSync } from "node:fs";
import path from "node:path";

/** 与 /api/pet/asset 路由同一目录约定：仓库内、public/ 之外的私有路径（防抄袭红线）。 */
const RIVE_DIR = path.resolve(process.cwd(), "assets", "rive");

/**
 * 同实例缓存：serverless 实例生命周期内资产集合不变（变化 = 新部署 = 新实例），
 * 避免每个聚合请求都重复 hit 磁盘。
 */
const availabilityCache = new Map<string, boolean>();

/** 指定 .riv 资产是否已随当前部署上架（name = /api/pet/asset 白名单资产名）。 */
export function isRiveAssetAvailable(name: string): boolean {
  const cached = availabilityCache.get(name);
  if (cached !== undefined) return cached;
  const available = existsSync(path.resolve(RIVE_DIR, `${name}.riv`));
  availabilityCache.set(name, available);
  return available;
}
