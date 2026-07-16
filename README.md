# 抖音直播实时数据看板

Windows 桌面端 MVP 已完成。软件连接公开抖音直播间，实时采集互动消息、写入 MySQL，并用暗色高密度工作台展示指标、趋势、事件和问题队列。

## 已完成功能

- Electron + React 桌面应用，主进程与渲染进程通过隔离 IPC 通信
- 直播间链接/房间号输入、开始采集、停止采集和下播等待
- 弹幕、进场、点赞、礼物、关注、分享、粉丝团、在线序列和房间统计采集
- 原始消息与标准化指标同时入库，平台消息 ID 去重
- 用户 ID 只保存 SHA-256 哈希，不保存明文 ID
- 已验收的1920×1080指挥舱界面，支持不同窗口尺寸等比压缩信息密度
- 当前在线、进场、弹幕、点赞动作、礼物和独立用户指标及每分钟速率
- 最近20分钟在线趋势、实时弹幕、高价值事件流、问题队列、行动提示和用户等级榜单
- 高价值礼物、高等级用户进场、负面词详情及基于实时互动的态势评分
- 顶部用户等级筛选，可将互动指标、速率、事件、问题、提示和榜单统一切换到指定等级以上口径
- 本次采集会话CSV导出，包含事件、匿名用户哈希、标准化指标和采集版本
- 启动时恢复最近一个有数据的历史会话
- 会话、连接区间、停止原因和采集完整性记录

## 直接运行软件

便携版：

```text
release\DouyinLiveDashboard-0.1.0-x64.exe
```

该文件未使用商业代码签名证书，Windows 可能显示 SmartScreen 提示。应用仍需要本机存在：

- MySQL 8.0
- `C:\Users\<用户名>\.my.cnf` 数据库凭据

## 开发运行

```powershell
npm install
npm run collector:install
npm run dev -- init-db
npm run desktop:dev
```

生产模式启动：

```powershell
npm run desktop:start
```

重新生成便携版：

```powershell
npm run desktop:package
```

## 命令行采集与审计

```powershell
npm run dev -- monitor https://live.douyin.com/房间号
npm run dev -- monitor 房间号 --duration=90
npm run dev -- last-session
npm run audit:session -- 房间号
```

`audit:session`只输出会话级匿名聚合统计，不输出昵称或弹幕正文。

## 数据库

应用固定操作项目库`douyin_live_dashboard`。`.my.cnf`至少包含：

```ini
[client]
host=数据库地址
port=3306
user=数据库用户
password=数据库密码
```

数据表：

- `schema_migrations`
- `live_rooms`
- `monitoring_sessions`
- `interaction_events`
- `connection_intervals`

数据库迁移 v2 为互动事件增加`metrics_json`，保存点赞次数、在线人数、礼物名称/数量/钻石数等标准化指标。数据库密码、Cookie 和 token 不进入代码、日志或 Git。

## 已完成验证

### 桌面看板集成

- HTML复刻稿完成逐项标注并通过验收，已迁移为真实Electron + React界面
- 当前在线不再使用`room_stats.total`累计口径，避免约2千与约20万之间跳变
- Lv20全局筛选数据库聚合、抽屉交互和渲染截图通过自动冒烟验证
- 类型检查、7个测试文件共16个单测、数据库快照/等级筛选/CSV数据源冒烟和桌面生产构建通过
- 验收截图：`artifacts\ui-smoke.png`、`artifacts\ui-level-filter.png`、`artifacts\ui-level-filter-applied.png`

### 2 小时稳定性

- 房间：`557481980778`
- 持续：125 分钟
- 入库：35,637 条弹幕
- 记录数与存储数一致，平台消息 ID 无重复
- 用户标识全部哈希化
- 每分钟均有数据，最大消息间隔 4.004 秒
- 全程一个已连接区间，结束后无遗留开放连接

### 扩展消息真实联调

- 房间：`163788489151`
- 持续：44 秒
- 入库：133 条，消息 ID 133/133 唯一，标准化指标 133/133 完整
- 进场 57、点赞消息 45、弹幕 14、在线序列 6、房间统计 6、分享 5
- 点赞动作合计 346，峰值在线 1,680
- 12 条无用户哈希记录全部为在线序列/房间统计系统消息

礼物和关注在该 44 秒窗口内未自然发生，解析与指标提取由单元测试覆盖。部分直播间的礼物字段可能依赖登录 Cookie；当前匿名采集不在代码中配置 Cookie。

## 验证命令

```powershell
npm run typecheck
npm test
npm run test:db
npm run desktop:build
```

桌面端自动冒烟截图：`artifacts\ui-smoke.png`。

## 已知边界

- 采集依赖抖音非公开网页协议，签名或 protobuf 字段变化时需要更新侧车及解析映射
- 当前问题队列是本地关键词规则，不是大模型语义分析
- 便携版未签名，默认使用 Electron 图标
- 为兼容当前 Windows 未开启符号链接权限的环境，便携包使用无 ASAR 构建

## 项目文档

- 项目规范：`AGENTS.md`
- 产品结构：`docs/pm-20260714-douyin-live-dashboard-structure.md`
- 工作记录：`WORKLOG.md`
