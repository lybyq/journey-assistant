# 分享与运维：部署、备份与恢复

仓库提供可运行的部署配置；没有替用户发布公网服务。实际域名、TLS、密钥与供应商权限由部署环境注入。

## Docker Compose

API使用Node 22.20与pnpm 10.34.6、非root账户，包含PostgreSQL 17客户端与中文字体。网页使用独立Nginx，转发同源 `/api` 并关闭SSE缓冲。数据库和Redis不发布公网端口；网页默认仅绑定 `127.0.0.1:8080`，由外层HTTPS入口转发。

```powershell
Copy-Item infra/production.env.example infra/production.env
# 编辑实际文件，填写独立密码、随机AUTH_SECRET、HTTPS来源/公开域名和模型配置。
docker compose --env-file infra/production.env -f infra/compose.production.yaml config --quiet
docker compose --env-file infra/production.env -f infra/compose.production.yaml up -d --build --wait
```

环境文件不能提交；URL密码需URI编码。生产默认禁用诊断、使用真实Agent；API启动执行带校验和与锁的迁移，旧迁移不可编辑。生产卷与开发卷独立，不能拿升级数据库镜像作为自动迁移数据的方法。外层代理需保留请求来源策略、SSE连接和足够读取超时。

检查 `/api/v1/system/health`、`/api/v1/system/storage`，再登录实测需求保存、工具查询、取消、断线、版本、分享与PDF。供应商 `configured` 只说明配置存在，真实调用成功才证明网络与权限。

## 真实逻辑备份

`pnpm data:backup` 读取当前后端受校验的DATABASE_URL，调用pg_dump自定义二进制格式，默认写入忽略目录 `.local/backups`。客户端主版本须不低于服务端；容器已提供17。密码只通过libpq环境传递，不写命令参数或日志。

生产容器内示例：

```powershell
docker compose --env-file infra/production.env -f infra/compose.production.yaml exec -T api node apps/api/dist/scripts/data-backup.js backup --file=/workspace/.local/backups/journey-reviewed.dump
```

开发机没有pg_dump时可以使用已有数据库容器，脚本通过Node二进制管道读写，避免旧PowerShell重定向改变文件内容：

```powershell
pnpm data:backup --docker-compose=infra/compose.yaml --file=.local/backups/journey-reviewed.dump
```

备份包含用户和私密对话，部署方需设置访问权限、加密、离机保存与保留周期；备份成功后仍必须定期演练恢复。

## 恢复演练

先由管理员创建新的隔离数据库，再在受保护环境将DATABASE_URL指向它。脚本只接受显式文件和与目标库名完全相同的确认参数；恢复会清理该目标库中的同名对象。

```powershell
# 此处journey_restore_drill必须是明确新建的演练库，不能直接填生产库名。
pnpm data:restore --file=.local/backups/journey-reviewed.dump --confirm-target=journey_restore_drill
# 无本机客户端时另加 --docker-compose=infra/compose.yaml
```

恢复后检查迁移账本、用户/项目/版本计数、抽样读取和实际业务，再制定生产切换步骤。脚本不自动创建库、不删除其他库，也不静默覆盖已有备份。

## 保留策略与CI

`pnpm data:retention` 默认只显示待清理数量；管理员显式加 `--apply` 才清理90天前操作指标和过期/撤销30天的分享。用户、消息、项目、版本、证据和checkpoint保留。需要业务数据删除策略时应另行设计身份验证、备份周期与级联影响。

GitHub Actions `.github/workflows/check.yml` 使用独立PostgreSQL/Redis运行 `pnpm check`。协议fixture不访问真实供应商；测试随机创建数据库并只清理自己的命名空间，绝不FLUSHDB。
