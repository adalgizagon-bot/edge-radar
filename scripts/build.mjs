import { copyFile, mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await Promise.all(
  ["index.html", "style.css"].map((f) => copyFile(`web/${f}`, `dist/${f}`)),
);
console.log("Frontend compilado em dist/");
