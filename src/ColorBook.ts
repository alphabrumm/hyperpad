import { icon } from "./Icons.js";
import { escapeHtml } from "./util.js";
import { CSS_COLORS } from "./cssColors.js";

/**
 * „Colors“: alle Farben, die in HTML/CSS einen Namen haben.
 * Ein Tipp kopiert den Farbnamen, den Hex-Code oder rgb(…) – je nach gewählter Schreibweise.
 */

type ColorEntry = { name: string, hex: string, r: number, g: number, b: number, h: number, s: number, l: number };
type CopyMode = "name" | "hex" | "rgb";

function toEntry(name: string, hex: string): ColorEntry {
    const value = parseInt(hex.substring(1), 16);
    const r = (value >> 16) & 255, g = (value >> 8) & 255, b = value & 255;
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max != min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max == rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
        else if (max == gn) h = (bn - rn) / d + 2;
        else h = (rn - gn) / d + 4;
        h *= 60;
    }
    return { name, hex, r, g, b, h, s, l };
}

/** Graustufen ans Ende, sonst nach Farbton, innerhalb ähnlicher Töne nach Helligkeit */
function hueOrder(a: ColorEntry, b: ColorEntry): number {
    const grayA = a.s < 0.12, grayB = b.s < 0.12;
    if (grayA != grayB) return grayA ? 1 : -1;
    if (grayA) return b.l - a.l;
    const ha = Math.round(a.h / 15), hb = Math.round(b.h / 15);
    if (ha != hb) return ha - hb;
    return b.l - a.l;
}

function codeFor(c: ColorEntry, mode: CopyMode): string {
    if (mode == "hex") return c.hex;
    if (mode == "rgb") return `rgb(${c.r}, ${c.g}, ${c.b})`;
    return c.name;
}

function getMode(): CopyMode {
    try { return <CopyMode>(localStorage.getItem("hyperpad.colorMode") || "name"); } catch (e) { return "name"; }
}

function setMode(m: CopyMode) {
    try { localStorage.setItem("hyperpad.colorMode", m); } catch (e) { }
}

