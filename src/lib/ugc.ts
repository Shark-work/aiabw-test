import { eq } from "drizzle-orm";

import { db, pool } from "@/db/client";
import { ugcPets } from "@/db/schema";
import { getPet, type PetConfig } from "@/lib/pet-config";
import {
  isSpeciesPetType,
  speciesIdOf,
  buildSpeciesPetConfig,
  type SpeciesInfo,
} from "@/lib/species-prompt";
import {
  isAibiPetType,
  aibiTokenIdOf,
  buildAibiPetConfig,
} from "@/lib/aibi-prompt";
import { getAibiSpecies, getAibiHabitat, getAibiRarity } from "@/lib/aibi-catalog";

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
    welcome: `Hi! I'm "${pet.name}", a companion created by a creator - nice to meet you!`,
    personality: "A unique companion crafted by a creator",
    systemPrompt: pet.systemPrompt,
  };
}

/** 根据 petType（species:<id>）读取字典物种 + 示例图，构建动态人设；不存在返回 null */
export async function getSpeciesPetConfig(
  petType: string,
  locale: "zh" | "en" = "zh",
): Promise<PetConfig | null> {
  const id = speciesIdOf(petType);
  if (!id) return null;
  const { rows } = await pool.query(
    `SELECT d.id, d.name_zh AS "nameZh", d.name_en AS "nameEn", d.category,
            d.habitat,
            d.default_description_zh AS "defaultDescriptionZh",
            d.default_description_en AS "defaultDescriptionEn",
            (SELECT p.image_url FROM pets p
              WHERE p.species_id = d.id AND p.image_url IS NOT NULL
              ORDER BY p.created_at DESC LIMIT 1) AS "imageUrl"
       FROM pet_dictionary d
      WHERE d.id = $1
      LIMIT 1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  const info: SpeciesInfo = {
    id: r.id,
    nameZh: r.nameZh,
    nameEn: r.nameEn,
    category: r.category,
    habitat: r.habitat,
    defaultDescriptionZh: r.defaultDescriptionZh,
    defaultDescriptionEn: r.defaultDescriptionEn,
    imageUrl: r.imageUrl,
  };
  return buildSpeciesPetConfig(info, locale);
}

/**
 * 根据 petType（aibi:<aibiTokenId>）读取链上艾比凭证 + 性格档案，构建专属人设；
 * 凭证不存在（或已销毁后残留线程）返回 null，调用方回退默认宠物。
 */
export async function getAibiPetConfig(
  petType: string,
  locale: "zh" | "en" = "zh",
): Promise<PetConfig | null> {
  const tokenId = aibiTokenIdOf(petType);
  if (!tokenId) return null;
  const { rows } = await pool.query(
    `SELECT t.aibi_token_id AS "aibiTokenId", t.species_id AS "speciesId",
            p.personality_type AS "personalityType", p.mood, p.affinity, p.energy,
            p.growth_level AS "growthLevel"
       FROM aibi_tokens t
       LEFT JOIN aibi_personalities p ON p.aibi_token_id = t.aibi_token_id
      WHERE t.aibi_token_id = $1
      LIMIT 1`,
    [tokenId],
  );
  const r = rows[0];
  if (!r) return null;
  const sp = getAibiSpecies(r.speciesId) ?? null;
  const habitat = sp ? getAibiHabitat(sp.habitatId) : undefined;
  const rarity = sp ? getAibiRarity(sp.rarityId) : undefined;
  return buildAibiPetConfig(
    {
      aibiTokenId: r.aibiTokenId,
      species: sp,
      rarityNameZh: rarity?.nameZh,
      rarityNameEn: rarity?.nameEn,
      habitatNameZh: habitat?.nameZh,
      habitatNameEn: habitat?.nameEn,
      personalityType: r.personalityType ?? null,
      mood: r.mood ?? null,
      affinity: r.affinity ?? null,
      energy: r.energy ?? null,
      growthLevel: r.growthLevel ?? null,
    },
    locale,
  );
}

/** 统一解析宠物配置：UGC 宠物读取数据库，图鉴物种动态构建，Aibi 链上凭证按实例构建，官方宠物走 PETS 配置，未知回退狐狸 */
export async function resolvePetConfig(
  petType?: string | null,
  locale: "zh" | "en" = "zh",
): Promise<PetConfig> {
  if (isUgcPetType(petType)) {
    const ugc = await getUgcPetConfig(petType as string);
    if (ugc) return ugc;
  }
  if (isSpeciesPetType(petType)) {
    const species = await getSpeciesPetConfig(petType as string, locale);
    if (species) return species;
  }
  if (isAibiPetType(petType)) {
    const aibi = await getAibiPetConfig(petType as string, locale);
    if (aibi) return aibi;
  }
  return getPet(petType);
}
