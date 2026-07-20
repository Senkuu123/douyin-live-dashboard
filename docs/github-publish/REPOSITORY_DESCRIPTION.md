# GitHub仓库资料

## 推荐仓库名

`douyin-live-dashboard`

## About描述

面向Windows的抖音公开直播间实时数据采集与运营看板，支持弹幕、礼物、在线趋势、问题队列、行动提示、用户榜单、MySQL持久化和CSV导出。

## 英文描述备选

Windows desktop dashboard for collecting and analyzing public Douyin live-room events, trends, gifts, chats and audience activity.

## 推荐Topics

```text
douyin
live-streaming
live-dashboard
electron
react
typescript
echarts
mysql
websocket
data-visualization
windows-desktop
```

## 推荐GitHub设置

- Releases：开启，用于发布Windows便携版。
- Issues：开启，用于收集协议失效、采集缺失和界面问题。
- Discussions：MVP阶段暂不开启。
- Wiki：暂不开启，文档先随代码版本管理。
- Projects：暂不开启。
- 默认分支：`main`。
- 合并策略：保留Squash merge，关闭Merge commit和Rebase merge。

## 仓库首页摘要

这是一个本地优先的Windows直播数据工具。用户输入公开抖音直播间房间号后，程序通过独立采集侧车接收实时互动消息，由TypeScript服务完成标准化、去重和MySQL持久化，再由Electron和React看板展示在线趋势、互动速率、礼物、弹幕、用户事件、问题队列、行动提示和榜单。

项目不会把数据库密码、Cookie、token或原始用户ID写入仓库。采集依赖非公开网页协议，协议变化可能导致部分功能暂时失效。
