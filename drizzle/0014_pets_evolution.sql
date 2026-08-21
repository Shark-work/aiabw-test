-- 0014: 合成进化系统（Synthesis Evolution）
-- 进化规则：3 只同物种同稀有度 active 宠物 → 消耗 → 1 只稀有度+1
--   common → uncommon → rare → epic → legendary（legendary 为顶点，不可再进化）
--  - status:        active | consumed（软删除被消耗的 3 只，保留族谱数据）
--  - evolution_id:  被消耗宠物指向进化结果的 id；进化结果用 parent_ids 记录来源
ALTER TABLE pets ADD COLUMN status text NOT NULL DEFAULT 'active';
ALTER TABLE pets ADD COLUMN evolution_id text;

-- 进化计数（同用户下 status=active 的宠物按物种/稀有度统计）加速
CREATE INDEX IF NOT EXISTS idx_pets_owner_active ON pets (owner_id) WHERE status = 'active';

COMMENT ON COLUMN pets.status IS 'active=正常; consumed=已被进化消耗(软删除)';
COMMENT ON COLUMN pets.evolution_id IS '被消耗时指向进化后的新宠物 id';
