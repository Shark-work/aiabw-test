import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { ugcPets } from "@/db/schema";
import { getPet, type PetConfig } from "@/lib/pet-config";

/** UGC 宠物在 adoptions.petType 中的编码：ugc:<petId> */
export function isUgcPetType(petType?: string | null): boolean {
  return typeof petType === "string" && petType.startsWith("ugc:");
}

/** 根据 petType（ugc:<id>）读取 UGC 宠物并转成 PetConfig；不存在返回 null */
export async function getUgcPetConfig(petType: string): Promise<PetConfig | null> {
  const id = petType.slice("ugc:".length);
  if (!id) return null;
  const [pet] = await db
    .select()
    .from(ugcPets)
    .where(eq(ugcPets.id, id))
    .limit(1);
  if (!pet) return null;
  return {
    name: pet.name,
    avatar: pet.imageUrl,
    welcome: `嗨！我是创作者打造的「${pet.name}」，想和你做朋友！`,
    personality: "创作者捏出来的独特伙伴",
    systemPrompt: pet.systemPrompt,
  };
}

/** 统一解析宠物配置：UGC 宠物读取数据库，官方宠物走 PETS 配置，未知回退狐狸 */
export async function resolvePetConfig(petType?: string | null): Promise<PetConfig> {
  if (isUgcPetType(petType)) {
    const ugc = await getUgcPetConfig(petType as string);
    if (ugc) return ugc;
  }
  return getPet(petType);
}
