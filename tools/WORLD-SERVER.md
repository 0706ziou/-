# 共享世界服务

世界模块使用 Python 标准库和 SQLite 保存账号、城池、资源、部队、公会及战报。前端调用同源 `/api/world/` 接口。静态关卡发布与世界服务是两个部分：只上传 HTML、CSS、JS 文件不会启动共享世界。

## 通关排行榜

关卡页的「通关排行」可直接查看所有玩家的最高通关关卡、自己的名次和分页列表，无需进入世界玩法。榜单由同一账号后台保存，按最高已通关关卡降序排名，同关卡并列；同层先到达的玩家先展示。未通关账号不进入榜单。

正式关卡胜利通过 `POST /api/world/campaign/complete` 登记该账号本局的服务器票据，立即记榜并解锁下一关票据。它不发世界资源，原世界物资的60秒领取与冷却规则继续执行。`GET /api/world/leaderboard?page=1` 返回每页20条和当前登录玩家的独立排名，历史已领奖的关卡记录也计入成绩，100关通关与仅解锁100关区分统计。

浏览器已有的本地进度不会直接上传为榜单成绩。断网后成功通关的已签票据保留在本机待同步队列，重新登录后重试；从未连接账号后台的离线挑战仍只保存本地进度。前端不得直接提交一个层数来修改名次。关卡战斗仍在浏览器运行，票据登记不等于服务器完整验证战斗过程。

验证：`python tools/leaderboard-server-verify.py`、`node leaderboard-ui-verify.cjs`、`node leaderboard-integration-verify.cjs`、`node frontier-rewards-verify.cjs`。

## 本地启动

在仓库根目录运行：

```sh
python tools/world-server.py --host 127.0.0.1 --port 8766 --db .world-server-data/world.sqlite --site .
```

然后打开 `http://127.0.0.1:8766/index.html`，登录游戏后会自动连接同名世界账号；点击「世界」进入地图，点击「回到主城」进入自己的建筑区。服务和网页必须同源；继续使用原来仅提供静态文件的 8765 端口不会自动获得 8766 的接口。

要沿用已有的 `http://127.0.0.1:8765/index.html` 关卡账号和存档，停止原来的静态预览后，将上方命令改为 `--port 8765`。更换端口会改变浏览器存储所属的网址；数据库仍可指向同一个文件。

世界账号名称固定为当前关卡守护者名字，游戏登录会通过同源接口连接世界：尚无世界记录时登记同一名字和密码，已有记录时验证世界密码或同名有效会话。旧世界密码与游戏密码不一致且没有同名有效会话时，只显示一次旧世界密码验证，不会覆盖既有账号；确认归属后将世界密码改为当前游戏密码，保留家园数据。跨设备使用完全相同的名字（包括大小写）和游戏密码取回服务器中的城池，关卡本地存档仍不会跨设备同步。旧版超过 7 个字符的本地名字不能直接新注册世界账号。

用于世界自动重连的游戏登录凭证仅保存在当前页面私有内存，不写入本机账号记录、关卡存档、日志或待领取奖励；退出游戏及切换账号时清除。服务器只保存加盐 PBKDF2 密码校验值与 HttpOnly 会话 Cookie。公网服务必须通过正常验证证书的 HTTPS 使用。

`.world-server-data/`、SQLite 文件及日志均属于运行数据，不应提交到 Git 或放进公开静态发布目录。停止服务后重新启动并指向原数据库即可保留世界。备份数据库时应使用 SQLite 的一致性备份或在服务停止后复制数据库及其状态，不能只在写入期间任意复制主文件。

## 服务器接入

当前目标站点见 [DEPLOYMENT.md](DEPLOYMENT.md)，其游戏路径为 `/orchard/`。前端世界接口使用站点根路径 `/api/world/`，因此 Nginx 需要同时保留 `/orchard/` 的静态服务和 `/api/world/` 的反向代理。

先按静态发布流程部署含 `frontier-ui.js` 和 `frontier-rewards.js` 的新版本，再在服务器 root 终端运行同一固定版本的安装脚本：

