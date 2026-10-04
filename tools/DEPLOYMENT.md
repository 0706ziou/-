# IP 服务器部署

目标是本项目所有者的 `111.230.149.65`（OpenCloudOS 9.6），游戏地址为 `https://111.230.149.65/orchard/`。这是部署准备说明，未运行脚本前不表示网站已经上线。

部署前已确认：系统 Nginx 从 `/etc/nginx/nginx.conf` 加载 `/etc/nginx/conf.d/*.conf`；原游戏通过 `youxi1.conf` 监听 80 端口；443 尚未使用。服务器有 Python 3.11、Node、Git、curl 和 Certbot 2.8。

## 安装流程

1. 在腾讯云轻量服务器的防火墙页面放行入站 TCP 443；保留现有 80 端口规则。
2. 将经过验证的版本提交到本仓库，记录完整 40 位提交 SHA。
3. 在腾讯云免密连接的 root 终端下载该提交中的 `tools/deploy-ip-site.sh`。检查脚本后，执行 `bash 脚本路径 完整SHA`。
4. 脚本成功会打印 `DEPLOY_OK https://111.230.149.65/orchard/`。从外部设备打开该地址，再核对封面、登录、关卡及图片；检查失败不能当作已上线。

脚本只适用于上述已检查的服务器布局。下载版本固定到提交 SHA，游戏文件先验证后发布，网页目录只包含实际运行资源和校验清单。源美术、Git 历史、测试脚本和账号数据不进入网页目录。

原 80 端口游戏的代理路径保留，新增的两条路径用于证书验证和 `/orchard/` 跳转。游戏使用单独的 HTTPS 配置、版本目录及原子链接；开始修改网站配置前进行备份，部署失败时自动恢复配置和之前版本。

Nginx 重载后，新工作进程需要时间接管请求。脚本以有限次数的新连接检查 HTTP 验证文件和 HTTPS 游戏文件，收到 HTTP 200 且内容逐字节一致才继续；持续失败仍会回滚。重试部署 `036e28a9c0d61b2218e168a7c18ba4c9713a34a9` 时，会通过固定清单指纹、完整文件哈希及目录检查验证已下载的版本，验证成功后直接复用，避免再次下载美术源文件。

固定版本的校验基准必须从 `git cat-file blob 提交SHA:文件路径` 的原始字节生成。Windows 的 Git archive、检出及换行设置可能把文本转换成 CRLF，不能直接拿这种副本的文件哈希校验 Linux 上的发布版本。

后续升级可复用经过审查的旧发布资源。缓存白名单还包含 `3e7d4ec`、`75ac694`、`ebbc394` 各固定版本的原始 Git 运行文件清单指纹；使用前仍逐项检查文件哈希及完整目录，拒绝篡改或额外文件。验证通过后只需下载发生变化的 Git 对象，不能仅凭旧清单或文件数量认定缓存可信。

## HTTPS 与续期

登录使用 Web Crypto，公网普通 HTTP 无法使用当前密码验证，所以直接部署 HTTPS。IP 证书使用 Certbot 5.8 的 `webroot` 和 `shortlived`，安装在独立 Python 虚拟环境，不替换已有 Certbot 2.8。证书配置也与已有 `/etc/letsencrypt` 分开。IP 证书有效期约六天，脚本测试续期后启用每天两次的 systemd 检查及 Nginx 重载 Hook。

检查定时器：

```sh
systemctl status orchard-certbot-renew.timer --no-pager
systemctl list-timers orchard-certbot-renew.timer --no-pager
journalctl -u orchard-certbot-renew.service -n 30 --no-pager
```

若 Python 无法创建虚拟环境，先补装 `python3-pip` 后重跑；SELinux 启用但缺少策略工具时，补装 `policycoreutils-python-utils` 后重跑。脚本不会关闭 SELinux，也不会停止原网站以独占 80 端口。

