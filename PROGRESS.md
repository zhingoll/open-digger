# PROGRESS
1. 目标：在不合库、不改采集器的前提下交付统一 Gateway、HTTP API、MCP 与 Skill。
2. 顺序：任务0基线与 Docker → 契约/Adapter → Gateway/HTTP/真实 SQL → MCP → Skill → 总回归/推送。
3. 基线：2026-07-27 clean，codex/huggingface-data-gateway@902df341，6文件/741行，Node 22.22.3，npm 10.9.8。
4. 基线：npx tsc --noEmit=0；现有 Data Gateway 测试 7 passing、0 pending。
5. Remotes：origin=zhingoll/open-digger；upstream=X-lab2017/open-digger（严格只读）。
6. 任务0完成：Docker Desktop 4.83.0 running，client/server 29.6.2，`hello-world` 成功。
7. 任务1完成：先红（缺 GitHubAdapter）后绿；GitHub/HF Adapter、v1校验、脱敏与跨平台入口共16 passing。
8. 任务2完成：HTTP/Gateway 24 passing；故意状态码红21/1后还原；Docker ClickHouse 4 passing并down -v。
9. 任务3/4完成；任务5回归tsc=0、35+4 passing、Skill/安全/白名单全绿；循环4/16，最终HEAD仅推送origin（授权已获）。
