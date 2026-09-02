<div align="center" style="display:flex;align-items:center;justify-content:center;">
<img src="/public/logo.png" width="80px" alt="MonthBalance" />
<h1>MonthBalance</h1>
</div>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-yellow.svg" />
  <img alt="platform" src="https://img.shields.io/badge/platform-Docker%20%7C%20arm64%20%7C%20amd64-blue" />
  <img alt="db" src="https://img.shields.io/badge/database-SQLite%20(WAL)-green" />
</p>

个人记账平台，兼容 PC 与移动端。基于 [dingdangdog/cashbook](https://github.com/dingdangdog/cashbook) 的 `main-sqlite` 分支重构维护（原项目已停止更新），感谢原作者的出色工作。

## 相比原版的改进

### 查询/导入性能（2.6 万条流水实测）

原版 SQLite 数据量到 2 万行左右就明显卡顿，根因与修复：

| 问题 | 修复 | 效果 |
| --- | --- | --- |
| 全部表**零索引**，查询全表扫描 | 为 Flow/Book/Budget 等表添加 12 个复合索引 | 分页查询（含收支汇总）10~23ms |
| 默认 journal 模式，写库锁全库 | 启动时启用 WAL + `synchronous=NORMAL` + mmap | 导入期间页面查询不再阻塞 |
| 分页接口串行 3 个查询 | count 合并进 `GROUP BY` 聚合，剩余查询并行 | 每次请求少 1 次全表聚合 |
| 批量导入逐步提交 | 删除 + 分块插入放入单事务 | 2 万行导入约 0.6s |
| 自助去重全表载入内存 O(n²) 比对 | 改为 SQL 聚合 JOIN（NULL 安全） | 2.6 万行约 120ms |
| 下拉选项用 Prisma `distinct`（内存去重，拉全量） | 改为 SQL 级 `GROUP BY` | 常数级响应 |
| 自助平账 N+1 查询 | 单次查询 + 内存 Map 匹配 | 一次往返 |

### 界面

- 统一设计语言：中性表面 + 单一 emerald 主色；收入/支出用 emerald/rose 语义色；金额右对齐等宽数字，带 +/− 符号。
- 重做流水页（统计条/工具栏/表格/移动端卡片）、日历（今天圆形标记、支出强度同色深浅）、侧边栏/顶栏/底部导航（含 iOS 安全区）。
- 图表：月度柱状图取消重叠数字标签，统一饼图调色板与收支语义色。
- 深色/浅色双主题，移动端全页面适配。

## 部署（Docker）

```bash
docker run -d --name monthbalance --restart always \
  -p 9090:9090 \
  -v /your/data/path:/app/data \
  -e DATABASE_URL="file:///app/data/cashbook.db" \
  -e NUXT_AUTH_SECRET="改成你自己的密钥" \
  -e NUXT_ADMIN_USERNAME="admin" \
  -e NUXT_ADMIN_PASSWORD="<sha256 后的密码，部署后访问 /admin/GetPassword 生成>" \
  monthbalance:latest
```

镜像构建（在仓库根目录，arm64/amd64 皆可，取决于构建机）：

```bash
docker build -t monthbalance:latest .
```

启动时 entrypoint 会自动执行 `prisma migrate deploy`，老库升级会自动补齐索引，安全幂等。

> **备份提示**：数据库运行在 WAL 模式。直接拷贝 `cashbook.db` 前请先执行
> `sqlite3 cashbook.db "PRAGMA wal_checkpoint(TRUNCATE);"`，或连同 `-wal`/`-shm` 文件一起拷贝，否则可能丢失最近写入。

## 本地开发

```bash
npm install
npx prisma migrate deploy   # 按 .env 中 DATABASE_URL 初始化/升级数据库
npm run dev                 # http://localhost:9090
```

环境变量见 `.env`（模板值，公网部署务必全部修改）。

## 技术栈

Nuxt 3 · Vue 3 · Tailwind CSS · Prisma 6 · SQLite（WAL） · ECharts

## 许可

MIT，见 [LICENSE](./LICENSE)。原始版权归 [dingdangdog](https://github.com/dingdangdog) 所有。
