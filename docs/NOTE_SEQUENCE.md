# 统一歌曲数据与 BD 适配设计

决策日期：2026-09-14。用户要求公众号 BD 文本先可用，但歌曲底层不能依赖 BD。第一包实现统一数据、BD 导入、口琴映射和预览；MIDI / MusicXML / 简谱 / 音频转录的解析器分期接入。

## 三层分工

原文件 → 导入适配器 → NoteSequence（歌曲的实际音高、顺序和可知时间）→ FingeringPlan（针对某把琴的指法）→ 谱面视图 / 后续跟练。

歌曲不持有唯一 BD 指法。导入来源里可保留原文与原指法提示，但缺少这些信息不影响歌曲有效性。更换口琴仅重新求解指法；只有显式移调操作才改变演奏音高。移调生成演奏视图，不修改原歌曲。

原谱调、歌曲调和手中口琴调分别处理。BD 是依赖乐器的相对指法，导入时必须指定原谱使用的琴调/布局；不能从 `4B` 猜出实际音高。简谱以后也必须有 `1=...` 及八度规则，不能把它默认为 C 调。

## v1 编码契约（TypeScript 与 JSON）

实现文件由 Terra 提供，外部入口统一由 `src/score/index.ts` 导出。

- `Fraction { numerator: number; denominator: number }`：安全整数，分母 >0；四分音符为 1。避免三连音被浮点或固定 ticks 刻度截断。
- `Pitch { midi: number; cents: number; spelling?: string }`：midi 为 0–127 整数、cents 为有限偏移，实际发声音高；例如 C4=60。这个数字是音高坐标，不代表歌曲被保存为 MIDI 文件。拼写是记谱保真信息，不能代替实际音高。
- `EventTime`：`null`（节奏未知），或 `{ unit: 'quarter'; start: Fraction; duration: Fraction | null }`，或 `{ unit: 'second'; start: number; duration: number | null }`。未知时值与零时值不同，零时值可用于未来装饰音；非空时间不能为负。
- `SourceRef`：`sourceId`，可选且成对的 1-based `line`/`column`、`token`，可选 `region:{page:number;x:number;y:number;width:number;height:number}`。page 从 1 开始，坐标为对应原图宽高归一化值，矩形不能越界。这样文本定位与图片定位共用来源引用。

文本列号按原文 UTF-16 code unit 计，与浏览器 textarea 偏移语义一致；全角规范化不改写保存的原 token。图片区域与 OCR 识别字符串分开，不能以重排后的文字列号代替原图坐标。
- `SequenceEvent`：稳定 `id`、`trackId`、`voiceId`、非负整数 `order`、`time`；`kind:'note'` 带 `pitch`，`kind:'rest'` 无音高。可选 `tieGroupId`、`sourceRef:SourceRef`、`confidence`（0–1，转录证据，不能冒充正确率）。同起点的多个 note 可表示和弦，不能由数组相邻推断同时发声。
- `NoteSequence`：`schemaVersion:1`、`id`、`title`、`timeBase:'unmetered'|'quarter'|'second'`、`tracks:[{id,name}]`、`events:SequenceEvent[]`、`tempoMap:[{at:Fraction;bpm:number}]`、`meterMap:[{at:Fraction;beats:number;beatType:number}]`、`annotations:[{kind:'line-break'|'barline'|'text';beforeEventId?:string;text?:string}]`、`sources:[{id;format:'bd'|'midi'|'musicxml'|'jianpu'|'audio'|'native';rawText?:string;instrument?:{key:Key;layout:'richter-major'}}]`。tempo/meter 仅用于 quarter 时间轴，未知不自动填 120BPM 或 4/4。
- 用户补充实际输入为 BD+歌词图片：sources.format 另允许 `'image'`；NoteSequence 必含 `lyrics:Array<{id:string;text:string;eventIds:string[];alignment:'unassigned'|'manual'|'imported';sourceRef?:SourceRef}>`（无歌词即空数组）。eventIds 引用整行对应的 note，不引用 rest，歌词 id 唯一。`unassigned` 必须 eventIds 为空；当前 BD 文字中歌词以此形式保留。整行对应事件范围不等于逐字/逐音节对齐，未来精细对齐作为显式可审查的扩展，不能用字符数猜。
- `validateNoteSequence(value:unknown)` 返回 `{valid:boolean;errors:string[]}`，不能仅做 TypeScript 强制转换。验证版本、id 唯一、track/source/annotation 引用、pitch、时间域一致、数值合法、事件顺序、tempo/meter；不排斥多声部同时音，不把休止算音符。
- `importBdText(text:string,options:{sourceKey:Key|null;title?:string}): {sequence:NoteSequence|null;diagnostics:ImportDiagnostic[]}`。diagnostic 有 `severity:'error'|'warning'|'info'`、`code`、`message`、1-based `line`/`column`、`token`。有 error 时不产出正式序列，防止悄悄漏音；无音符或原谱琴调未指定是 error。
- `generateFingeringPlan(sequence:NoteSequence,targetKey:Key,options?:{transposeSemitones?:number})` 返回 `{targetKey;transposeSemitones;items:FingeringItem[]}`。每项 `eventId`、`status:'mapped'|'ambiguous'|'unplayable'|'rest'`、`candidates:[{hole:number;breath:'B'|'D';label:string;technique:'natural'}]`、可选 `preferred`（同结构）、`reason?:string`。候选保留全部同音替代；原谱指法可作为偏好，但不能删掉其他候选。含微分音、范围外、需要未支持技巧均明确不可用。

