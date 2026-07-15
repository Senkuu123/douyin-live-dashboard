# 抖音直播实时弹幕与数据看板

## 当前状态

MVP端到端链路已跑通，桌面UI暂缓

已完成：

- TypeScript CLI工程
- 房间号和`live.douyin.com`链接解析
- `douyinLive v2.0.24`采集侧车安装和进程管理
- 侧车WebSocket消息接收
- 聊天弹幕标准化和用户标识哈希化
- MySQL项目库创建、迁移、批量写入和消息去重
- 监控会话、连接区间和停止状态记录
- 最近会话查询
- 公开直播间真实弹幕联调

2026-07-15使用公开直播间`557481980778`运行89秒，接收并入库181条聊天弹幕，平台消息ID无重复，用户标识全部完成64位哈希

待验证：30分钟和2小时稳定性测试

## 运行环境

- Windows
- Node.js 24或兼容版本
- MySQL 8.0
- MySQL凭据保存在`C:\Users\<用户名>\.my.cnf`

`.my.cnf`至少包含：

```ini
[client]
host=localhost
port=3306
user=root
password=本机密码
```

应用固定操作项目库`douyin_live_dashboard`，即使`.my.cnf`设置了其他默认数据库也不会采用

## 安装

```powershell
npm install
npm run collector:install
```

采集侧车安装到`vendor/douyinlive/`，可执行文件被Git忽略，许可证和第三方声明保留在项目中

## 命令

初始化或升级项目数据库：

```powershell
npm run dev -- init-db
```

监控直播间：

```powershell
npm run dev -- monitor 直播间房间号
```

也可传入直播间链接：

```powershell
npm run dev -- monitor https://live.douyin.com/房间号
```

受控联调时可设置自动停止时间：

```powershell
npm run dev -- monitor 房间号 --duration=90
```

按`Ctrl+C`停止监控，程序会刷新待写入弹幕并结算本次会话

查看最近会话：

```powershell
npm run dev -- last-session
```

## 验证

```powershell
npm run typecheck
npm test
npm run test:db
npm run build
```

`test:db`只操作项目专用库，会创建临时房间、会话和弹幕记录，验证去重后立即清理

## 数据库

MVP包含5张表：

- `schema_migrations`
- `live_rooms`
- `monitoring_sessions`
- `interaction_events`
- `connection_intervals`

数据库账号、密码、Cookie和token不得进入代码、日志或Git

## 已知边界

- 任意公开直播间采集依赖抖音非公开网页协议，签名和消息字段变化时需要更新采集侧车
- 首版只持久化聊天弹幕，礼物、点赞、进场、关注和指标快照后续接入
- 不保证消息零丢失，历史会话会保留完整性状态
- 礼物数据可能需要登录Cookie，MVP不配置Cookie
- 已验证聊天弹幕匿名采集可用，不需要登录Cookie
- UI参考文件位于工作区根目录`抖音直播实时看板UI参考.jpg`，当前不实现UI

## 项目文档

- 项目规范：`AGENTS.md`
- 产品结构：`docs/pm-20260714-douyin-live-dashboard-structure.md`
- 工作记录：`WORKLOG.md`
