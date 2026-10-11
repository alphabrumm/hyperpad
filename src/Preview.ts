import type { ProjectFile } from "./ProjectStore.js";
import { kindOf } from "./util.js";

/**
 * Live-Vorschau einer HTML-Seite des Projekts.
 *
 * Die Seite läuft in einem abgeschotteten iframe (sandbox ohne allow-same-origin), damit
 * Schülercode HyperPad nicht beeinflussen kann. Dateien des Projekts (CSS, JavaScript, Bilder)
 * werden direkt in die Seite eingesetzt. Links auf andere Seiten des Projekts öffnen diese
 * Seite in HyperPad; Links ins Internet öffnen einen neuen Tab.
 */

export type PreviewMessage =
    | { type: "navigate", href: string }
    | { type: "external", href: string }
    | { type: "scroll", y: number }
    | { type: "error", message: string }
    | { type: "submit" };

/** Nimmt "./bilder/a.png#x?y" und liefert "bilder/a.png" */
export function normalizeRef(ref: string): string {
    let r = ref.trim().replace(/[?#].*$/, "");
    try { r = decodeURIComponent(r); } catch (e) { }
    return r.replace(/^\.\//, "").replace(/^\//, "");
}

function escapeRegExp(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function dataUrlFor(f: ProjectFile): string | null {
    if (kindOf(f.name) == "image") return f.text.startsWith("data:") ? f.text : null;
    return null;
}

/** Ersetzt url(datei.png) in CSS durch die Bilddaten */
function inlineCssUrls(cssText: string, files: Map<string, ProjectFile>): string {
    return cssText.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, q, ref) => {
        const f = files.get(normalizeRef(ref));
        const d = f ? dataUrlFor(f) : null;
        return d ? `url("${d}")` : m;
    });
}

function helperScript(token: string, scrollY: number): string {
    // Wird vor dem Schülercode in die Seite eingesetzt. Bewusst klein und in ES5.
    return `<script>(function(){
var T=${JSON.stringify(token)};
function send(m){m.hyperpad=T;try{parent.postMessage(m,"*");}catch(e){}}
document.addEventListener("click",function(e){
  var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;
  if(!a||e.defaultPrevented)return;
  var h=a.getAttribute("href")||"";
  if(h.charAt(0)=="#"){e.preventDefault();
    var id=h.substring(1);try{id=decodeURIComponent(id);}catch(x){}
    var t=id?(document.getElementById(id)||document.getElementsByName(id)[0]):null;
    if(t)t.scrollIntoView({behavior:"smooth"});else if(!id)window.scrollTo({top:0,behavior:"smooth"});
    return;}
  e.preventDefault();
  if(/^[a-z][a-z0-9+.-]*:/i.test(h)||h.indexOf("//")==0){send({type:"external",href:h});return;}
  send({type:"navigate",href:h});
});
document.addEventListener("submit",function(e){if(!e.defaultPrevented){e.preventDefault();send({type:"submit"});}});
var st;window.addEventListener("scroll",function(){clearTimeout(st);st=setTimeout(function(){send({type:"scroll",y:window.scrollY});},120);});
window.addEventListener("error",function(e){send({type:"error",message:String(e.message||e)});});
var Y=${Math.round(scrollY)};
if(Y>0){var r=function(){window.scrollTo(0,Y);};document.addEventListener("DOMContentLoaded",r);window.addEventListener("load",r);}
})();</script>`;
}

/** Setzt das Hilfsskript möglichst früh ein, aber hinter <!DOCTYPE> (sonst Quirks-Modus). */
function injectAtStart(page: string, script: string): string {
    const head = /<head\b[^>]*>/i.exec(page);
    if (head) return page.substring(0, head.index + head[0].length) + script + page.substring(head.index + head[0].length);
    const htmlTag = /<html\b[^>]*>/i.exec(page);
    if (htmlTag) return page.substring(0, htmlTag.index + htmlTag[0].length) + script + page.substring(htmlTag.index + htmlTag[0].length);
    const doctype = /<!doctype[^>]*>/i.exec(page);
    if (doctype) return page.substring(0, doctype.index + doctype[0].length) + script + page.substring(doctype.index + doctype[0].length);
    return script + page;
}

/** Baut das vollständige Dokument für die Vorschau. */
export function buildDocument(pageName: string, files: ProjectFile[], options: { token?: string, scrollY?: number, standalone?: boolean } = {}): string {
    const map = new Map(files.map(f => [f.name, f]));
    const page = map.get(pageName);
    let text = page ? page.text : "";

    // <link rel="stylesheet" href="style.css"> → <style>…</style>
    text = text.replace(/<link\b[^>]*>/gi, (tag) => {
        if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
        const href = /href\s*=\s*(["'])(.*?)\1/i.exec(tag) || /href\s*=\s*([^\s>]+)/i.exec(tag);
        const ref = href ? (href[2] ?? href[1]) : "";
        const f = map.get(normalizeRef(ref));
        if (!f || kindOf(f.name) != "css") return tag;
        return `<style data-file="${f.name}">\n${inlineCssUrls(f.text, map).replace(/<\/style/gi, "<\\/style")}\n</style>`;
    });

    // <script src="code.js"></script> → <script>…</script>
    text = text.replace(/<script\b([^>]*)\bsrc\s*=\s*(["'])(.*?)\2([^>]*)>\s*<\/script>/gi, (tag, a, q, ref, b) => {
        const f = map.get(normalizeRef(ref));
        if (!f || kindOf(f.name) != "js") return tag;
        return `<script${a}${b}>\n${f.text.replace(/<\/script/gi, "<\\/script")}\n</script>`;
    });

    // Bilder: src="bild.png", poster=…, auch in style="background: url(bild.png)"
    for (const f of files) {
        const d = dataUrlFor(f);
        if (!d) continue;
        const name = escapeRegExp(f.name);
        const attr = new RegExp(`(\\b(?:src|poster|href)\\s*=\\s*)(["']?)(?:\\./)?${name}\\2`, "gi");
        text = text.replace(attr, (m, pre) => `${pre}"${d}"`);
    }
    text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (block) => inlineCssUrls(block, map));
    text = text.replace(/style\s*=\s*"([^"]*)"/gi, (m, v) => `style="${inlineCssUrls(v, map).replace(/"/g, "'")}"`);

    if (options.standalone) return text;
    return injectAtStart(text, helperScript(options.token || "", options.scrollY || 0));
}

/** Liest den Text von <title> aus einer Seite */
export function pageTitle(text: string): string | null {
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
    if (!m) return null;
    const t = m[1].replace(/\s+/g, " ").trim();
    const tmp = document.createElement("textarea");
    tmp.innerHTML = t;
    return tmp.value || null;
}

export class Preview {

    frame: HTMLIFrameElement;
    private token = Math.random().toString(36).substring(2);
    private scrollPositions = new Map<string, number>();
    private current: string | null = null;
    onMessage: (m: PreviewMessage) => void = () => { };

    constructor(host: HTMLElement) {
        this.frame = document.createElement("iframe");
        this.frame.className = "hp-preview-frame";
        this.frame.title = "Vorschau";
        // Kein allow-same-origin: Schülercode bleibt von HyperPad getrennt
        this.frame.setAttribute("sandbox", "allow-scripts allow-modals allow-forms allow-popups allow-popups-to-escape-sandbox");
        host.appendChild(this.frame);

        window.addEventListener("message", (e) => {
            if (e.source !== this.frame.contentWindow) return;
            const m = e.data;
            if (!m || m.hyperpad !== this.token) return;
            if (m.type == "scroll" && this.current) this.scrollPositions.set(this.current, m.y);
            this.onMessage(m);
        });
    }

    show(pageName: string, files: ProjectFile[]) {
        if (pageName != this.current) this.current = pageName;
        const doc = buildDocument(pageName, files, { token: this.token, scrollY: this.scrollPositions.get(pageName) || 0 });
        this.frame.srcdoc = doc;
    }

    resetScroll(pageName: string) { this.scrollPositions.delete(pageName); }

    renamePage(oldName: string, newName: string) {
        const y = this.scrollPositions.get(oldName);
        this.scrollPositions.delete(oldName);
        if (y != null) this.scrollPositions.set(newName, y);
        if (this.current == oldName) this.current = newName;
    }
}
