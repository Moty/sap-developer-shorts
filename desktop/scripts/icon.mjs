import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createCanvas } from "@napi-rs/canvas";

const set = resolve("desktop/vendor-cache/App.iconset");
await mkdir(set, { recursive: true });
for (const size of [16, 32, 128, 256, 512])
  for (const scale of [1, 2]) {
    const side = size * scale,
      canvas = createCanvas(side, side),
      context = canvas.getContext("2d");
    context.scale(side / 1024, side / 1024);
    const fill = context.createLinearGradient(0, 0, 1024, 1024);
    fill.addColorStop(0, "#344ba5");
    fill.addColorStop(1, "#101e37");
    context.fillStyle = fill;
    context.beginPath();
    context.roundRect(28, 28, 968, 968, 220);
    context.fill();
    context.fillStyle = "#d7ff68";
    context.font = 'bold 680px "Helvetica"';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("S", 505, 550);
    await writeFile(
      resolve(set, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
      canvas.toBuffer("image/png"),
    );
  }
await promisify(execFile)("/usr/bin/iconutil", [
  "-c",
  "icns",
  set,
  "-o",
  resolve("desktop/payload/app.icns"),
]);
