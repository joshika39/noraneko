import * as fs from "node:fs/promises";
import { DOMParser } from "linkedom";

export async function injectXHTML() {
  const path_browserxhtml = "dist/bin/browser/chrome/browser/content/browser/browser.xhtml";

  const document = new DOMParser().parseFromString((await fs.readFile(path_browserxhtml)).toString(), "text/xml");

  for (const elem of document.querySelectorAll("[data-geckomixin]")) {
    elem.remove();
  }

  const script = document.createElement("script");
  script.innerHTML = `Services.scriptloader.loadSubScript("chrome://noraneko/content/injectBrowser.inc.js", this);`;
  script.dataset.geckomixin = "";

  document.querySelector("head").appendChild(script);

  await fs.writeFile(path_browserxhtml, document.toString());
}
