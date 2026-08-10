/**
 * 单宠限制（商业化变现核心规则）：
 * 每个用户在“未付费/未解锁”的情况下最多拥有 1 只宠物；
 * 只要用户拥有任意一只已解锁（is_unlocked=true）的宠物，即视为已付费用户，
 * 可继续领养/购买/抽取更多宠物。
 *
 * 本文件为纯逻辑（无 DB / 无 Next 依赖），便于单元测试。
 */

export const FREE_PET_LIMIT = 1;

export type PetLimitState = {
  petCount: number;
  unlockedPetCount: number;
  limit: number;
};

export type PetLimitDecision = PetLimitState & {
  allowed: boolean;
  reason: "ok" | "limit_reached";
  hasUnlocked: boolean;
};

/** 纯函数：根据用户当前宠物数量 / 已解锁数量判断是否允许继续获取宠物。 */
export function evaluatePetLimit(input: PetLimitState): PetLimitDecision {
  const hasUnlocked = input.unlockedPetCount > 0;
  const allowed = hasUnlocked || input.petCount < input.limit;
  return {
    ...input,
    hasUnlocked,
    allowed,
    reason: allowed ? "ok" : "limit_reached",
  };
}

export const PET_LIMIT_MESSAGE =
  "你已经有了 1 只艾比伙伴啦！解锁「多宠图鉴」，即可再领养新伙伴，还能无限畅聊~";

/** 返回给前端的拦截响应体（各路由统一用 status 402 包装）。 */
export function buildPetLimitBody(
  decision: PetLimitDecision,
  unlockAdoptionId?: string | null,
) {
  return {
    ok: false,
    error: PET_LIMIT_MESSAGE,
    code: "PET_LIMIT_REACHED",
    needPayment: true,
    petCount: decision.petCount,
    unlockedPetCount: decision.unlockedPetCount,
    limit: decision.limit,
    unlockAdoptionId: unlockAdoptionId ?? null,
  };
}

/** 事务内抛出，路由 catch 后转成 402 响应。 */
export class PetLimitError extends Error {
  decision: PetLimitDecision;
  unlockAdoptionId: string | null;
  constructor(decision: PetLimitDecision, unlockAdoptionId: string | null = null) {
    super(PET_LIMIT_MESSAGE);
    this.name = "PetLimitError";
    this.decision = decision;
    this.unlockAdoptionId = unlockAdoptionId;
  }
}

export function isPetLimitError(err: unknown): err is PetLimitError {
  return err instanceof PetLimitError;
}
