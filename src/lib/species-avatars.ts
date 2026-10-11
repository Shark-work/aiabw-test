/**
 * 物种头像统一映射（2026-10 视觉规范重设）：
 *  - 26 个 pet_dictionary 物种 → 手绘扁平矢量头像 `/avatars/{speciesId}.png`
 *    （512×512，圆内浅色纯色底 + 圆外透明；设计源 assets/avatars/*.svg，
 *     构建产物由 scripts/build-avatars.mjs 经 sharp 生成）；
 *  - 读路径派生：catalog / claim 响应的 imageUrl 命中映射时覆盖 DB 值
 *    （pets.image_url 存量个性化 AI 图保留作详情/链上用途，零 DB 迁移）；
 *  - 未命中（UGC 创作者宠物 / 幻想灵宠 / 未来新增未画物种）→ null，调用方回退 DB 原图。
 *
 * 扩充物种时：新增 assets/avatars/{id}.svg → 跑 scripts/build-avatars.mjs → 本表加一行
 * （契约测试 tests/species-avatars.test.mjs 会校验 26 物种覆盖完整性）。
 */
export const SPECIES_AVATARS: Record<string, string> = {
  // 犬科
  golden_retriever: "/avatars/golden_retriever.png",
  husky: "/avatars/husky.png",
  border_collie: "/avatars/border_collie.png",
  corgi: "/avatars/corgi.png",
  // 猫科
  maine_coon: "/avatars/maine_coon.png",
  persian: "/avatars/persian.png",
  snow_leopard: "/avatars/snow_leopard.png",
  lion: "/avatars/lion.png",
  tiger: "/avatars/tiger.png",
  cheetah: "/avatars/cheetah.png",
  // 海洋生物
  blue_whale: "/avatars/blue_whale.png",
  dolphin: "/avatars/dolphin.png",
  octopus: "/avatars/octopus.png",
  sea_otter: "/avatars/sea_otter.png",
  clownfish: "/avatars/clownfish.png",
  // 鸟类
  bald_eagle: "/avatars/bald_eagle.png",
  owl: "/avatars/owl.png",
  penguin: "/avatars/penguin.png",
  parrot: "/avatars/parrot.png",
  // 大型哺乳动物
  panda: "/avatars/panda.png",
  elephant: "/avatars/elephant.png",
  red_panda: "/avatars/red_panda.png",
  // 爬行动物
  tortoise: "/avatars/tortoise.png",
  chameleon: "/avatars/chameleon.png",
  // 小型哺乳动物
  squirrel: "/avatars/squirrel.png",
  hedgehog: "/avatars/hedgehog.png",
};

/** 命中返回物种统一头像路径；未命中返回 null（调用方回退 DB 原图）。 */
export function speciesAvatarFor(speciesId: string | null | undefined): string | null {
  if (!speciesId) return null;
  return SPECIES_AVATARS[speciesId] ?? null;
}
