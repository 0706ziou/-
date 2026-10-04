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
node tools/package-site-verify.cjs
node tools/package-site-verify.cjs --site /实际发布目录
python3 tools/deploy-config-verify.py
python3 tools/deploy-readiness-verify.py --site /实际的036e28a版本发布目录
```

发布包在 `deployment-artifacts/` 下，此目录不提交到 Git。`static-manifest.json` 记录每个运行文件的字节数与 SHA256。

当前账号和存档仍保存在浏览器本地。`file://`、HTTP、HTTPS 是不同存储来源，部署不会自动把本地文件版的进度搬到新网址，也没有建立联网账号、跨设备存档或真人世界服务。
