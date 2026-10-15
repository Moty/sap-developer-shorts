import { readFile } from "node:fs/promises";
import { Ajv } from "ajv";
import { sourceFile } from "./paths.js";

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface TextRectangle extends Rectangle {
  fontSize: number;
}
export interface VideoLayout {
  schemaVersion: 1;
  canvas: { width: 1080; height: 1920 };
  criticalContent: Rectangle;
  headline: TextRectangle;
  demo: TextRectangle;
  presenter: Rectangle;
  captions: TextRectangle;
  note: string;
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validator = ajv.compile<VideoLayout>(
  JSON.parse(await readFile(await sourceFile("schemas/video-layout.schema.json"), "utf8")),
);

function contains(outer: Rectangle, inner: Rectangle): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function validateLayout(value: unknown): VideoLayout {
  if (!validator(value))
    throw new Error(`Video layout: ${ajv.errorsText(validator.errors, { separator: "; " })}`);
  if (!contains({ x: 0, y: 0, ...value.canvas }, value.criticalContent)) {
    throw new Error("Critical content bounds must fit inside the video canvas");
  }
  for (const name of ["headline", "demo", "presenter", "captions"] as const) {
    if (!contains(value.criticalContent, value[name])) {
      throw new Error(`Video layout ${name} must fit inside the critical content bounds`);
    }
  }
  return value;
}

export async function readLayout(): Promise<{ layout: VideoLayout; text: string }> {
  const text = await readFile(await sourceFile("config/video-layout.json"), "utf8");
  return { layout: validateLayout(JSON.parse(text)), text };
}
