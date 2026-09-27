import { readFile, writeFile } from "node:fs/promises";
import { parseJianpu } from "../src/score/jianpu.ts";
import { validateNoteSequence } from "../src/score/validate.ts";

const [input, output, ...flags] = process.argv.slice(2);
const option = (name: string) => {
  const index = flags.indexOf(name);
  return index >= 0 ? flags[index + 1] : undefined;
};
const title = option("--title");
const sourceUrl = option("--source-url");
if (!input || !output || !title || !sourceUrl) {
  console.error(
    "用法：npx tsx scripts/jianpu-to-sequence.ts 输入.txt 输出.json --title 曲名 --source-url https://谱源",
  );
  process.exitCode = 1;
} else {
  try {
    const text = await readFile(input, "utf8");
    const parsed = parseJianpu(text, { title });
    if (!parsed.sequence) throw new Error(parsed.errors.join("；"));
    parsed.sequence.sources[0]!.url = sourceUrl;
    parsed.sequence.sources[0]!.description = "Agent 核对的简谱文本；节奏未知";
    const checked = validateNoteSequence(parsed.sequence);
    if (!checked.valid) throw new Error(checked.errors.join("；"));
    await writeFile(output, JSON.stringify(parsed.sequence, null, 2), "utf8");
    console.log(`已写入 ${output}（${parsed.sequence.events.length} 个事件）`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