export function openColorBook(root: HTMLElement, toast: (text: string, iconName?: string) => void) {
    const all = CSS_COLORS.map(([n, h]) => toEntry(n, h));

    const layer = document.createElement("div");
    layer.className = "hp-sheet-layer hp-handbook-layer";
    layer.innerHTML = `
        <div class="hp-handbook hp-colors" role="dialog" aria-modal="true" aria-label="Colors">
            <header class="hp-handbook-head">
                <h2>Colors</h2>
                <span class="hp-handbook-count"></span>
                <button class="hp-iconbtn hp-handbook-close" aria-label="Schließen">${icon("close")}</button>
            </header>
            <div class="hp-example">
                <p class="hp-color-intro">Farben kannst du mit ihrem Namen, als Hex-Code oder als rgb(…) angeben:</p>
                <pre><span class="tok-tag">&lt;h1</span> <span class="tok-attr">style</span>=<span class="tok-str">"color: <b>tomato</b>"</span><span class="tok-tag">&gt;</span>Hallo<span class="tok-tag">&lt;/h1&gt;</span>
<span class="tok-tag">&lt;p</span> <span class="tok-attr">style</span>=<span class="tok-str">"background-color: <b>#87CEEB</b>"</span><span class="tok-tag">&gt;</span>Text<span class="tok-tag">&lt;/p&gt;</span></pre>
                <p>Tippe auf eine Farbe, um sie in der gewählten Schreibweise zu kopieren.</p>
            </div>
            <div class="hp-color-tools">
                <label class="hp-handbook-search">
                    ${icon("search")}
                    <input type="search" placeholder="Farbe suchen, z. B. blue, gray, rot"
                        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
                </label>
                <div class="hp-segmented hp-color-mode" role="group" aria-label="Schreibweise beim Kopieren">
                    <button data-mode="name"><span>Name</span></button>
                    <button data-mode="hex"><span>#Hex</span></button>
                    <button data-mode="rgb"><span>rgb()</span></button>
                </div>
                <div class="hp-segmented hp-color-sort" role="group" aria-label="Sortierung">
                    <button data-sort="name" aria-pressed="true"><span>A–Z</span></button>
                    <button data-sort="hue" aria-pressed="false"><span>Farbton</span></button>
                </div>
            </div>
            <div class="hp-handbook-list hp-color-list"></div>
            <p class="hp-handbook-source">Die 148 Farbnamen von HTML und CSS (CSS Color Module Level 4).</p>
        </div>`;
    root.appendChild(layer);
    requestAnimationFrame(() => layer.classList.add("is-open"));

    const list = layer.querySelector<HTMLElement>(".hp-color-list")!;
    const input = layer.querySelector<HTMLInputElement>("input")!;
    const count = layer.querySelector<HTMLElement>(".hp-handbook-count")!;
    let sort: "name" | "hue" = "name";
    let mode = getMode();

    const close = () => {
        layer.classList.remove("is-open");
        document.removeEventListener("keydown", onKey);
        setTimeout(() => layer.remove(), 200);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key == "Escape") close(); };
    document.addEventListener("keydown", onKey);
    layer.querySelector(".hp-handbook-close")!.addEventListener("click", close);
    layer.addEventListener("click", e => { if (e.target == layer) close(); });

    // Deutsche Suchbegriffe auf Farbtöne abbilden
    const german: Record<string, (c: ColorEntry) => boolean> = {
        rot: c => c.s > 0.25 && (c.h < 15 || c.h >= 345),
        orange: c => c.s > 0.25 && c.h >= 15 && c.h < 40,
        gelb: c => c.s > 0.25 && c.h >= 40 && c.h < 70,
        grün: c => c.s > 0.2 && c.h >= 70 && c.h < 170,
        gruen: c => c.s > 0.2 && c.h >= 70 && c.h < 170,
        blau: c => c.s > 0.2 && c.h >= 170 && c.h < 255,
        lila: c => c.s > 0.2 && c.h >= 255 && c.h < 300,
        violett: c => c.s > 0.2 && c.h >= 255 && c.h < 300,
        pink: c => c.s > 0.25 && c.h >= 300 && c.h < 345,
        rosa: c => c.s > 0.25 && (c.h >= 300 || c.h < 15) && c.l > 0.6,
        grau: c => c.s < 0.12,
        weiß: c => c.l > 0.92,
        weiss: c => c.l > 0.92,
        braun: c => c.h >= 10 && c.h < 45 && c.l < 0.5 && c.s > 0.2,
    };

    const renderMode = () => {
        layer.querySelectorAll<HTMLElement>("[data-mode]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.mode == mode)));
    };

    const render = () => {
        const f = input.value.trim().toLowerCase();
        let colors = all.filter(c => !f || c.name.includes(f) || c.hex.toLowerCase().includes(f.replace(/^#/, ""))
            || (german[f] ? german[f](c) : false));
        colors = colors.sort(sort == "name" ? (a, b) => a.name.localeCompare(b.name) : hueOrder);
        list.innerHTML = colors.length == 0
            ? `<div class="hp-empty">${icon("search")}<p>Keine Farbe gefunden für „${escapeHtml(input.value.trim())}“.</p></div>`
            : `<div class="hp-color-grid">${colors.map(c => `
                <button class="hp-color-item" data-name="${c.name}" aria-label="${c.name}, ${c.hex}">
                    <span class="hp-color-swatch" style="background:${c.hex}"></span>
                    <span class="hp-color-text">
                        <span class="hp-color-name">${c.name}</span>
                        <span class="hp-color-hex">${c.hex} · rgb(${c.r}, ${c.g}, ${c.b})</span>
                    </span>
                    <span class="hp-color-copy">${icon("copy")}</span>
                </button>`).join("")}</div>`;
        count.textContent = f ? `${colors.length} von ${all.length} Farben` : `${all.length} Farben`;
    };

    layer.querySelectorAll<HTMLElement>("[data-sort]").forEach(b => b.addEventListener("click", () => {
        sort = <any>b.dataset.sort;
        layer.querySelectorAll<HTMLElement>("[data-sort]").forEach(x => x.setAttribute("aria-pressed", String(x == b)));
        render();
    }));

    layer.querySelectorAll<HTMLElement>("[data-mode]").forEach(b => b.addEventListener("click", () => {
        mode = <CopyMode>b.dataset.mode;
        setMode(mode);
        renderMode();
    }));

    list.addEventListener("click", async e => {
        const item = (<HTMLElement>e.target).closest<HTMLElement>("[data-name]");
        if (!item) return;
        const entry = all.find(c => c.name == item.dataset.name)!;
        const code = codeFor(entry, mode);
        try {
            await navigator.clipboard.writeText(code);
            toast(`Kopiert: ${code}`, "check");
        } catch (err) {
            toast(code, "info");
        }
        list.querySelectorAll(".is-copied").forEach(x => x.classList.remove("is-copied"));
        item.classList.add("is-copied");
    });

    let timer: any;
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(render, 100); });
    renderMode();
    render();
}