```sh
bash /已校验脚本目录/deploy-world-server.sh 完整的40位提交SHA
```

`deploy-world-server.sh` 不在本地执行服务器操作。它仅适用于已存在的受管 HTTPS 站点，会取回该提交的原始 `tools/world-server.py` Git blob，校验固定 SHA 及代码格式；既有同版本文件也必须与原始 blob 完全一致才能复用。安装脚本本身也应来自已审查、已校验的固定版本。

脚本使用独立的 `/opt/orchard-world` 版本目录和 `/var/lib/orchard-world/world.sqlite` 数据库，专用无登录用户 `orchardworld`、仅本机监听的 8766 端口及 `orchard-world.service`。发现未托管目录、配置或端口占用时会停止。修改前保存配置、服务和旧版本指向，失败恢复它们并保留数据库；不会删除原网站。

脚本的 `WORLD_API_READY` 表示 API 进程和受信 HTTPS 路径通过就绪检查，还需要完成下方的两人玩法及公网验收才能对外报告新版世界已上线。检查命令：

```sh
systemctl status orchard-world.service --no-pager
journalctl -u orchard-world.service -n 40 --no-pager
curl --fail --show-error https://111.230.149.65/api/world/health
```

手动管理时，应准备一个由服务账号可读的固定版本目录和独立的可写数据目录，再启动服务，例如：

```sh
python3 /实际版本目录/tools/world-server.py \
  --host 127.0.0.1 --port 8766 \
  --db /var/lib/orchard-world/world.sqlite \
  --public-origin https://111.230.149.65 --secure-cookie
```

生产环境由 systemd 托管进程并设置 `Restart=on-failure`，工作目录、脚本路径和数据库目录应明确指定。安装脚本同时配置只读系统目录、独立可写数据库、禁止提权和资源限额。数据库目录不使用网页发布目录或会被静态版本切换删除的临时目录。

在现有 HTTPS 站点配置内增加代理路径，修改前备份原配置：

```nginx
location ^~ /api/world/ {
    proxy_pass http://127.0.0.1:8766;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_read_timeout 15s;
}
```

服务仅监听本机，外部玩家通过现有 HTTPS 443 端口访问。公网 Origin 必须与 `--public-origin` 完全匹配，不能把 IP 站点的配置用于其它域名后仍保持旧值。生产 POST 接口还会验证来自本机代理的 `X-Forwarded-Proto: https`；Nginx 必须覆盖 `X-Real-IP`，以便请求限流按真实访问者分组。

如果 SELinux 阻止 Nginx 连接本机 API，HTTPS 验收会失败并回滚。应先查看服务日志与 SELinux audit 记录，针对该代理连接制定最小策略；脚本不会关闭 SELinux 或自动放开全局网络限制。

世界代理块用 `# BEGIN ORCHARD WORLD API` / `# END ORCHARD WORLD API` 标记。新版 `deploy-ip-site.sh` 在修改配置前检查此块的结构和代理指令，合法块会按原始字节保留；残缺、重复或不安全块会中止发布。首次没有此块时照常发布静态游戏。后续先发布网页，再按需运行固定版本的世界安装脚本升级 API；不要使用会覆盖代理块的旧版静态安装脚本。

先验证服务启动，再执行 `nginx -t` 和配置重载。重载后以有上限的新连接重试核对公开接口及静态游戏；不能只依据重载命令退出成功报告上线。HTTPS 检查保留正常证书验证。任何失败都应定位原因，必要时恢复旧配置和旧版本，不删除原网站。

静态资源的发布清单沿用项目 AGENTS.md 和 DEPLOYMENT.md 的固定提交原始字节校验规则。新增世界服务的脚本、网页资源及对应版本必须一起记录；数据库不进入发布清单。

## 账号与写入规则

服务器使用 PBKDF2 保存密码校验值，HttpOnly 会话 Cookie 用于后续请求。写操作要求 JSON、合法会话与精确同源 Origin，服务器不开放跨域接口。

