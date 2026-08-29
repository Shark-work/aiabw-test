-- ============================================================
-- 盲盒广场初始运营数据（冷启动 Seed）
-- 执行器: node scripts/_bx-init-pools.cjs（@neondatabase/serverless
--         不支持一次 query 多语句，脚本逐条执行下面每条语句）
-- ============================================================

-- 0) 清理 E2E 残留临时测试池（bx_ 前缀），避免污染广场展示
DELETE FROM blindbox_logs WHERE pool_id LIKE 'bx\_%';
DELETE FROM blindbox_pools WHERE id LIKE 'bx\_%';

-- 1) 奖池 A：每日福利箱 —— 1 元 / 10 积分，每日限购 1 次（cash 通道）
--    普通 80% · 稀有 15% · 史诗 4.9% · 传说 0.1%
INSERT INTO blindbox_pools (id, name_zh, name_en, price_cny, price_points, probabilities, species_ids, is_active)
VALUES ('newbie_welcome', '每日福利箱', 'Daily Bonus Box', 1, 10,
        '{"common":80,"rare":15,"epic":4.9,"legendary":0.1}'::jsonb, '[]'::jsonb, true)
ON CONFLICT (id) DO UPDATE SET
  name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en,
  price_cny = EXCLUDED.price_cny, price_points = EXCLUDED.price_points,
  probabilities = EXCLUDED.probabilities, species_ids = EXCLUDED.species_ids,
  is_active = EXCLUDED.is_active;

-- 2) 奖池 B：赛博神话箱 —— 9.9 元 / 200 积分，主推高爆率
--    普通 70% · 稀有 20% · 史诗 9% · 传说 1%
INSERT INTO blindbox_pools (id, name_zh, name_en, price_cny, price_points, probabilities, species_ids, is_active)
VALUES ('cyber_myth', '赛博神话箱', 'Cyber Myth Box', 9.9, 200,
        '{"common":70,"rare":20,"epic":9,"legendary":1}'::jsonb, '[]'::jsonb, true)
ON CONFLICT (id) DO UPDATE SET
  name_zh = EXCLUDED.name_zh, name_en = EXCLUDED.name_en,
  price_cny = EXCLUDED.price_cny, price_points = EXCLUDED.price_points,
  probabilities = EXCLUDED.probabilities, species_ids = EXCLUDED.species_ids,
  is_active = EXCLUDED.is_active;
