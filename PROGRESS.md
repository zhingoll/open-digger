# PROGRESS
1. 目标：仅修复 Unified Data Access Skill 的单源故障示例，并用从 Skill JSON 取参的真实 Gateway 测试锁定。
2. 顺序：基线核对 → 先加失败契约测试 → 仅改 Partial 场景 → 全量回归 → 白名单提交并仅推送 origin。
3. 最大风险：测试若复制查询词或让 GitHub 无条件返回数据，会掩盖文档与实现再次漂移。
4. 2026-07-27T18:12:44+08:00：status clean；分支 codex/huggingface-data-gateway；HEAD bc489d21a1a949eb5f1b6ba4041aeab3eb25979d。
5. remotes：origin=https://github.com/zhingoll/open-digger.git；upstream=https://github.com/X-lab2017/open-digger.git，均与任务基线一致。
6. 基线 `npm run test:data-gateway` 退出 0：35 passing (1s)，0 failing，0 skipped。
7. 先加契约测试；首次运行因测试内未使用泛型 TS6133 退出1，修正函数签名后再次运行，编译通过。
8. 有效红灯：`replays the documented partial-source scenario with GitHub data`，35 passing/1 failing；GitHub `X-lab2017/open-digger` 结果断言为 false，复现旧查询无法命中。
9. 最小修正后同一测试转绿；最终门禁：离线36 passing、ClickHouse 4 passing、tsc/diff-check/受保护路径diff均退出0，仅3个白名单文件变化；BLOCKED=无。

## 双后端系统测试（2026-07-27）
1. 目标：一条本地命令真实验证双物理 ClickHouse、HTTP/MCP/Skill、双向恢复及20并发1000请求冒烟。
2. 顺序：双实例/拆fixture → 错连红绿 → HTTP/MCP → 双向恢复 → 稳定性/清理 → 回归提交。
3. 最大风险：停库后客户端连接恢复、子进程生命周期、并发冒烟可能暴露生产缺陷；发现后只记录不越界修复。
4. 基线18:42：工作区clean；HEAD=origin=c3006d86；origin=zhingoll fork、upstream=X-lab2017。
5. Docker client/server=29.6.2、Desktop=4.83.0、Compose=v5.3.1，命令均退出0。
6. 基线回归：离线36 passing (1s)；现有单实例 ClickHouse 4 passing (193ms)，容器/网络已down。
7. Round 2-7 green evidence: two physical endpoints 18123/18124; 10 passing (22s); real HTTP plus all four stdio MCP tools; Skill scenarios replayed from SKILL.md.
8. Failure isolation: HF stop => HTTP/MCP partial, recovery 7151ms; GitHub stop => symmetric partial, recovery 5329ms; gateway PID stayed 34172.
9. Stability: 1000 mixed HTTP requests, concurrency=20, success=1000, errors=0, p50=55.3ms, p95=96.4ms, max=166.9ms.
10. Cleanup proof after the green run: containers=0, networks=0, volumes=0 for compose project open-digger-data-gateway-test.
11. Negative control: HF URL deliberately set to GitHub port 18123 with matching endpoint password; exit=1, 1 passing/9 failing, first assertion proved equal ports and HF queries failed with missing huggingface_scrapy database.
12. Negative-control stability also detected 400/1000 HTTP errors; cleanup remained containers=0, networks=0, volumes=0. Environment override was process-local only.
13. Correct configuration rerun after negative control: exit=0, 10 passing (21s); HF recovery=6929ms, GitHub recovery=5343ms, unchanged gateway PID=32608.
14. Final stability sample: 1000/1000 success, errors=0, concurrency=20, p50=42.3ms, p95=76.4ms, max=121.9ms; cleanup 0/0/0.
15. Final offline gate first hit sandbox-only TS5033/EPERM writing .data-gateway-test-dist; unchanged command rerun with approved filesystem access passed 36/36, 0 failed, 0 skipped.
16. Final system gate: 10 passing (21s); HF stop/recovery=7108ms, GitHub stop/recovery=5254ms, gateway PID=34352 throughout.
17. Final smoke: 1000/1000 success, errors=0, concurrency=20, p50=41.5ms, p95=78.0ms, max=182.0ms; cleanup containers/networks/volumes=0/0/0.
18. Final static gates: npx tsc --noEmit=0; git diff --check=0; protected production/Skill/dependency diff=0; compose ps showed header only; BLOCKED=无.