`POST /api/world/enter` 接收 `{name,password}`，供游戏登录后自动登记或接入世界。已存在同名记录时，只有正确密码或同名有效会话才能进入；后者允许把已经证明归属的家园连接到当前游戏密码。需要旧密码验证时返回 `world_link_required`，不改变存档。`POST /api/world/link` 接收 `{name,password,worldPassword}`，验证原世界密码后保存新的游戏密码，撤销原有会话并签发新会话。原密码错误时不改变家园或凭证。旧版 `register`、`login` 接口继续兼容，前端不再提供第二套常规登录表单。

所有资源成本、地块归属、建造等级、训练队列、公会权限、保护时间与攻城结果在服务器校验。`/api/world/action` 写入必须携带 `accountName`（当前世界名字）、唯一 `requestId` 及操作 `type`；会话账号与 `accountName` 不一致时拒绝操作，防止其它标签页切换 Cookie 后修改错账号。写入按请求编号与操作内容幂等处理；重试不会再次扣除同一笔资源，同编号改成其它操作会被拒绝。

主城建筑增加伐木场、采石场、铁矿场，与农田分别生产木材、石料、铁矿、粮草。生产量按服务器时间累计，`state.self.home.production` 提供每座建筑的物资类型、每分钟产量、待收取量、储存上限及下一次产出时间。`action` 的 `type: "harvest"` 配合 `building` 收取一座建筑，`type: "harvest-all"` 收取全部；仓库不足时余量保留，读取状态不会直接将产出写入库存。旧自动农田产出迁移为待收取量，原库存不变。

`state.self.squads` 保存最多三支命名小队。`type: "squad-save"` 接收 `name` 和 `units: {infantry,archer,cavalry}`，新建时省略 `squadId`，编辑时带上已有编号；`type: "squad-delete"` 解散指定小队。小队只能分配已完成训练的现有士兵，不产生额外兵力，也不能重复分配。攻城可带 `squadId` 选择一支小队，省略时使用全军；所有归属、数量与战损均由服务器处理。小队出征的损失从该小队与总兵力同步扣除，全军出征或防守后再按剩余兵力调整分配；战报包括 `deployed`、`squadId` 与 `squadName`。

正式关卡开始时申请 `/api/world/campaign/start` 挑战凭证，通关后通过 `/api/world/campaign/claim` 请求固定奖励。服务端逐关解锁、要求至少经过 60 秒、凭证有效期为 2 小时，且同一账号成功发奖间隔至少 60 秒；重复结算返回原结果。同一关的重玩使用新的挑战凭证，新挑战不会取消其它未到期的待领取凭证。新手训练、无尽模式和战败不发放世界材料，旧浏览器通关记录也不会批量补领。

挑战的时间与结算不能验证浏览器内每个战斗动作。当前版本适合进行共享世界玩法体验；正式竞争玩法还需要独立的服务端战斗验证与运维容量验证。

## 验收

离线验证不接触真实站点：

```sh
python3 tools/world-server-verify.py
python3 tools/deploy-world-config-verify.py
python3 tools/deploy-config-verify.py
```

用两个不同的测试账号完成以下流程：一次游戏登录自动进入世界、建家、通关领物资、建筑升级、按建筑及全部收取、仓库满时保留待收取量、定时征兵、编组与解散小队、创建与加入公会、查看彼此城池。用已有世界存档验证同名会话连接及旧密码一次绑定，核对家园和物资保留、错误密码不覆盖、过期会话自动重连及账号切换不会操作错玩家。保护和冷却到期后分别验证小队与全军攻城，核对参战部队、双方兵力、物资及战报。再验证同公会不可互攻、保护中目标不可攻、重复请求不重复奖励或扣费。

重启世界服务后再次登录，核对城池、资源、公会和战报仍在。最后从外部网络使用正式 HTTPS 网址访问页面及接口；只有静态清单、全部运行资源和世界操作都通过，才可对外报告新版世界已上线。
