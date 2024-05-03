import * as fs from "node:fs/promises";
import * as path from "node:path";
import {ZSTDDecoder} from "zstddec";
import decompress from "decompress";
import fg from "fast-glob";
import autoprefixer from "autoprefixer";
import postcss from "postcss";
import postcssNested from "postcss-nested";
import postcssSorting from "postcss-sorting";
import chokidar from "chokidar";
import {build} from "vite";
import solidPlugin from "vite-plugin-solid";
import unoCssPlugin from "unocss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import * as swc from "@swc/core";
import puppeteer from "puppeteer-core";
import {exit} from "node:process";

import {injectManifest} from "./scripts/injectmanifest.js";
import {injectXHTML} from "./scripts/injectxhtml.js";

//import { remote } from "webdriverio";

const VERSION = "000";

const r = (/** @type {string} */ dir) => {
  return path.resolve(import.meta.dirname, dir);
};

/**
 * Writes to a file with replacements
 * @param {string} filePath the path to write to
 * @param {Record<string, string>} replacements the replacements to make
 * @returns {Promise<void>}
 */
async function writeToDir(filePath, replacements) {
  const output = await swc.transformFile(filePath, {
    jsc: {
      parser: {
        syntax: "typescript",
        decorators: true,
        // ParserConfig declaration: export type ParserConfig = TsParserConfig | EsParserConfig;
        // @ts-ignore: importAssertions is not in the TsParserConfig, it is in the EsParserConfig
        importAssertions: true,
        dynamicImport: true,
      },
      target: "esnext",
    },
    sourceMaps: true,
  });

  let outPath = filePath
  for (const [key, value] of Object.entries(replacements)) {
    if (typeof value !== "string") {
      continue;
    }
    outPath = outPath.replace(key, value);
  }

  const outDir = path.dirname(outPath);
  try {
    await fs.access(outDir);
  } catch {
    await fs.mkdir(outDir, {recursive: true});
  }
  await fs.writeFile(
    outPath,
    output.code +
    "\n//# sourceMappingURL= " +
    path.relative(path.dirname(outPath), outPath + ".map"),
  );
  if (output.map) {
    await fs.writeFile(`${outPath}.map`, output.map);
  }
}

async function compile() {
  await build({
    root: r("src"),
    publicDir: r("public"),
    build: {
      sourcemap: true,
      reportCompressedSize: false,
      minify: false,
      cssMinify: false,
      emptyOutDir: true,
      assetsInlineLimit: 0,

      rollupOptions: {
        //https://github.com/vitejs/vite/discussions/14454
        preserveEntrySignatures: "allow-extension",
        input: {
          index: "src/content/index.ts",
          "webpanel-index": path.resolve(
            import.meta.dirname,
            "src/content/webpanel/index.html",
          ),
        },
        output: {
          esModule: true,
          entryFileNames: "content/[name].js",
        },
      },
      outDir: r("dist/noraneko"),

      assetsDir: "content/assets",
    },

    plugins: [
      tsconfigPaths(),
      unoCssPlugin(),
      solidPlugin({
        solid: {
          generate: "universal",
          moduleName: path.resolve(
            import.meta.dirname,
            "./src/solid-xul/solid-xul.ts",
          ),
        },
      }),
    ],
  });
  const entries = await fg("./src/skin/**/*");

  for (const _entry of entries) {
    const entry = _entry.replaceAll("\\", "/");
    const stat = await fs.stat(entry);
    if (stat.isFile()) {
      if (entry.endsWith(".pcss")) {
        // file that postcss process required
        const result = await postcss([
          autoprefixer,
          postcssNested,
          postcssSorting,
        ]).process((await fs.readFile(entry)).toString(), {
          from: entry,
          to: entry.replace("src/", "dist/").replace(".pcss", ".css"),
        });

        await fs.mkdir(path.dirname(entry).replace("src/", "dist/noraneko/"), {
          recursive: true,
        });
        await fs.writeFile(
          entry.replace("src/", "dist/noraneko/").replace(".pcss", ".css"),
          result.css,
        );
        if (result.map)
          await fs.writeFile(
            `${entry
              .replace("src/", "dist/noraneko/")
              .replace(".pcss", ".css")}.map`,
            result.map.toString(),
          );
      } else {
        // normal file
        await fs.cp(entry, entry.replace("src/", "dist/noraneko/"));
      }
    }
  }

  //swc / compile modules
  await fg.glob("src/modules/**/*", {onlyFiles: true}).then((paths) => {
    const listPromise = [];
    for (const filepath of paths) {
      const promise = (async () => {
        const replacements = {
          "src/modules/": "dist/noraneko/resource/modules/",
          ".ts": ".js",
          ".mts": ".mjs",
        }
        await writeToDir(filepath, replacements);
      })();
      listPromise.push(promise);
    }
    return Promise.all(listPromise);
  });

  //swc / compile modules
  await fg
    .glob("src/private/browser/components/**/*", {onlyFiles: true})
    .then((paths) => {
      const listPromise = [];
      for (const filepath of paths) {
        const promise = (async () => {
          const replacements = {
            "src/private/browser/components/": "dist/noraneko/private/resource/modules/",
            ".ts": ".js",
            ".mts": ".mjs",
          }
          await writeToDir(filepath, replacements);
        })();
        listPromise.push(promise);
      }
      return Promise.all(listPromise);
    });

  // await fs.cp("public", "dist", { recursive: true });
}

async function run() {
  await compile();
  try {
    await fs.access("dist/bin");
    await fs.access("dist/bin/nora.version.txt");
    if (
      VERSION !== (await fs.readFile("dist/bin/nora.version.txt")).toString()
    ) {
      await fs.rm("dist/bin", {recursive: true});
      await fs.mkdir("dist/bin", {recursive: true});
      throw "have to decompress";
    }
  } catch {
    console.log("decompressing bin.tzst");
    const decoder = new ZSTDDecoder();
    await decoder.init();
    const archive = Buffer.from(
      decoder.decode(await fs.readFile("bin.tar.zst")),
    );

    await decompress(archive, "dist/bin");

    console.log("decompress complete!");
    await fs.writeFile("dist/bin/nora.version.txt", VERSION);
  }

  console.log("inject");
  await injectManifest();
  await injectXHTML();
  //await injectUserJS(`noraneko${VERSION}`);

  try {
    await fs.access("./profile/test");

    try {
      await fs.access("dist/profile/test");
      await fs.rm("dist/profile/test");
    } catch {
    }
    // https://searchfox.org/mozilla-central/rev/b4a96f411074560c4f9479765835fa81938d341c/toolkit/xre/nsAppRunner.cpp#1514
    // 可能性はある、まだ必要はない
  } catch {
  }

  //@ts-ignore
  let browser = null;
  let watch_running = false;

  let intended_close = false;

  const watcher = chokidar
    .watch("src", {persistent: true})
    .on("all", async (ev, path, stat) => {
      if (watch_running) return;
      watch_running = true;
      //@ts-ignore
      if (browser) {
        console.log("Browser Restarting...");
        intended_close = true;
        await browser.close();

        await watcher.close();
        await run();
      }
      watch_running = false;
    });

  browser = await puppeteer.launch({
    headless: false,
    protocol: "webDriverBiDi",
    dumpio: true,
    product: "firefox",
    executablePath: "dist/bin/firefox.exe",
    args: ["--profile dist/profile/test"],
  });

  browser.on("disconnected", () => {
    if (!intended_close) exit();
  });
}

// run
if (process.argv[2] && process.argv[2] === "--run") {
  run();
} else {
  compile();
}
