import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiOk } from "@/lib/aibi-api";
import { aibiLocale } from "@/lib/aibi-api";
import { getAibiItem, getAibiPack } from "@/lib/aibi-catalog";

export const runtime = "nodejs";

/**
 * GET /api/bag/items — 查询用户道具背包（艾比平台：卡包 + 道具）
 * 库存复用通用 user_items 表（roadmap「背包通用」原则）：
 *  - source='aibi_pack'，item_key='pack:'+packId → 未开启卡包；
 *  - source='aibi_item'，item_key=itemId → 道具；每件一行，quantity = COUNT(*)。
 * 返回：{ data: { packs: [...], items: [...] } }
 */
export async function GET(req: Request) {
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) return aibiFail("UNAUTHORIZED", 401, req);

    const locale = aibiLocale(req);
    const { rows } = await pool.query(
      `SELECT item_key AS "itemKey", source, count(*)::int AS quantity
         FROM user_items
        WHERE user_id = $1::uuid AND source IN ('aibi_pack', 'aibi_item')
        GROUP BY item_key, source
        ORDER BY item_key`,
      [user.id],
    );

    const packs: unknown[] = [];
    const items: unknown[] = [];
    for (const r of rows) {
      if (r.source === "aibi_pack") {
        const id = String(r.itemKey).replace(/^pack:/, "");
        const def = getAibiPack(id);
        packs.push({
          packId: id,
          name: def ? (locale === "en" ? def.nameEn : def.nameZh) : id,
          pricePoints: def?.pricePoints ?? null,
          quantity: r.quantity,
        });
      } else {
        const def = getAibiItem(r.itemKey);
        items.push({
          itemId: r.itemKey,
          name: def ? (locale === "en" ? def.nameEn : def.nameZh) : r.itemKey,
          effect: def ? (locale === "en" ? def.effectEn : def.effect) : null,
          pricePoints: def?.pricePoints ?? null,
          quantity: r.quantity,
        });
      }
    }
    return aibiOk({ packs, items });
  } catch (err) {
    return aibiCatch(err, req);
  }
}
