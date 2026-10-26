import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/electron/cli.js", import.meta.url)),
    fileURLToPath(new URL("..", import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env: process.env },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code) => {
  process.exitCode = code ?? 1;
});
