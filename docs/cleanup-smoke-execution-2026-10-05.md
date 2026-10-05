# 冒烟账号清理执行记录（2026-10-05）

- **环境**：生产 Neon 库（www.aiabw.com）
- **命令**：`node scripts/cleanup-smoke-users.mjs`（dry-run 确认范围）→ `node scripts/cleanup-smoke-users.mjs --execute`
- **口径**：docs/RELEASE_CHECKLIST.md 附录（`full-smoke-%@test.dev` / `prod-smoke-%@test.dev`）
- **结果**：**CLEANUP_OK**——51 个冒烟用户、19 张关联表共 **907 行清零**；pets 2 个实例释放回池（非删除）；执行后复跑 dry-run 确认零残留
- **备注**：`aibi_growth_logs` / `aibi_personalities` / `chain_ledger` / `messages` 无 user 列，由入向 FK BFS 自动发现并清理；全过程单事务，SAVEPOINT 重试队列消解表间依赖

---

## 脚本原始输出


[cleanup] 目标用户 51 个：
  - prod-smoke-1790847076186@test.dev (id=58529419-2037-499d-b634-70b77636c6e3)
  - prod-smoke-1790847121178@test.dev (id=65358d3e-341b-4760-a3fc-77a3db9da1b9)
  - prod-smoke-1790847169482@test.dev (id=db89b286-a985-4105-9efc-2ae01d51ea28)
  - prod-smoke-1790854463587@test.dev (id=b85dcb15-4af0-4c46-ba7a-382e078a3edb)
  - prod-smoke-1790864279182@test.dev (id=515cd15e-a83f-4db4-b335-1a7ec6f5f685)
  - prod-smoke-1790864601939@test.dev (id=b34e8cc5-7be5-4f45-bd58-ed73f9df60b4)
  - prod-smoke-1790865139600@test.dev (id=19febad4-1b24-4ba1-b913-d8123acd1090)
  - prod-smoke-1790866523177@test.dev (id=27ee31b8-0c88-40ff-bd44-3257958cb355)
  - prod-smoke-1790905310664@test.dev (id=4610cbe7-bda2-4fe7-ba7c-43a8930815ab)
  - prod-smoke-1790907481772@test.dev (id=7db7cd0d-7f2e-4699-ad0a-7d30d1ae12ac)
  - prod-smoke-1790907711830@test.dev (id=40ee019c-249e-4ebb-84ee-3ac03c984e3e)
  - prod-smoke-1790911139028@test.dev (id=285406eb-101d-4c43-b797-22c673b3ca8b)
  - prod-smoke-1790911557198@test.dev (id=0e181852-6609-4294-a42d-4f537cd00160)
  - prod-smoke-1790913770760@test.dev (id=126a5bf4-e925-4ef6-bcfe-6e895a143e0a)
  - prod-smoke-1790914280881@test.dev (id=87ab32a1-6bbb-4057-ab8c-16e7b0f00871)
  - prod-smoke-1790917056803@test.dev (id=be3408ac-de45-43cd-8a8c-4a0a79cb1d3c)
  - prod-smoke-1790917356119@test.dev (id=4bd65e16-2957-4de7-ac21-abd7973716b6)
  - prod-smoke-1790924446661@test.dev (id=db76139f-0a45-4dec-a4af-febc537d1a11)
  - prod-smoke-1790927045018@test.dev (id=859d043f-1ff7-45e3-af8d-30902ccab7c9)
  - prod-smoke-1790931520927@test.dev (id=a7575768-ca74-4029-8905-2c93a789f947)
  - prod-smoke-1790941052472@test.dev (id=776f2b02-5dd6-4d0d-ac4d-074989010882)
  - prod-smoke-1790946952039@test.dev (id=81f700d4-4132-4b84-9f1f-c4d943bbcf24)
  - prod-smoke-1790949127959@test.dev (id=db1bfc61-c7ee-4288-9ef0-60ae1648252f)
  - prod-smoke-1790952104954@test.dev (id=a017f29f-5b9c-41eb-aac2-b6de1278710b)
  - prod-smoke-1790952633162@test.dev (id=d9fa23cc-2594-49d1-99fd-16e6a9bc4228)
  - prod-smoke-1790953123117@test.dev (id=8d7ce017-6d63-4231-809a-349092fe83ee)
  - prod-smoke-1790995150595@test.dev (id=3e0897e4-6fa2-4cb6-b655-022162ac8d23)
  - prod-smoke-1790997042472@test.dev (id=79055abd-5127-4ae9-8cc7-045c4e48ab3d)
  - prod-smoke-1790997986003@test.dev (id=3f128e67-89e8-4568-8771-6a23ef83d7c7)
  - prod-smoke-1791001022017@test.dev (id=5929ce1d-479b-4b6e-8be5-34b1a2942cd2)
  - prod-smoke-1791002154630@test.dev (id=d02f0f5d-7687-4304-9eed-ac4318ecc419)
  - prod-smoke-1791002196379@test.dev (id=570ff597-f7e9-4cef-bc9a-4d3c377bbf43)
  - prod-smoke-1791002933479@test.dev (id=875c127d-95d8-4ba4-8bc3-7ad1e56d98d4)
  - prod-smoke-1791017118955@test.dev (id=e844d85b-58c2-4669-a276-6a2f242a31e0)
  - prod-smoke-1791035520947@test.dev (id=af7a1a83-c662-4dea-a4a3-2dc0aab7f452)
  - prod-smoke-1791037596920@test.dev (id=2beafc01-aff4-4ee1-9f23-172b10be0cd2)
  - prod-smoke-1791038733033@test.dev (id=a85df64c-693c-48f0-8762-da93477a895f)
  - prod-smoke-1791038852687@test.dev (id=33644caf-0597-4692-9316-7bd57328c5f5)
  - prod-smoke-1791081567877@test.dev (id=6a82cbcd-c86a-4838-be1d-f314b2b64532)
  - prod-smoke-1791086932611@test.dev (id=1e0f46e0-a6e3-43cd-9548-01f3bb078390)
  - prod-smoke-1791098435276@test.dev (id=642bd766-5807-4aa5-8220-c74814bae61a)
  - prod-smoke-1791099379433@test.dev (id=a9d33525-18f9-49a9-af00-be78ee812196)
  - prod-smoke-1791100301335@test.dev (id=1f79dccf-783b-46ab-a172-8e04050f9176)
  - prod-smoke-1791105070452@test.dev (id=237a91c4-6f15-4a06-b06e-2739b0c0ecb8)
  - prod-smoke-1791115745876@test.dev (id=47a8ee47-8b80-4ca3-907c-d7f58e2f88e8)
  - prod-smoke-1791123848157@test.dev (id=2882f898-dfd3-4216-8a6b-19f2fe2c3ef1)
  - full-smoke-1791168474591@test.dev (id=c516e406-1b7d-4125-8854-70cc3398f2cf)
  - full-smoke-1791169391851@test.dev (id=0921e33a-0651-44f1-b263-9199dfab9cf8)
  - full-smoke-1791169722640@test.dev (id=ede79807-5636-491d-a876-12a70962ce3a)
  - full-smoke-1791174379654@test.dev (id=9a9e1202-dcf4-4698-8697-26eebfedbe62)
  - full-smoke-1791174882069@test.dev (id=b2ce76e9-a706-41b4-9dc5-ebb0c8101b24)

[cleanup] 执行完成：
| 表 | 清理前 | 清理后 |
| --- | ---: | ---: |
| pets（释放回池，非删除） | 2 | 0 |
| achievements | 5 | 0 |
| adoptions | 2 | 0 |
| aibi_growth_logs | 84 | 0 |
| aibi_personalities | 129 | 0 |
| aibi_tokens | 129 | 0 |
| burn_logs | 126 | 0 |
| chain_ledger | 2 | 0 |
| exploration_records | 5 | 0 |
| messages | 2 | 0 |
| mint_logs | 129 | 0 |
| points_log | 190 | 0 |
| soul_cards | 2 | 0 |
| stripe_orders | 5 | 0 |
| threads | 2 | 0 |
| user_collectibles | 2 | 0 |
| user_items | 42 | 0 |
| users | 51 | 0 |
| **合计** | **907** | **0** |

CLEANUP_OK
