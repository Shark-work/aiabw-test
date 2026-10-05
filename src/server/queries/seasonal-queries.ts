import { pool } from "@/db/client";
import type {
  SeasonalEventDto,
  SeasonalI18nText,
  SeasonalProgressDto,
  SeasonalRewards,
} from "@/lib/seasonal-config";

/**
 * 季节活动 · 服务端查询（P2 社交传播 · 改动三）
 *
 * 骨架口径：
 *  - getActiveSeasonalEvent：当前进行中的活动（is_active + 时间窗，取最近开始的一个）；
 *  - getSeasonalProgress：登录用户在活动中的进度（无行 = 全零未领取）；
 *  - trackSeasonalProgress：探索完成 / 羁绊结晶节点 UPSERT 累计
 *    （仅对进行中活动生效；活动结束后不再累计，进度行保留可查）。
 * 奖励发放（claimed → 发积分/VIP/藏品）不在本次骨架范围，后续运营活动落地时实现。
 */

type EventRow = {
  slug: string;
  name: SeasonalI18nText;
  description: SeasonalI18nText;
  startAt: Date;
  endAt: Date;
  rewards: SeasonalRewards;
};

function toDto(r: EventRow): SeasonalEventDto {
  return {
    slug: String(r.slug),
    name: r.name,
    description: r.description,
    startAt: r.startAt instanceof Date ? r.startAt.toISOString() : String(r.startAt),
    endAt: r.endAt instanceof Date ? r.endAt.toISOString() : String(r.endAt),
    rewards: r.rewards ?? {},
  };
}

/** 当前进行中的活动（无 → null）。 */
export async function getActiveSeasonalEvent(): Promise<SeasonalEventDto | null> {
  const { rows } = await pool.query(
    `SELECT slug, name, description,
            start_at AS "startAt", end_at AS "endAt", rewards
       FROM seasonal_events
      WHERE is_active AND start_at <= now() AND end_at >= now()
      ORDER BY start_at DESC
      LIMIT 1`,
  );
  return rows[0] ? toDto(rows[0] as EventRow) : null;
}

/** 登录用户在指定活动中的进度（无行 → 全零未领取）。 */
export async function getSeasonalProgress(
  userId: string,
  eventSlug: string,
): Promise<SeasonalProgressDto> {
  const { rows } = await pool.query(
    `SELECT p.exploration_count AS "explorationCount",
            p.bond_crystals AS "bondCrystals",
            p.claimed
       FROM user_seasonal_progress p
       JOIN seasonal_events e ON e.id = p.event_id
      WHERE p.user_id = $1::uuid AND e.slug = $2
      LIMIT 1`,
    [userId, eventSlug],
  );
  const r = rows[0];
  return {
    explorationCount: Number(r?.explorationCount ?? 0),
    bondCrystals: Number(r?.bondCrystals ?? 0),
    claimed: !!r?.claimed,
  };
}

/**
 * 进度累计（对所有进行中活动 UPSERT；无进行中活动时零行写入，天然幂等）。
 * 调用方负责 try/catch（失败不阻断主流程）。
 */
export async function trackSeasonalProgress(
  userId: string,
  deltas: { exploration?: number; bondCrystals?: number },
): Promise<void> {
  const exp = Math.max(0, Math.trunc(deltas.exploration ?? 0));
  const crystals = Math.max(0, Math.trunc(deltas.bondCrystals ?? 0));
  if (exp === 0 && crystals === 0) return;
  await pool.query(
    `INSERT INTO user_seasonal_progress (user_id, event_id, exploration_count, bond_crystals)
     SELECT $1::uuid, e.id, $2, $3
       FROM seasonal_events e
      WHERE e.is_active AND e.start_at <= now() AND e.end_at >= now()
     ON CONFLICT ("user_id", "event_id") DO UPDATE SET
       exploration_count = user_seasonal_progress.exploration_count + $2,
       bond_crystals = user_seasonal_progress.bond_crystals + $3,
       updated_at = now()`,
    [userId, exp, crystals],
  );
}