`Key` 沿用当前支持的 C/G/A/D/F/Bb 标准音区，布局能力以后扩展，不宣称支持所有琴型。同一个 MIDI 音在同一琴调可能有 2D/3B 两个解。当前只返回自然单孔解，不生成未经验证的压音/超吹指法。复音仍保留多个独立事件映射；不宣称它们合在一起能同时在口琴奏响，未来需要额外的可演奏性检查。

图片入口的原始结果应是 `ImportDraft`，含图片资产引用、区域、BD/OCR 候选及审核进度；确认后通过同一个 validator 成为歌曲。不要把 OCR 识别输出本身称为最终歌曲格式，详见 [IMAGE_IMPORT.md](IMAGE_IMPORT.md)。

## 第一种适配器：公众号 BD 文本

先支持 1–10 后接 B/D，大小写、全角字母/数字/空格、`4 B`、`4B4D5B` 连写，换行及逗号/顿号/分号和小节竖线。保留原文与行列来源，换行与竖线只作排版提示，不推断拍号/节奏。

含歌词或标题的文字作为未对齐文本保留并提示，不自动把歌词字数对齐音符。未知数字/疑似错写音符、压音撇号、延音线、括号和弦、重复记号等尚不支持的音乐符号须定位并报错，不能提取其中可识别部分后宣称完整成功。用户可去掉不属于谱面的文字或按诊断修正再导入。

对于 BD 本身未提供的节奏，每个事件 `time:null`、`timeBase:'unmetered'`，tempo/meter 为空。后续可以逐音跟练，但此时不能评分节奏。缺少原谱琴调时只给修正提示，不制造绝对音高。

公众号文本没有单一标准；当前兼容范围必须明示。尚未拿到用户样例，不能声称已全面兼容常用公众号。用户样例到达后作为本地兼容性用例，除非用户授权，不把整篇受版权保护的歌曲/文章提交到公开仓库。

## 导入顺序与扩展规则

| 来源 | 音高来源 | 时间来源 | 后续适配器重点 |
|---|---|---|---|
| BD，本包 | 原谱琴调 + 布局 + 原指法 | 不提供即未知 | 保留原文、位置、未识别诊断 |
| MIDI | note number + pitch bend（后续策略） | ticks/division + tempo map，SMPTE 则秒时间轴 | 按 track/channel 分离，选旋律，不把伴奏串成旋律 |
| MusicXML | written pitch + transpose = sounding pitch | duration/divisions，保留 voice、tie、rest | 重复展开、复音、弱起、谱面拼写分别处理 |
| 简谱 | 调号 + 级数 + 升降与八度 | 方言规则下的时值与连线 | 按明确方言适配，未知符号不猜 |
| 音频转录 | 候选发声音高 + 置信度 | 秒起止 | 保留未量化时间，节拍估计/量化另做可撤销步骤 |

扩展到 MIDI/MusicXML 时不是改写所有歌曲对象，而是新增适配器并通过共同 validator。需要完整雕版/精确往返的信息（布局、装饰、repeat source graph 等）存来源或独立 notation 扩展，NoteSequence 不是完整乐谱文件替代品。表现性速度、音量、连续弯音曲线等需要下个版本的演奏扩展，不能在适配器里静默丢弃，必须输出 loss diagnostics。

本包不提供 MIDI/MusicXML 文件上传按钮，不制造空壳“已支持”。用人工构造的 quarter 时间轴、和弦/休止/连音、seconds 转录样本验证共同数据层确实能表达这些输入。

## 验收

1. `4B 4D 5B` 在原谱 C 琴导入为 72/74/76，均无臆造时间。
2. 原谱 C → 当前 D 琴，默认保持实际音高，不偷偷移调；显式 +2 半音后可映射为 D 琴 4B/4D/5B，原序列不变。
3. C 琴的 G4 保留 2D 与 3B；非自然音/微分音/超范围返回明确不可用。
4. 全角、连写、多行和文字提示可审查；`11B`、`4X`、`4D'`、`[4B 5B]`、`4B-` 不能被默默截取成合法单音。
5. JSON 导出的是歌曲序列，不是仅一个 BD 字符串；原指法处于 source 元信息。非法 schema/time/id/ref 被拒绝。
6. 原始谱文改动后旧预览失效，导出不可用，避免用户导出上一版；所有用户文本用 textContent 展示。
7. 不需要麦克风就能导入、切换琴调、移调、查看候选及导出；已有采样功能照常。

## 资料依据

MusicXML 的 duration/divisions 使用音乐时值，不能直接按秒或谱面形状解释：[W3C divisions](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/divisions/)、[W3C duration](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/duration/)。写谱音与发声音也需区分：[MusicXML MIDI-compatible tutorial](https://www.w3.org/2021/06/musicxml40/tutorial/midi-compatible-part/)。MIDI 文件含曲序、轨道、速度与拍号等信息：[MIDI Association](https://midi.org/standard-midi-files)。上述统一对象与分期为本项目设计决定，并非这些标准的完整实现。
