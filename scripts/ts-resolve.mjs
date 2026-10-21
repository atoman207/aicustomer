// scripts から src/lib の TypeScript をそのまま読み込むための import フック（Node 22.18 以降 / 24）
//   拡張子のない相対 import（"./env" など）と "@/…" を .ts に読み替え、JSON の import に type: "json" を付ける
//   使い方: node --import ./scripts/ts-resolve.mjs scripts/xxx.mjs
import { existsSync } from "fs";
import { register } from "module";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

if (!globalThis.__tsResolveRegistered) {
  globalThis.__tsResolveRegistered = true;
  register(import.meta.url, import.meta.url);
}

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

export async function resolve(specifier, context, next) {
  let spec = specifier;
  if (spec.startsWith("@/")) spec = pathToFileURL(path.join(SRC, spec.slice(2))).href;
  const relative = spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("file:");
  if (relative && context.parentURL && !/\.[cm]?[jt]sx?$|\.json$/.test(spec)) {
    const base = spec.startsWith("file:") ? fileURLToPath(spec) : path.resolve(path.dirname(fileURLToPath(context.parentURL)), spec);
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context);
    }
  }
  if (spec.endsWith(".json")) return next(spec, { ...context, importAttributes: { type: "json" } });
  return next(spec, context);
}

export async function load(url, context, next) {
  if (url.endsWith(".json")) return next(url, { ...context, importAttributes: { type: "json" } });
  return next(url, context);
}
