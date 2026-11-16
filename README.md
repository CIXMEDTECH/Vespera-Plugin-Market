# Vespera Plugin Market

[Vespera](https://github.com/CIXMEDTECH/Vespera) 面板内置插件市场使用的默认插件目录。插件包由作者自己托管，这个仓库只保存插件信息、下载地址和 SHA-256 校验值。面板在 **插件 → 插件市场** 里读取目录，下载安装包，核对 SHA-256 后再安装，安装后的插件仍需管理员审核权限才会启用。

The default catalog of the plugin market built into the Vespera panel. Plugin packages stay with their authors; this repository holds their metadata, download URLs and SHA-256 digests. The panel reads the catalog under **Plugins → Market**, downloads a package, checks its SHA-256 and installs it; an installed plugin still runs only after an admin approves its permissions.

## 目录 / Catalog

面板读取的地址：

```
https://raw.githubusercontent.com/CIXMEDTECH/Vespera-Plugin-Market/main/v1.json
```

可以在面板的 **系统 → Agent → 插件市场地址** 里换成自建的目录（格式相同即可）。设置了“下载加速前缀”时，GitHub 上的目录和安装包在直连失败后会经过加速前缀下载；安装包由 SHA-256 把关，目录本身总是先尝试直连。

`v1.json`：

```json
{
  "schema": 1,
  "updated_at": "2026-11-16T00:00:00.000Z",
  "plugins": [
    {
      "id": "status-image",
      "name": { "zh": "状态图片", "en": "Status images" },
      "description": { "zh": "…", "en": "…" },
      "author": "Vespera",
      "category": "display",
      "icon": "image",
      "version": "1.2.0",
      "vespera": ">=0.1.0-beta.8.3",
      "url": "https://github.com/CIXMEDTECH/Plugin-Status-Image",
      "download": "https://github.com/CIXMEDTECH/Plugin-Status-Image/releases/download/v1.2.0/status-image-1.2.0.zip",
      "sha256": "…",
      "size": 2078813,
      "permissions": ["nodes", "routes", "routes:public"]
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 必需。与插件 `vespera-plugin.json` 的 `id` 相同，1–32 位小写字母、数字、`-`、`_` |
| `name`、`description`、`author` | 字符串，或按语言给出的对象（`zh`、`en`） |
| `category` | `notify`、`monitoring`、`report`、`integration`、`security`、`display`、`utility` 或空 |
| `icon` | 与清单相同的图标名 |
| `version` | 必需。与安装包清单里的 `version` 完全一致 |
| `vespera` | 与清单里的 `vespera` 完全一致，例如 `>=0.1.0-beta.8.4`。面板版本不够时不能安装 |
| `url` | 项目主页。GitHub 仓库地址会被用来自动检查新版本 |
| `download` | 必需。安装包 zip 的 http(s) 地址，内容不能再变 |
| `sha256` | 必需。该 zip 的小写 SHA-256，面板安装前会核对 |
| `size` | zip 的字节数 |
| `permissions` | 清单申请的权限，安装前展示给管理员；真正生效的以清单为准，并在启用时再次确认 |

条目按 `id` 排序，`id` 不能重复。面板会忽略格式不对的条目，其余条目照常显示。

Entries are sorted by `id`, with no id twice. The panel leaves out malformed entries and shows the rest.

## 上架插件 / Submit a plugin

在 [Issue 页面](../../issues/new/choose) 选择模板：

- **在 GitHub 中开源的插件**：只填仓库地址和分类。最新 Release 里要恰好有一个插件 zip，标签与清单版本一致（`v1.2.0` 对应 `1.2.0`）。
- **非 GitHub 托管的插件**：填项目地址、固定版本的 https 安装包地址和分类。

Action 会下载安装包，按面板的规则检查 `vespera-plugin.json`（id、版本、脚本、权限、页面），计算 SHA-256，然后发起上架 PR 并在 Issue 下回复结果；PR 合并后 Issue 自动关闭。审核者需要关注插件申请的权限、可访问的主机和公开路由。

The Action downloads the package, checks its `vespera-plugin.json` the way the panel does, computes the SHA-256, opens a catalog pull request and replies on the issue. Reviewers should look closely at the permissions, hosts and public routes a plugin asks for.

插件开发见 [插件开发文档](https://github.com/CIXMEDTECH/Vespera/blob/main/docs/PLUGIN.md)。官方插件的仓库（如 [Plugin-Status-Image](https://github.com/CIXMEDTECH/Plugin-Status-Image)）带有可复现打包脚本和发布工作流，可以直接参考。

## 自动更新 / Release updates

`update-releases` 工作流每 6 小时运行一次：对托管在 GitHub 上的插件，如果最新 Release（含预发布）比目录里的版本新，就下载其中的插件 zip，核对清单 id、版本与标签，重新计算 SHA-256，然后发起更新 PR。PR 里会单独列出新增的权限。

Every 6 hours, for plugins hosted on GitHub: when the newest release (pre-releases included) is newer than the catalog's version, the workflow downloads its plugin zip, checks the manifest id and that the version matches the tag, recomputes the SHA-256 and opens a pull request, listing any new permissions.

每个改动目录的 PR 都会重新下载变更过的安装包，核对 SHA-256、id、版本、`vespera` 和权限是否与条目一致。

Every pull request that changes the catalog downloads the changed packages again and checks that the SHA-256, id, version, `vespera` and permissions match their entries.

## 本地命令 / Commands

只需要 Node.js 22，没有依赖。

```bash
node --test 'test/*.test.mjs'                 # 测试
node scripts/validate.mjs                     # 检查目录
node scripts/validate.mjs --write             # 排序后再检查
node scripts/validate.mjs --verify [id...]    # 下载安装包并核对
node scripts/update-releases.mjs --dry-run    # 看看有哪些插件发布了新版本
node scripts/add-local.mjs <zip> <download-url> [category]   # 用本地 zip 添加或更新条目
```
