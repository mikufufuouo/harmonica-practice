# 旋律谱转口琴 BD：架构与首版边界

2026-09-27 审计基线：`24c8c4e`（应用代码树 `8d94fae`）。本页记录新能力的契约与研究；当前交付状态只看 [STATE](STATE.md)。

## 现有能力与接入点

- `src/score/types.ts` 的 `NoteSequence` 已是与乐器无关的音符层：实际音高、可选节奏、休止、小节提示、来源、歌词。`validateNoteSequence` 是入库边界。简谱、MusicXML 和图片来源格式已预留。
- `src/score/fingering.ts` 当前只产生 10 孔 Richter **自然音**候选；`src/lib/harmonica.ts` 是该布局，不适用于 12 孔。指法必须按布局另建，并保留所有同音候选。
- `src/score-library.ts` 已有本地草稿、原图 Blob、确认后歌曲和 JSON 备份；旧草稿和 `makeSequence` 专为 BD 图片设计，简谱需要独立待校对对象或入口。`src/private-library-ui.ts` 可展示已保存序列。
- 当前页面只有采样录音的回放，没有旋律播放、整曲跟练或音频检测。新增谱面可进入曲库和逐音看谱；未来检测仍受真实音频实验门槛约束。

## 数据流与责任

`原谱图片 → 本地识别候选/可编辑草稿 → 严格简谱解析 → NoteSequence v1 → 调音表查候选 → 全局路径选择 → BD 视图/本地歌曲`。

识谱负责提出可回看原图的文字、符号、位置和不确定处；它不得直接写 BD，也不得补造漏读的音。解析负责按**明确的**简谱调号、八度和支持的记号求实际 MIDI 音高；无法确定调号、八度、时值或发现不支持记号时给阻塞诊断。音乐规则、移调和指法选择为可重复测试的纯函数。未知节奏保留 `time:null`，不填虚构的 120 BPM 或四分音符。图像来源不能被 OCR 文字行列冒充精确坐标。

确认界面应并列展示原图、可编辑识别文本或音符、实际音高和 BD 候选/建议路径。OCR 输出一律待审；只有识别器确实提供的证据才标数值置信度，不能将语法合法视为识别正确。用户逐项/逐行校对并确认无漏行后，才经 schema validator 保存。校对试听使用规范化音高，是识谱检查，不是演奏检测。

## 12 孔与 10 孔规则

