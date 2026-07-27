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
