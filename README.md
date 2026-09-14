# 口琴单音采样实验台（阶段 0A）

这是后续“纯净单音 / 串孔”算法的本地数据采样实验台，不包含任何音高识别或串孔判定。虚拟口琴上点选的孔位、B/D 与采样标签均为使用者的意图记录，不能当作识别结果。

[手机试用](https://mikufufuouo.github.io/harmonica-practice/) · [当前进度与验证范围](docs/STATE.md)

## 新对话继续开发

在这个项目目录开启 Codex，对它说：**“继续口琴项目。”**

固定入口是 [AGENTS.md](AGENTS.md)，它要求先读 [STATE](docs/STATE.md) 与 [DECISIONS](docs/DECISIONS.md)，核对 Git 后按下一包继续。若宿主未自动加载入口，说“读 AGENTS.md，继续口琴项目”即可。每轮由主代理维护当前状态，Terra/Luna 回报实现与验证；无需手工整理聊天，详细流程和文档大小约束都在入口中。

## 运行

```bash
npm ci
npm run build
```

构建产物在 `dist/`，可部署到 Vercel、Cloudflare Pages 或任何 HTTPS 静态站点。另有 `npm run dev`、`npm run typecheck` 与 `npm test`。开发服务器在桌面浏览器通常通过 `localhost` 获得麦克风权限；手机与平板必须以 HTTPS 访问，单纯局域网 HTTP 不可用。iOS Safari 可通过“分享”→“添加到主屏幕”作为独立应用打开。

产品边界、架构及采样规程见 [docs/PRODUCT.md](docs/PRODUCT.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[docs/EXPERIMENT.md](docs/EXPERIMENT.md)。

## BD 谱面导入

页面提供可展开的“BD 谱面导入预览”面板，可粘贴公众号常见的短 BD 文本，选择原谱琴调后生成统一歌曲序列预览，并按当前口琴调显示候选指法。导出的歌曲 JSON 保存原曲 NoteSequence；歌词保留为尚未与音符对齐的原文。人工确认与本地曲库尚未实现。图片导入正在规划，可手工录入图片中的文字；当前不自动识别图片，也不承诺覆盖所有公众号格式。

谱面数据层和导入约定见 [docs/NOTE_SEQUENCE.md](docs/NOTE_SEQUENCE.md)；图片导入、人工校对与进入本地曲库的后续边界见 [docs/IMAGE_IMPORT.md](docs/IMAGE_IMPORT.md)。

## 采样与隐私

浏览器请求关闭回声消除、噪声抑制和自动增益，页面会显示浏览器实际返回的 track settings；`unknown` 表示浏览器未报告，不能据此认为已关闭。音频经 `AudioWorklet` 取得原始单声道 PCM，只保存在当前页面内存。只有点击导出时才下载 WAV 或 JSON 元数据；刷新、离开页面或停止麦克风都会释放资源，页面不会上传、回放监听或自动持久化录音。

单次采样上限五秒。采样过程可取消，麦克风运行时回放会被禁用以避免反馈。

生产构建会包含一个仅缓存本应用外壳的 Service Worker，离线时可打开已访问过的页面。它不缓存录音，录音也不持久化；不会自动跳过等待或刷新页面，以免中断采样。

## 限制

- 只支持展示 10 孔 Richter 布局；C/G/A/D/F/Bb 转调只是显示参考，请依实际口琴确认。
- 尚未验证手机麦克风、浏览器处理链与各种口琴的采样可比性。Worklet 以 2048 个样本为批次传给页面，开始/结束边界受批次和消息调度影响；导出的时长本身按实际 PCM 样本数计算。
- 本阶段已包含 PWA 安装、离线外壳和 BD 导入预览，尚无跟练或演奏报告，尤其不应把它误解为已经成功判断串孔。
