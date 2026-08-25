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

/** 统一解析宠物配置：UGC 宠物读取数据库，图鉴物种动态构建，官方宠物走 PETS 配置，未知回退狐狸 */
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
  return getPet(petType);
}