用户口琴为孔声 KB-12；[厂商页面](https://kongshengharmonica.com/products/kongsheng-kb-12-12-hole-chromatic-for-beginnera-and-professional-key-of-a-c-and-g-available)列有 C、G、A 调版本，且另有 [Orchestral tuning 版本](https://kongshengharmonica.com/products/kb-12-chromatic-harmonica-orchestral-tuning-tancy-signature)。型号本身不足以锁定调性和调音。标准 C Solo 的工作表每四孔重复吹 `C E G C`、吸 `D F A B`，按键各升半音；第 4/5 与 8/9 孔等有同音。将每个动作记为 `{pitch,hole,breath,slide}` 并保留候选。此表须在用户确认琴身调性/版本及音位后才称为其个人琴的已核对映射。可参考 [Hohner 12 孔标准 Solo 图](https://www.hohner-cshop.de/out/media/pdf/CX-12_en.pdf)，但它不能替代孔声的实际音位表。

路径选择可对相邻事件做小型动态规划：跳孔、换气和推键切换各有明确代价；同音全部候选参与搜索，休止可分句。手选某个合法候选时锁定该事件再重算，不改变歌曲音高。代价是演奏偏好，不是物理准确率；以后按用户试吹调整。

10 孔 Richter 为下一阶段：自然音、弯音、超吹/超吸分别建动作与技巧难度；每种琴调和布局有独立可达表。原调版固定旋律音高，易吹版允许用户许可的移调/移八度及换琴调，在候选技巧难度和整句移动代价上优化，并清楚显示对原曲做了什么变化。当前 10 孔自然音能力不能冒充该阶段完成。

## 首版范围与门槛

2026-09-27 用户将首版入口选为 **Agent 找谱优先**。用户点歌后，Agent 查找可公开访问且来源清楚的单旋律谱，优先结构化 MusicXML/MIDI，其次可核对的简谱文本/图片；核对调号、八度、时值、声部与重复后，生成受 `validateNoteSequence` 检查的本地 JSON。用户在 PWA 导入、查看实际音高与 C 调 KB-12 的 BD 候选/建议路径，再保存到曲库。原谱的链接、格式和哪些信息是人工推断的，须在交付时注明。找谱属于当前 Agent 协作流程；PWA 自行搜索、下载和解析全网资源不在首版范围。

首个代码增量聚焦 12 孔确定性指法、候选/手选与已保存歌曲展示，复用现有 NoteSequence JSON 导入；可加严格的简谱文本适配器作为 Agent 交接格式，但不得把它或普通文字 OCR 宣称为通用图像识谱。图片 OCR/OMR 回到后续入口：只有拿到代表性谱图并证实校对时间有收益，才集成完整图像识谱草稿。原图只保存在本机，不进入公开仓库。

KB-12 Solo 当前映射从 C4 起步，旋律低于该范围时，演奏视图可选原八度或升高八度（+12 半音）。偏移只作用于 BD 指法候选与手动覆盖校验；`NoteSequence` 仍保留来源音高。曲库 `chromaticProfile.octaveShift` 记录选择值（0 或 12）；旧条目没有此字段时按 0 解释。切换偏移后旧的手选指法清空并按新音高重算。

Agent 拿到可核对的简谱文字后，可在本机以 `1=C` 等明确调号开头整理到文本文件，再运行 `npx tsx scripts/jianpu-to-sequence.ts 输入.txt 输出.json --title 曲名 --source-url https://谱源`。此适配器只接受单旋律的有限记号：`1–7`、`#`/`b`、后缀 `'` 升八度或 `.` 降八度、`|` 小节线；未知节奏留未知，休止/时值线等未支持符号直接报错。生成的 JSON 仍须在 PWA 逐音校对和确认。MusicXML/MIDI 当前只是未来可找的可靠源格式，尚无应用内解析器；Agent 需要先正确转写为统一 JSON，不能把这一步称为自动导入。

对于 [jianpu.space](https://jianpu.space/zh-tw/TODO) 的公开文本，独立脚本 `scripts/jianpu-space-to-sequence.ts` 按该站记谱语法解析 `/key(...)`、全角 BPM、八度、休止、时值、跨小节延音及小节线，输出带来源行列的 quarter 时间轴；未知记号会阻止整个导入。`/key(Bb3)` 的 `3` 是绝对音区，不能只取调号而把旋律抬到 Bb4。脚本仍不证明网友转录与录音一致，也不把歌词逐字自动对齐。歌曲原文与导出 JSON 均留在 Git 忽略的私人目录；公开仓库只放解析器与自造测试片段。

这一包的自动验收是：C Solo 全 48 个动作映射、边界与同音候选、路径选择/手选、导入验证、保存与重新打开。产品验收另需在用户设备用其 C 调 KB-12 对照实际音位，并用用户点名的歌曲核对原谱→音符→BD 的整条链；未做这些实测前，不宣称“任意谱一找即准确”。

## 工具调查与后续

[jpeditor](https://github.com/lodebar2026/jpeditor)（MIT）已有浏览器本地简谱 OMR：图像几何解析点/时值线，PaddleOCR 识字，源图叠加校对；其识别器与自家编辑器耦合，未提供现成独立 PWA 包，公开仓库也未附回归语料。可拿真实样本做独立试验后决定是否移植；不能仅因演示可用就假定对网上谱通用。通用 Tesseract OCR 只能作文字候选，无法可靠恢复上下八度点和时值线。

五线谱图片以后先考虑用户提供 MusicXML：[Audiveris](https://github.com/Audiveris/audiveris) 可在桌面校对 OMR 并导出 MusicXML，但其 Java/AGPL 部署形态不宜直接嵌入当前 PWA。MusicXML/MIDI 导入应作为独立适配器接入同一个 NoteSequence，并显式选择旋律声部；PDF 和自动选调在来源/指法两侧分别扩展。
