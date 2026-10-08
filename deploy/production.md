# 生产部署与升级

## 生产实例

| 项目 | 值 |
| --- | --- |
| SSH | `ubuntu@192.168.31.236`（默认 22 端口） |
| 应用目录 | `/opt/chathub` |
| 服务 | `chathub.service`（systemd） |
| Web 管理面板 | `http://192.168.31.236:6700/` |
| 原生节点 | `ws://192.168.31.236:6700/chathub/v2/connect` |
| OneBot 网关 | `ws://192.168.31.236:6700/onebot/v11` |
| 备份目录 | `/opt/chathub-backups/<时间戳>/` |

使用已配置的 SSH 密钥登录。sudo 与应用凭证从安全的运维配置取得，不要写进仓库。根目录被忽略的 `deploy.md` 是私有运维参考，含敏感信息，不可提交。

## 升级原则

1. 在本地执行 `npm test`，完成编译、静态资源打包与测试。
2. 创建独立临时发布目录，只上传 `server/dist/`、`package.json` 与依赖锁文件。
3. 确认目标主机、systemd 服务及工作目录正确后，停止 ChatHub，备份生产 `server/config.yaml`、`server/data/`、依赖清单和旧 `server/dist/`。备份目录权限设为 `0700`。
4. 只替换 `server/dist/` 与依赖清单，执行 `npm install --omit=dev --no-audit --no-fund`，再启动服务。
5. 检查 `systemctl is-active chathub.service`、启动日志、管理 API 与客户端重连状态；核对关键产物 SHA-256。

**禁止用本地 `server/config.yaml` 覆盖生产配置，禁止清空 `server/data/`。** 其中身份库、平台设置、插件状态及 OneBot 客户端凭证必须保留。`deploy/setup.sh`、`deploy/start.sh` 是演示脚本，不用于生产升级。

插件管理面板保存的配置优先于 YAML。默认值升级后，必须通过管理 API 检查实际生效值；不要为了采用新默认值清空整个插件状态文件。

升级失败时从对应备份恢复旧构建产物与依赖清单，并重新启动服务。通常不需要恢复数据；恢复旧数据会丢失升级后的运行期变更。

## 系统消息显示设置

跨服转发默认配置：

```yaml
plugins:
  relay:
    system_name: "server"
    hide_system_name: true
```

默认显示 `[来源客户端] 消息内容`。在管理面板关闭“隐藏系统消息名字”后显示 `[来源客户端] <server> 消息内容`，显示名可自定义。仅改变转发显示，不改变玩家名字、原始系统账号或 QQ 机器人身份。

Minecraft 的现有 MCDR 渲染器支持空名字，无需为此更新节点插件。Terraria 节点需要包含空名字处理的新 `DeliveryRenderer`；单独升级 ChatHub 服务端不会更新外部 Terraria 模组。

## 最近一次升级

- 2026-10-06：部署当前工作区构建，加入自定义系统转发显示名与隐藏名字设置。
- 回滚备份：`/opt/chathub-backups/20261006-110224/`。
- 管理 API 确认：转发插件已启用，`system_name = "server"`，`hide_system_name = true`。
- 重启后观察到 2 个在线客户端、1 名在线玩家。
- `server/dist/plugins/CrossServerRelay.js` SHA-256：`d3424c8e3ef52b19fde1369b5f67dd6e933c1bcd0873ef01f8d756f25709622f`。
