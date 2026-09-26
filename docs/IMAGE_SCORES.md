# 私人图片曲谱库

2026-09-26：原图直接作为可阅读资源，不要求 OCR、BD、琴调或音符确认。现有 BD 转录入口和 NoteSequence v1 保持兼容。

## 使用与备份

首页「我的曲库」接收一个 ZIP 谱包，或包含 `manifest.json` 的完整文件夹；一次加入多首。手机/iPad 使用 ZIP，无需目录选择权限。重复导入按稳定歌曲 ID 更新，保留收藏、最近打开和已有 BD 关联。失败的整包事务回滚，不产生半首歌曲。

曲名搜索支持来源/标签，列表每批 30 首且只读取 metadata。图片谱默认适宽顶部显示；拖动浏览长图、滚轮/双指/按钮缩放，“整页”看概览，左右按钮/方向键翻页。只读取当前页 Blob，翻页/关闭释放对象 URL；页码、搜索与筛选在会话中保留，返回不重建曲库列表。全屏 API 不可用时使用覆盖视口的沉浸模式。

「备份图片谱 ZIP」包含 manifest 和所有原图，可在另一设备一次导入。原有 BD JSON 仍单独备份，不包含原图；图片谱包里的 `bdEntryId` 只是关联，不包含结构化音符。设备/浏览器/站点地址各有独立 IndexedDB，清除站点数据会删除曲库。保留原始 ZIP。单包压缩及解压总量限 750 MiB；打包/解包会占用内存，不等于支持无限大谱库，真机大包性能待验证。

## 资源契约

新增 `harmonica-image-scores` IndexedDB（v1），`songs` 存 metadata、`assets` 存 Blob；不迁移或改变旧 `harmonica-score-library` 数据库。保留独立资源边界，以免旧 OCR 草稿删除误删图片谱。

```json
{
  "format": "harmonica-image-scores",
  "version": 1,
  "songs": [{
    "id": "my-stable-song-id",
    "title": "自造练习谱",
    "source": { "name": "自己的谱库", "url": "https://example.com/score" },
    "tags": ["半音阶口琴"],
    "createdAt": "2026-09-26T00:00:00Z",
    "updatedAt": "2026-09-26T00:00:00Z",
    "pages": [{ "path": "scores/my-stable-song-id/001.png" }]
  }]
}
```

- `pages` 数组即阅读顺序，页码不依赖目录排序；path 必须是安全的包内相对路径。接受 JPEG/PNG/WebP/GIF。输入 assetId 不被信任，导入按歌曲 ID 和相对路径重建。
- `author`、`difficulty`、`key`、`tags`、`source` 可选；未知不推断。`favorite`、`lastOpenedAt` 为用户状态。原始图片与水印保持不变。
- `bdEntryId` 可关联旧谱库的 entry，同首曲目显示图片和 BD 两个入口。第一阶段仅预留关联字段，无自动标题合并或转谱；结构化音符仍必须通过 NoteSequence validator/人工转录流程。
- 运行时校验见 [image-score-library.ts](../src/image-score-library.ts)，ZIP 适配见 [image-score-package.ts](../src/image-score-package.ts)。后续转谱只新增/关联资源，不以空音符序列冒充已识别歌曲。

## 本地来源整理与增量更新

用户材料统一放在 Git 忽略的 `private-scores/`，不放 `public/`、`src/` 或公开测试夹。构建只发布应用外壳，SW 不缓存远程谱源，也不连接爱发电登录接口。

当前整理工具：

```sh
node scripts/prepare-image-scores.mjs \
  --index private-scores/panda-chromatic/source-index.json \
  --output private-scores/panda-chromatic
```

私有目录结构：`source-index.json`（访问/复制标记与实际图片 URL）、`manifest.json`、`scores/<来源文章 ID>/001.jpg`、下载校验缓存、`prepare-report.json`、`panda-chromatic.zip`。包内只含 manifest 与图片；授权索引/缓存/报告不打入包。

后续对 Agent 说“同步这个爱发电专辑并更新私人谱包”，提供专辑地址即可。Agent 在浏览器当前登录身份下重新核对访问状态和保存设置，收集当次网页返回的数据，写入本地 index，再运行上述命令；无需逐首命名或整理。若登录失效或保存权限不明确，停在该步骤请用户处理。不得复制 cookies、绕过付费墙或猜测受限图片 URL。

已观察到的页面接口为 `/api/user/get-album-post?album_id=...&lastRank=...&rankOrder=asc&rankField=rank`，沿 `list` 最后一项 `rank` 分页至 `has_more=0`；每项仅取 `post_id/title/pics/has_right/user.creator.can_copy_pic/user.name/publish_time/rank`，外加专辑 URL、抓取日期。此为当前站点适配线索，不保证永久稳定；先看实时页面/请求再复用。仅 `has_right===1 && can_copy_pic===1` 进入下载工具；失败/无图/受限内容均输出报告。图片下载不携带账号凭据，保留页面原始 URL 和水印。

验证结果与当前实际整理数量仅记 [STATE](STATE.md)。
