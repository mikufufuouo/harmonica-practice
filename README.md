# 口琴单音采样实验台（阶段 0A）

这是后续“纯净单音 / 串孔”算法的本地数据采样实验台，不包含任何音高识别或串孔判定。虚拟口琴上点选的孔位、B/D 与采样标签均为使用者的意图记录，不能当作识别结果。

## 运行

```bash
npm install
npm run dev
```

另有 `npm run typecheck`、`npm test` 与 `npm run build`。开发服务器在桌面浏览器通常通过 `localhost` 获得麦克风权限；手机与平板必须以 HTTPS 访问，单纯局域网 HTTP 不可用。

产品边界、架构及采样规程见 [docs/PRODUCT.md](docs/PRODUCT.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[docs/EXPERIMENT.md](docs/EXPERIMENT.md)。

## 采样与隐私

浏览器请求关闭回声消除、噪声抑制和自动增益，页面会显示浏览器实际返回的 track settings；`unknown` 表示浏览器未报告，不能据此认为已关闭。音频经 `AudioWorklet` 取得原始单声道 PCM，只保存在当前页面内存。只有点击导出时才下载 WAV 或 JSON 元数据；刷新、离开页面或停止麦克风都会释放资源，页面不会上传、回放监听或自动持久化录音。

单次采样上限五秒。采样过程可取消，麦克风运行时回放会被禁用以避免反馈。

## 限制

- 只支持展示 10 孔 Richter 布局；C/G/A/D/F/Bb 转调只是显示参考，请依实际口琴确认。
- 尚未验证手机麦克风、浏览器处理链与各种口琴的采样可比性。Worklet 以 2048 个样本为批次传给页面，因此开始/结束边界最多会受一个批次影响；导出的时长本身按实际 PCM 样本数计算。
- 本阶段不含 PWA service worker、谱面、跟练、演奏报告，尤其不应把它误解为已经成功判断串孔。