原理来源：[Let’s Encrypt IP 证书与 Certbot 说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot/)、[Nginx HTTPS 配置](https://nginx.org/en/docs/http/configuring_https_servers.html)。

## 发布校验与存档

```sh
node tools/package-site.cjs
node tools/deploy-sparse-verify.cjs
node tools/package-site-verify.cjs
node tools/package-site-verify.cjs --site /实际发布目录
python3 tools/deploy-config-verify.py
python3 tools/deploy-world-config-verify.py
python3 tools/deploy-readiness-verify.py --site /实际的036e28a版本发布目录
```

发布包在 `deployment-artifacts/` 下，此目录不提交到 Git。`static-manifest.json` 记录每个运行文件的字节数与 SHA256。

关卡账号和存档仍保存在浏览器本地。`file://`、HTTP、HTTPS 是不同存储来源，部署不会自动把本地文件版的进度搬到新网址。新版共享世界使用单独的服务器账号和 SQLite 城池存档；关卡进度不会因接入世界服务而自动变成云存档。

## 共享世界的部署衔接

先使用本脚本发布包含 `frontier-ui.js` 和 `frontier-rewards.js` 的新静态版本，再使用同一固定提交中的 `tools/deploy-world-server.sh 完整SHA` 安装世界 API。它使用专用无登录用户、`orchard-world.service`、本机 8766 端口，以及独立的 `/opt/orchard-world` 和 `/var/lib/orchard-world` 目录。完整步骤及账号、数据、多人验收见 [WORLD-SERVER.md](WORLD-SERVER.md)。

世界代理使用受管 `# BEGIN ORCHARD WORLD API` / `# END ORCHARD WORLD API` 块。新版静态部署在开始改配置前验证它的完整性、所属 server 和固定本机 upstream、Origin/IP 头等指令；有效块保留原始字节并插入新 HTTPS 配置。首次未接入世界时照常发布静态游戏；重复、残缺、不安全或未托管的世界路由会中止部署，不会把它们静默丢弃。

后续升级仍先发布静态资源，再按需升级对应世界服务代码。数据库与静态版本目录独立，切换网页版本或回滚服务不会删除城池存档。旧版静态脚本可能覆盖世界代理，所以不能混用旧脚本升级有世界功能的新站点。

## GitHub Git 传输故障恢复

若 Git 拉取反复超时或返回 `Empty reply from server`，而 GitHub 官方 Contents API 可以下载，使用 `deploy-api-recovery.py` 和经过独立校验的 `deploy-api-release.json`。恢复数据固定一个完整的已审查提交，版本和原始字节证据在生成时记录；后续游戏代码改变时必须重新生成并审查恢复数据，不能把旧恢复包当作新版本。使用 `generate-api-release.py 完整提交SHA --node /node路径 --output deployment-artifacts/独立证据目录` 生成原始 Git 对象、清单与指纹，然后同步审查恢复程序里的固定提交、树、资源数量/大小、脚本哈希。小型精灵插画随清单内嵌，逐一校验原始 SHA256 和 Git blob，避免逐图下载消耗 API 请求额度。

程序先核对恢复数据的 SHA256、原始 Git 提交和树对象、所有文件的原始字节哈希，再检查旧发布目录的可信清单、完整文件哈希和目录。验证通过的旧文件直接复用，只通过正常验证证书的官方 API 下载变更文件。

所有需要的固定版本 Git 对象准备完成后，程序建立独立的本机版本库，只为本次两个安装进程设置 URL 重定向和 `GIT_ALLOW_PROTOCOL=file`。原始部署脚本保持原字节，仍执行完整发布验证、备份、原子切换、HTTPS 检查及各自的回滚流程；安装阶段不允许转回 GitHub Git 传输，也不改用户的全局 Git 配置或玩家数据库。

两个脚本分别报告状态。若网页成功而后台失败，不能报告整体上线；保留恢复工作目录和输出，修复失败部分后再次验证公网清单、全部运行资源及排行榜接口。

静态脚本的 `DEPLOY_OK` 与世界脚本的 `WORLD_API_READY` 只代表各自检查完成；对外报告新版完整上线前，仍需从公网验证正常 HTTPS、固定版本清单、全部运行资源，并使用两名玩家核对注册建家、通关领物资、征兵、公会及攻城。

## 已授权的线上清档

只有用户明确要求清空线上玩家数据时，才运行 `reset-online-data.py --commit 已部署SHA --manifest-sha256 原始清单指纹 --backend-sha256 原始后端SHA256`。程序仅接受固定生产站点、数据库及服务目录；先核对已经部署的版本、完整资源和带纪元保护的后端，再停止服务并用 SQLite 一致性备份保存恢复点，清空八张玩家数据表、更新 `player_data_epoch`，重启并核对空世界、空排行榜和旧纪元写入失效。任一步失败会恢复备份和服务；清档工具不进入公开网页目录。

浏览器里的账号、关卡进度、果园、养成和待同步记录在返回新版网页时按服务器纪元清理，重置后的数据改用独立存储名字空间。尚未联网的关闭页面无法远程清除物理存储，但其旧记录和旧票据不会进入新档；旧标签页也不能重新创建旧服务器账号或写回新纪元进度。本机 file/localhost 开发存档和其他网站不受线上清档影响。