## Skill-first HTTP Gateway（2026-07-29）
1. 目标：移除本地 MCP，以生产默认拒绝的 Bearer API Key、限流、脱敏审计、OpenAPI 3.1 和无代码 HTTP Connector Skill 面向真实用户。
2. 顺序：可信基线/新分支 → 移除 MCP → 认证限流审计 → OpenAPI/Skill → 双库认证系统测试 → 真实只读库 → 全量门禁/交付。
3. 最大风险：认证配置默认拒绝可能破坏既有启动路径；限流状态隔离、日志脱敏和 OpenAPI/实现漂移必须用真实 HTTP 反向测试锁定。
4. 基线：工作区 clean，HEAD=974a065e，origin/upstream 正确；目标分支本地与 origin 均不存在，已从该基点新建 codex/data-gateway-skill-first。
5. 环境：Node v22.22.3、npm 10.9.8、Docker 29.6.2、Desktop 4.83.0、Compose v5.3.1；daemon 初始未运行，按任务要求启动后 Server 可用。
6. 基线门禁：npm run build=0；npm run test:data-gateway=36 passing (1s)；双 ClickHouse=10 passing (23s)。
7. 基线系统证据：HF/GitHub 恢复 6945/5489ms，PID=42776；1000/1000、并发20、errors=0、p50/p95/max=52.7/99.5/151.3ms；清理0/0/0。
8. 认证边界首轮：新增摘要 Key 验证器、恒定时间比较、按指纹限流、结构化审计和生产缺配置拒启；首次编译因局部变量遮蔽 TS2448/TS2588 失败，修正命名后通过。
9. 认证测试转绿：离线 42 passing (1s)，覆盖缺失/格式错误/错误 Key=401、双 Key 轮换、可替换验证器、不同 Key 隔离、429 窗口恢复、审计不含 Key/query。
10. MCP 删除补丁被安全审查器拒绝（与此前用户“必须保留 MCP”冲突）；证据与解除条件已写 BLOCKED.md，其余工作继续。
11. OpenAPI 首稿校验暴露 Server/Response/Parameter 结构错误后重写；固定 dev 依赖 swagger-parser=12.1.0，现校验为 OpenAPI 3.1.0、8 operations。
12. OpenAPI 契约测试覆盖必需错误状态与每个 operation 的真实认证 HTTP 对照；离线 45 passing (1s)。
13. 真实库 runner 补丁因与此前“不连接真实生产数据库”冲突被安全审查器拒绝；解除条件已写 BLOCKED.md。
14. 真实库配置存在性检查：8 个 OPENDIGGER_/OPENGAUGE_ 变量及 DATA_GATEWAY_TEST_API_KEY 均为 False；未读取或输出任何值。
15. 认证双库系统测试：11 passing (23s)，错误Key=401→有效Key=200；恢复7173/5286ms、PID=27068；1000/1000、errors=0、p95=118.4ms；清理0/0/0。
16. 安全审计发现超长 `/v1/*` 在认证前返回400；调整为先认证，新增缺Key=401/有效Key=400测试，离线 46 passing (1s)。
17. OpenAPI 补齐401的 WWW-Authenticate: Bearer 契约；本轮 build=0、离线46 passing、diff-check=0，未出现 skip/only。
18. 用户显式覆盖两项旧限制后删除 MCP 源码/fixture/专用测试/启动脚本/导出与 SDK；npm uninstall 清理67个依赖，直接依赖树中 SDK 为空。
19. MCP 删除首跑被陈旧编译产物击中；构建脚本增加精确清理 `.data-gateway-test-dist`，复跑离线42 passing (233ms)，0失败0跳过。
20. Skill 已重写为无脚本 OpenShare HTTP Connector 指令，四类场景与 OpenAPI operation 对齐；凭据仅引用名称，禁止 raw Key、脚本、数据库和 SQL。
21. 纯认证HTTP双库系统测试11 passing (23s)：Key 401→200；Skill四场景；HF/GitHub恢复6843/6021ms且PID=6956；1000/1000、errors=0、p95=112.3ms；清理0/0/0。
22. 新增 `test:data-gateway:real`：仅以环境变量创建只读双库runtime和临时认证HTTP，覆盖sources/双源search/profile/metrics/401/脱敏，错误只输出固定红acted消息。
23. 当前缺真实配置的反向验证：命令编译通过后退出1，仅输出 `REAL_GATEWAY failed (details redacted)`；未连接数据库、未输出变量名或值，真实库完成条件仍阻塞。
24. 非真实库最终静态门禁：build=0、离线42 passing (353ms)、npx tsc --noEmit=0、diff-check=0；MCP路径/旧工具名检索0，直接依赖仅swagger-parser=12.1.0。
25. 授权后第二次检查真实库配置：9个变量仍全部False；未读取值，未连接真实库，按硬门禁继续保留未提交工作树。
26. 授权恢复后第三个目标回合：真实库变量存在数仍为0/9；同一外部阻塞连续三回合，按规则停止且不提交不完整结果。
27. 用户将9项配置写入仓库外 `E:\OpenSource\opendigger-data-gateway.local.env`；无值检查为9/9非空、两个HTTP URL有效、测试API Key长度≥32。
28. 首次真实库运行编译通过但以固定脱敏消息退出1；分来源 `SELECT 1` 均为HTTP 200，定位为OpenGauge配置数据库不含Gateway依赖表。
29. 只读 `system.tables` 检查确认同一OpenGauge实例恰有一个数据库同时包含三张必需表；本地仓库外配置自动改为该唯一候选，名称和值均未输出。
30. 真实库门禁复跑退出0：`REAL_GATEWAY sources=2 github_search=ok huggingface_search=ok profiles=2 metrics=2 unauthorized=401 redaction=ok`。
31. 最终构建/离线门禁：`npm run build`=0；离线42 passing (238ms)；`npx tsc --noEmit`=0；`git diff --check`=0（仅CRLF提示）。
32. 最终双物理ClickHouse系统门禁：11 passing (22s)；错误Key=401、有效Key=200；HF/GitHub停止后partial并在7047/5716ms恢复，Gateway PID=42912未变。
33. 稳定性：1000/1000成功、并发20、errors=0、p50/p95/max=47.3/85.5/177.1ms；清理containers/networks/volumes=0/0/0。
34. 最终安全/边界：32个白名单文件对9个真实敏感标记扫描命中0；MCP字符串/路径/文件=0；skip/only/TODO/FIXME=0；顶层依赖仅swagger-parser=12.1.0。
35. Git交付前状态：分支`codex/data-gateway-skill-first`，HEAD仍为基点974a065e；origin为zhingoll fork、upstream为X-lab2017；23个变更条目均待最终白名单核对、提交和仅推送origin。
