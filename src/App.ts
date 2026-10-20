import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import type { Diagnostic } from "@codemirror/lint";
import { HtmlEditor } from "./Editor.js";
import { Preview, PreviewMessage, buildDocument, normalizeRef, pageTitle } from "./Preview.js";
import { ProjectInfo, ProjectStore, STARTER_FILES, ProjectFile, pageTemplate } from "./ProjectStore.js";
import { icon } from "./Icons.js";
import { Dialogs } from "./Dialogs.js";
import { KeyBar } from "./KeyBar.js";
import { diagnose } from "./lint.js";
import { TAG_INFO } from "./tagInfo.js";
import { escapeHtml, kindOf, validateFileName, extOf, FileKind } from "./util.js";

type View = "code" | "preview" | "problems";
type SideView = "preview" | "problems";
type ThemeChoice = "auto" | "light" | "dark";
type Problem = { file: string, d: Diagnostic, line: number };

declare var APP_VERSION: string;

const KIND_LABEL: Record<FileKind, string> = { html: "HTML-Seite", css: "CSS-Datei", js: "JavaScript-Datei", image: "Bild", text: "Textdatei" };

/**
 * Die Oberfläche von HyperPad: Kopfzeile, Dateireiter, Editor, Vorschau, Probleme,
 * Menü und Tastatur-Hilfsleiste. Aufbau und Gestaltung wie JPad.
 */
export class App {

    store = new ProjectStore();
    project!: ProjectInfo;
    files: ProjectFile[] = [];
    active = "";
    previewPage = "";

    editor!: HtmlEditor;
    preview!: Preview;
    dialogs!: Dialogs;
    keyBar!: KeyBar;

    root: HTMLElement;
    el: Record<string, HTMLElement> = {};

    view: View = "code";
    sideView: SideView = "preview";
    problems: Problem[] = [];
    scriptErrors: string[] = [];

    private saveTimer: any;
    private previewTimer: any;
    private problemTimer: any;

    constructor(root: HTMLElement) {
        this.root = root;
    }

    // =====================================================================
    // Start
    // =====================================================================

    async start() {
        this.applyTheme(this.getThemeChoice());
        matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme(this.getThemeChoice()));

        await this.store.open();
        this.project = this.store.ensureCurrent();
        this.files = (await this.store.readFiles(this.project.id)) || STARTER_FILES.map(f => ({ ...f }));

        this.buildShell();
        this.dialogs = new Dialogs(this.root);

        this.editor = new HtmlEditor(this.el.editorHost, {
            onDocChanged: (name, text) => this.onDocChanged(name, text),
            onCursorActivity: () => this.updateHintSoon(),
            onFocusChanged: (focused) => this.keyBar.setEditorFocused(focused),
            onHistoryChanged: (canUndo, canRedo) => {
                this.el.undo.toggleAttribute("disabled", !canUndo);
                this.el.redo.toggleAttribute("disabled", !canRedo);
            },
            onDiagnostics: () => this.updateHintSoon(),
        }, this.getFontSize());

        this.preview = new Preview(this.el.previewHost);
        this.preview.onMessage = (m) => this.onPreviewMessage(m);

        this.keyBar = new KeyBar(this.root, this.editor, () => this.showInfo());
        this.placeKeyBar();

        // Für Fehlersuche in der Browser-Konsole
        (window as any).hyperpad = this;

        const first = this.files.find(f => kindOf(f.name) == "html") || this.files[0];
        this.setActive(first.name);

        this.renderProjectTitle();
        this.setView("code");
        this.computeProblems();
        this.root.removeAttribute("aria-busy");
        this.root.querySelector(".hp-boot")?.remove();

        // Vor dem Schließen/Wechseln der App alles sichern
        const flush = () => this.flush();
        window.addEventListener("pagehide", flush);
        document.addEventListener("visibilitychange", () => { if (document.visibilityState == "hidden") flush(); });
    }

    // =====================================================================
    // Grundgerüst
    // =====================================================================

    /** Auf dem Smartphone sitzt die Hilfsleiste fest unter den Dateireitern (wie in JPad). */
    private placeKeyBar() {
        const coarse = matchMedia("(pointer: coarse)");
        const update = () => {
            const phone = coarse.matches && Math.min(screen.width, screen.height) < 600;
            document.documentElement.classList.toggle("phone", phone);
            const bar = this.keyBar.el;
            if (phone) {
                if (bar.previousElementSibling != this.el.filebar) this.el.filebar.after(bar);
            } else if (bar.parentElement != this.root) {
                this.root.appendChild(bar);
            }
        };
        coarse.addEventListener?.("change", update);
        window.addEventListener("resize", update);
        update();
    }

    private buildShell() {
        this.root.insertAdjacentHTML("beforeend", `
        <header class="hp-topbar">
            <button class="hp-iconbtn" data-ref="menuBtn" aria-label="Menü öffnen">${icon("menu")}</button>
            <button class="hp-project" data-ref="projectBtn" aria-label="Projekt umbenennen">
                <span class="hp-project-name" data-ref="projectName"></span>
                <span class="hp-project-state" data-ref="projectState"></span>
            </button>
            <div class="hp-topbar-spacer"></div>
            <div class="hp-toolgroup hp-edit-tools">
                <button class="hp-iconbtn" data-ref="undo" aria-label="Rückgängig" title="Rückgängig">${icon("undo")}</button>
                <button class="hp-iconbtn" data-ref="redo" aria-label="Wiederholen" title="Wiederholen">${icon("redo")}</button>
                <button class="hp-iconbtn" data-ref="saveBtn" aria-label="Projekt als Datei sichern" title="Projekt als Datei sichern">${icon("save")}<span class="hp-dot"></span></button>
            </div>
            <button class="hp-colorsbtn" data-ref="colorsBtn" aria-label="Colors: alle HTML-Farben" title="Alle HTML-Farben mit Namen">
                <span class="hp-colorsbtn-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>Colors</span>
            </button>
        </header>

        <main class="hp-main">
            <section class="hp-pane hp-pane-code" aria-label="Quelltext">
                <div class="hp-filebar" data-ref="filebar">
                    <nav class="hp-filetabs" data-ref="fileTabs" aria-label="Dateien"></nav>
                    <button class="hp-iconbtn hp-layoutbtn" data-ref="layoutBtn"></button>
                </div>
                <div class="hp-editor" data-ref="editorHost"></div>
                <div class="hp-imageview" data-ref="imageView" hidden></div>
                <div class="hp-hintbar" data-ref="hintBar" hidden></div>
            </section>
            <section class="hp-pane hp-pane-side">
                <div class="hp-sidehead">
                    <div class="hp-segmented hp-side-switch" role="tablist">
                        <button role="tab" data-side="preview">${icon("eye")}<span>Vorschau</span></button>
                        <button role="tab" data-side="problems">${icon("problems")}<span>Probleme</span><span class="hp-badge" data-ref="sideBadge"></span></button>
                    </div>
                </div>
                <div class="hp-preview" data-ref="preview">
                    <div class="hp-previewbar">
                        <div class="hp-previewbar-title">
                            <span class="hp-previewbar-page" data-ref="previewTitle"></span>
                            <span class="hp-previewbar-file" data-ref="previewFile"></span>
                        </div>
                        <button class="hp-iconbtn" data-ref="reloadBtn" aria-label="Vorschau neu laden" title="Neu laden">${icon("refresh")}</button>
                        <button class="hp-iconbtn" data-ref="openTabBtn" aria-label="Seite in neuem Tab öffnen" title="In neuem Tab öffnen">${icon("external")}</button>
                    </div>
                    <div class="hp-preview-host" data-ref="previewHost"></div>
                </div>
                <div class="hp-problems" data-ref="problems"></div>
            </section>
        </main>

        <nav class="hp-bottomnav" aria-label="Ansicht">
            <button data-view="code">${icon("code")}<span>Code</span></button>
            <button data-view="preview">${icon("eye")}<span>Vorschau</span></button>
            <button data-view="problems">${icon("problems")}<span>Probleme</span><span class="hp-badge" data-ref="navBadge"></span></button>
        </nav>

        <div class="hp-drawer-backdrop" data-ref="drawerBackdrop"></div>
        <aside class="hp-drawer" data-ref="drawer" aria-label="Menü" inert>
            <div class="hp-drawer-head">
                <div class="hp-brand"><span class="hp-brand-mark">&lt;H&gt;</span>HyperPad</div>
                <button class="hp-iconbtn" data-ref="drawerClose" aria-label="Menü schließen">${icon("close")}</button>
            </div>
            <div class="hp-drawer-body">
                <h2>Projekte</h2>
                <div class="hp-menu-actions">
                    <button data-ref="newProjectBtn">${icon("plus")}<span>Neues Projekt</span></button>
                    <button data-ref="openFileBtn">${icon("open")}<span>Projekt aus Datei öffnen</span></button>
                    <button data-ref="saveFileBtn">${icon("save")}<span>Projekt als Datei sichern</span></button>
                    <button data-ref="saveZipBtn">${icon("zip")}<span>Projekt als zip sichern</span></button>
                    <button data-ref="saveTabBtn">${icon("fileSave")}<span>Offenen Tab als Datei sichern</span></button>
                </div>
                <ul class="hp-projectlist" data-ref="projectList"></ul>

                <h2>Darstellung</h2>
                <div class="hp-segmented" data-ref="themeSwitch">
                    <button data-theme-choice="light">${icon("sun")}<span>Hell</span></button>
                    <button data-theme-choice="dark">${icon("moon")}<span>Dunkel</span></button>
                    <button data-theme-choice="auto">${icon("auto")}<span>System</span></button>
                </div>
                <div class="hp-setting-row">
                    <span>Schriftgröße</span>
                    <div class="hp-stepper">
                        <button data-ref="fontSmaller" aria-label="Schrift kleiner">A−</button>
                        <span data-ref="fontSizeLabel"></span>
                        <button data-ref="fontBigger" aria-label="Schrift größer">A+</button>
                    </div>
                </div>

                <h2>Nachschlagen</h2>
                <div class="hp-menu-actions">
                    <button data-ref="colorsMenuBtn">${icon("palette")}<span>Colors – alle HTML-Farben</span></button>
                </div>

                <h2>Über HyperPad</h2>
                <p class="hp-about">HyperPad ist ein HTML-Editor für Tablets und Handys: links schreibst du HTML,
                rechts siehst du sofort die fertige Seite. Deine Projekte bleiben auf diesem Gerät, bis du sie als Datei sicherst.
                Gestaltung wie <a href="https://github.com/alphabrumm/jpad" target="_blank" rel="noopener">JPad</a>.
                <a href="https://github.com/alphabrumm/hyperpad" target="_blank" rel="noopener">Quellcode</a></p>
                <p class="hp-version">Version ${typeof APP_VERSION != "undefined" ? APP_VERSION : ""}</p>
            </div>
        </aside>
        <input type="file" accept=".json,.html,.htm,application/json,text/html,text/plain" data-ref="fileInput" hidden>
        <input type="file" accept="image/*,.html,.htm,.css,.js,.txt" multiple data-ref="addFileInput" hidden>
        `);

        this.root.querySelectorAll<HTMLElement>("[data-ref]").forEach(e => this.el[e.dataset.ref!] = e);

        // ----- Kopfzeile -----
        this.el.menuBtn.addEventListener("click", () => this.openDrawer());
        this.el.drawerClose.addEventListener("click", () => this.closeDrawer());
        this.el.drawerBackdrop.addEventListener("click", () => this.closeDrawer());
        this.el.projectBtn.addEventListener("click", () => this.renameProject());
        this.el.undo.addEventListener("click", () => this.editor.undo());
        this.el.redo.addEventListener("click", () => this.editor.redo());
        this.el.saveBtn.addEventListener("click", () => this.exportProject());
        this.el.colorsBtn.addEventListener("click", () => this.openColors());

        // Kopfzeilen-Knöpfe sollen dem Editor den Fokus nicht wegnehmen (sonst klappt die Tastatur zu)
        this.root.querySelectorAll<HTMLElement>(".hp-topbar [data-ref=undo], .hp-topbar [data-ref=redo]")
            .forEach(b => b.addEventListener("pointerdown", e => e.preventDefault()));

        // ----- Ansichten -----
        this.root.querySelectorAll<HTMLElement>(".hp-bottomnav [data-view]").forEach(b =>
            b.addEventListener("click", () => this.setView(<View>b.dataset.view)));
        this.root.querySelectorAll<HTMLElement>(".hp-side-switch [data-side]").forEach(b =>
            b.addEventListener("click", () => this.setSideView(<SideView>b.dataset.side)));
        this.el.reloadBtn.addEventListener("click", () => { this.preview.resetScroll(this.previewPage); this.scriptErrors = []; this.refreshPreview(); });
        this.el.openTabBtn.addEventListener("click", () => this.openInNewTab());

        // ----- Menü -----
        this.el.newProjectBtn.addEventListener("click", () => this.newProject());
        this.el.openFileBtn.addEventListener("click", () => { (<HTMLInputElement>this.el.fileInput).value = ""; this.el.fileInput.click(); });
        this.el.fileInput.addEventListener("change", () => {
            const f = (<HTMLInputElement>this.el.fileInput).files?.[0];
            if (f) this.importProject(f);
        });
        this.el.addFileInput.addEventListener("change", () => {
            const list = (<HTMLInputElement>this.el.addFileInput).files;
            if (list && list.length) this.addFilesFromDevice(Array.from(list));
        });
        this.el.saveFileBtn.addEventListener("click", () => { this.closeDrawer(); this.exportProject(); });
        this.el.saveZipBtn.addEventListener("click", () => { this.closeDrawer(); this.exportZip(); });
        this.el.saveTabBtn.addEventListener("click", () => { this.closeDrawer(); this.exportOpenTab(); });
        this.el.colorsMenuBtn.addEventListener("click", () => { this.closeDrawer(); this.openColors(); });

        this.el.themeSwitch.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach(b =>
            b.addEventListener("click", () => this.setThemeChoice(<ThemeChoice>b.dataset.themeChoice)));
        this.el.fontSmaller.addEventListener("click", () => this.changeFontSize(-1));
        this.el.fontBigger.addEventListener("click", () => this.changeFontSize(+1));
        this.renderSettings();

        this.watchWindowControls();

        // Breites Layout (iPad quer, Laptop) oder Reiter-Layout (Handy, iPad hoch)
        const mq = matchMedia("(min-width: 900px) and (min-aspect-ratio: 1/1)");
        const applyLayout = () => {
            const focus = this.getEditorFullWidth();
            this.root.dataset.wide = String(mq.matches);
            this.root.dataset.layout = mq.matches && !focus ? "split" : "tabs";
            const btn = this.el.layoutBtn;
            btn.innerHTML = icon(focus ? "shrink" : "expand");
            const label = focus ? "Vorschau wieder rechts neben dem Editor anzeigen" : "Editor auf volle Breite vergrößern";
            btn.setAttribute("aria-label", label);
            btn.title = label;
            this.setView(this.view);
        };
        mq.addEventListener("change", applyLayout);
        this.el.layoutBtn.addEventListener("pointerdown", e => e.preventDefault()); // Tastatur offen lassen
        this.el.layoutBtn.addEventListener("click", () => {
            this.setEditorFullWidth(!this.getEditorFullWidth());
            applyLayout();
        });
        applyLayout();
    }

    /** iPadOS 26: Platz für die Fenster-Steuerelemente oben links (wie in JPad). */
    private watchWindowControls() {
        const isIPad = navigator.maxTouchPoints > 1 && /iPad|Macintosh/.test(navigator.userAgent);
        const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
        const update = () => {
            const big = Math.max(screen.width, screen.height), small = Math.min(screen.width, screen.height);
            const near = (x: number, y: number) => Math.abs(x - y) <= 40;
            const w = window.innerWidth, h = window.innerHeight;
            const fullscreen = (near(w, big) && near(h, small)) || (near(w, small) && near(h, big));
            document.documentElement.classList.toggle("ipad-window-controls", isIPad && standalone && !fullscreen);
        };
        update();
        window.addEventListener("resize", update);
    }

    // =====================================================================
    // Ansichten
    // =====================================================================

    setView(view: View) {
        this.view = view;
        if (view != "code") this.sideView = view;
        this.root.dataset.view = view;
        this.root.dataset.side = this.sideView;
        this.root.querySelectorAll<HTMLElement>(".hp-bottomnav [data-view]").forEach(b =>
            b.setAttribute("aria-current", String(b.dataset.view == view)));
        this.root.querySelectorAll<HTMLElement>(".hp-side-switch [data-side]").forEach(b =>
            b.setAttribute("aria-selected", String(b.dataset.side == this.sideView)));
        if (view != "code") this.editor?.view.contentDOM.blur();
    }

    setSideView(side: SideView) {
        this.sideView = side;
        if (this.root.dataset.layout == "tabs") this.setView(side);
        else this.setView(this.view == "code" ? "code" : side);
    }

    // =====================================================================
    // Dateien
    // =====================================================================

    file(name: string) { return this.files.find(f => f.name == name); }
    htmlFiles() { return this.files.filter(f => kindOf(f.name) == "html"); }

    setActive(name: string) {
        const f = this.file(name);
        if (!f) return;
        this.active = name;
        const kind = kindOf(name);
        const isImage = kind == "image";
        this.el.editorHost.hidden = isImage;
        this.el.imageView.hidden = !isImage;
        if (isImage) {
            this.renderImageView(f);
            this.el.undo.setAttribute("disabled", "");
            this.el.redo.setAttribute("disabled", "");
        } else {
            this.editor.showFile(name, f.text);
        }
        if (kind == "html") this.previewPage = name;
        if (!this.file(this.previewPage)) this.previewPage = this.htmlFiles()[0]?.name || "";
        this.renderFileTabs();
        this.scriptErrors = [];
        this.refreshPreview();
        this.updateHintSoon();
    }

    private renderImageView(f: ProjectFile) {
        const tag = `<img src="${f.name}" alt="">`;
        this.el.imageView.innerHTML = `
            <div class="hp-imageview-box"><img src="${f.text}" alt="${escapeHtml(f.name)}"></div>
            <div class="hp-example">
                <p>So zeigst du das Bild auf einer Seite an:</p>
                <pre>${escapeHtml(tag)}</pre>
                <button class="hp-btn" data-copy>${icon("copy")}<span>Kopieren</span></button>
                <p class="hp-hint">Schreibe in <code>alt</code>, was auf dem Bild zu sehen ist.</p>
            </div>`;
        const img = this.el.imageView.querySelector<HTMLImageElement>(".hp-imageview-box img")!;
        img.addEventListener("load", () => {
            const p = document.createElement("p");
            p.className = "hp-hint hp-imageview-size";
            p.textContent = `${img.naturalWidth} × ${img.naturalHeight} Pixel · ${Math.round(f.text.length * 0.75 / 1024)} KB`;
            img.parentElement!.after(p);
        });
        this.el.imageView.querySelector("[data-copy]")!.addEventListener("click", () => this.copy(tag));
    }

    private onDocChanged(name: string, text: string) {
        const f = this.file(name);
        if (!f) return;
        f.text = text;
        this.markModified();
        clearTimeout(this.previewTimer);
        this.previewTimer = setTimeout(() => { this.scriptErrors = []; this.refreshPreview(); }, 250);
        clearTimeout(this.problemTimer);
        this.problemTimer = setTimeout(() => this.computeProblems(), 650);
    }

    renderFileTabs() {
        const container = this.el.fileTabs;
        container.innerHTML = "";
        for (const f of this.files) {
            const count = this.problems.filter(p => p.file == f.name).length;
            const isActive = f.name == this.active;
            const kind = kindOf(f.name);
            const dot = f.name.lastIndexOf(".");
            const base = dot > 0 ? f.name.substring(0, dot) : f.name;
            const ext = dot > 0 ? f.name.substring(dot) : "";
            const b = document.createElement("button");
            b.className = `hp-filetab is-${kind}` + (isActive ? " is-active" : "") + (count > 0 ? " has-errors" : "");
            b.innerHTML = `<span class="hp-filetab-kind" aria-hidden="true"></span><span class="hp-filetab-name">${escapeHtml(base)}<span class="hp-filetab-ext">${escapeHtml(ext)}</span></span>`
                + (count > 0 ? `<span class="hp-badge">${count}</span>` : "")
                + (isActive ? `<span class="hp-filetab-more" aria-label="Datei-Aktionen">${icon("more")}</span>` : "");
            b.addEventListener("click", () => {
                if (f.name == this.active) this.fileActions(f);
                else { this.setActive(f.name); if (this.root.dataset.layout == "tabs" && this.view != "code") this.setView("code"); }
            });
            container.appendChild(b);
        }
        const add = document.createElement("button");
        add.className = "hp-filetab hp-filetab-add";
        add.setAttribute("aria-label", "Neue Datei");
        add.innerHTML = icon("plus") + "<span>Datei</span>";
        add.addEventListener("click", () => this.newFile());
        container.appendChild(add);
        container.querySelector(".is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    private checkName(name: string, except?: string): string | null {
        const msg = validateFileName(name);
        if (msg) return msg;
        if (this.files.some(f => f.name != except && f.name.toLowerCase() == name.toLowerCase())) return `Es gibt schon eine Datei „${name}“.`;
        return null;
    }

    /** Hängt die passende Endung an, wenn sie fehlt */
    private withExt(name: string, ext: string) {
        name = name.trim();
        return extOf(name) ? name : name + "." + ext;
    }

    async newFile() {
        const choice = await this.dialogs.actions("Neue Datei", [
            { id: "html", label: "HTML-Seite", icon: "tag" },
            { id: "css", label: "CSS-Datei (Stylesheet)", icon: "css" },
            { id: "js", label: "JavaScript-Datei", icon: "js" },
            { id: "device", label: "Bild oder Datei vom Gerät hinzufügen", icon: "image" },
        ]);
        if (!choice) return;
        if (choice == "device") {
            (<HTMLInputElement>this.el.addFileInput).value = "";
            this.el.addFileInput.click();
            return;
        }
        const placeholder = choice == "html" ? "z. B. seite2" : choice == "css" ? "z. B. style" : "z. B. script";
        const raw = await this.dialogs.prompt({
            title: choice == "html" ? "Neue HTML-Seite" : choice == "css" ? "Neue CSS-Datei" : "Neue JavaScript-Datei",
            label: "Dateiname", placeholder, confirm: "Anlegen",
            value: choice == "css" && !this.file("style.css") ? "style" : "",
            validate: (v) => this.checkName(this.withExt(v, choice))
        });
        if (!raw) return;
        const name = this.withExt(raw, choice);
        let text = "";
        let hint = "";
        if (choice == "html") {
            const title = raw.trim().replace(/\.[^.]*$/, "");
            text = pageTemplate(title.charAt(0).toUpperCase() + title.substring(1));
            hint = `Verlinke die Seite mit <a href="${name}">…</a>.`;
        } else if (choice == "css") {
            text = "body {\n  font-family: sans-serif;\n}\n";
            hint = `Binde sie im <head> ein: <link rel="stylesheet" href="${name}">`;
        } else {
            text = "";
            hint = `Binde sie ein mit <script src="${name}"></script>`;
        }
        this.files.push({ name, text });
        this.markModified();
        this.setActive(name);
        this.computeProblems();
        this.setView("code");
        this.toast(hint, "info");
        if (choice == "html") {
            const pos = text.indexOf("<p></p>") + 3;
            setTimeout(() => { this.editor.revealOffset(pos); this.editor.focus(); }, 50);
        } else {
            setTimeout(() => this.editor.focus(), 50);
        }
    }

    /** Dateinamen vom Gerät in eine Form bringen, die in Webadressen funktioniert */
    private cleanName(name: string): string {
        let n = name.toLowerCase()
            .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
            .replace(/\s+/g, "-").replace(/[^a-z0-9_.-]/g, "");
        if (n.endsWith(".jpeg")) n = n.substring(0, n.length - 5) + ".jpg";
        if (!n || n.startsWith(".")) n = "datei" + n;
        const dot = n.lastIndexOf(".");
        const base = dot > 0 ? n.substring(0, dot) : n, ext = dot > 0 ? n.substring(dot) : "";
        let candidate = n, i = 2;
        while (this.files.some(f => f.name.toLowerCase() == candidate)) candidate = `${base}-${i++}${ext}`;
        return candidate;
    }

    async addFilesFromDevice(list: File[]) {
        let last = "";
        for (const file of list) {
            const kind = kindOf(file.name) == "text" && file.type.startsWith("image/") ? "image" : kindOf(file.name);
            let name = this.cleanName(file.name);
            if (kind == "image" && !extOf(name)) name += "." + (file.type.split("/")[1] || "png");
            let text: string;
            if (kind == "image") {
                if (file.size > 3 * 1024 * 1024) {
                    this.dialogs.alert({
                        title: "Bild ist sehr groß",
                        text: `„${file.name}“ ist ${(file.size / 1024 / 1024).toFixed(1)} MB groß. Verkleinere das Bild (z. B. mit der Fotos-App oder einem Screenshot), damit dein Projekt handlich bleibt.`
                    });
                    continue;
                }
                text = await new Promise<string>((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = () => resolve(String(r.result));
                    r.onerror = () => reject(r.error);
                    r.readAsDataURL(file);
                });
            } else {
                text = await file.text();
            }
            this.files.push({ name, text });
            last = name;
        }
        if (!last) return;
        this.markModified();
        this.computeProblems();
        this.setActive(last);
        this.setView("code");
        this.toast(list.length == 1 ? `„${last}“ hinzugefügt.` : `${list.length} Dateien hinzugefügt.`, "check");
    }

    async fileActions(f: ProjectFile) {
        const kind = kindOf(f.name);
        const choice = await this.dialogs.actions(f.name, [
            { id: "rename", label: "Umbenennen", icon: "edit" },
            { id: "download", label: kind == "image" ? "Bild sichern" : "Diese Datei einzeln sichern", icon: "save" },
            { id: "delete", label: "Löschen", icon: "trash", danger: true, disabled: this.files.length <= 1 },
        ]);
        if (choice == "rename") {
            const ext = extOf(f.name);
            const newName = await this.dialogs.prompt({
                title: `${KIND_LABEL[kind]} umbenennen`, label: "Neuer Name", value: f.name, confirm: "Umbenennen",
                validate: (v) => this.checkName(this.withExt(v, ext || "html"), f.name)
            });
            if (!newName) return;
            const n = this.withExt(newName, ext || "html");
            if (n == f.name) return;
            const old = f.name;
            f.name = n;
            this.editor.renameFile(old, n);
            this.preview.renamePage(old, n);
            if (this.active == old) this.active = n;
            if (this.previewPage == old) this.previewPage = n;
            const uses = this.files.filter(x => kindOf(x.name) != "image" && x.text.includes(old)).length;
            this.markModified();
            this.setActive(this.active);
            this.computeProblems();
            if (uses > 0) {
                const update = await this.dialogs.confirm({
                    title: "Verweise anpassen?",
                    text: `„${old}“ kommt in ${uses == 1 ? "einer Datei" : uses + " Dateien"} vor (z. B. in einem Link). Soll HyperPad dort „${n}“ eintragen?`,
                    confirm: "Anpassen"
                });
                if (update) this.replaceReferences(old, n);
            }
        } else if (choice == "download") {
            this.downloadSingle(f);
        } else if (choice == "delete") {
            const ok = await this.dialogs.confirm({
                title: `„${f.name}“ löschen?`,
                text: "Die Datei wird aus diesem Projekt entfernt. Das lässt sich nicht rückgängig machen.",
                confirm: "Löschen", danger: true
            });
            if (!ok) return;
            this.files = this.files.filter(x => x != f);
            this.editor.forgetFile(f.name);
            this.markModified();
            const next = this.files.find(x => kindOf(x.name) == "html") || this.files[0];
            if (this.previewPage == f.name) this.previewPage = "";
            this.setActive(next.name);
            this.computeProblems();
        }
    }

    private replaceReferences(oldName: string, newName: string) {
        const re = new RegExp(`(["'(/=]\\s*(?:\\./)?)${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s"')#?>])`, "g");
        for (const x of this.files) {
            if (kindOf(x.name) == "image") continue;
            x.text = x.text.replace(re, `$1${newName}`);
        }
        this.editor.forgetAll();
        this.markModified();
        this.setActive(this.active);
        this.computeProblems();
        this.toast("Verweise angepasst.", "check");
    }

    // =====================================================================
    // Vorschau
    // =====================================================================

    refreshPreview() {
        const page = this.file(this.previewPage);
        const title = page ? pageTitle(page.text) : null;
        this.el.previewTitle.textContent = page ? (title || "(ohne Titel)") : "Keine HTML-Seite";
        this.el.previewFile.textContent = page ? page.name : "";
        this.el.openTabBtn.toggleAttribute("disabled", !page);
        if (!page) {
            this.preview.frame.srcdoc = `<p style="font-family:sans-serif;color:#566177;padding:24px">Lege eine HTML-Seite an, um hier die Vorschau zu sehen.</p>`;
            return;
        }
        this.preview.show(page.name, this.files);
    }

    private onPreviewMessage(m: PreviewMessage) {
        switch (m.type) {
            case "navigate": {
                const target = normalizeRef(m.href);
                if (!target) return;
                const f = this.file(target) || this.files.find(x => x.name.toLowerCase() == target.toLowerCase());
                if (f && kindOf(f.name) == "html") {
                    this.preview.resetScroll(f.name);
                    this.setActive(f.name);
                    this.toast(`Seite „${f.name}“ geöffnet.`, "eye");
                } else if (f) {
                    this.toast(`„${f.name}“ ist keine HTML-Seite.`);
                } else {
                    this.toast(`Die Seite „${target}“ gibt es in deinem Projekt nicht. Prüfe die Schreibweise im Link.`, "problems");
                }
                break;
            }
            case "external":
                window.open(m.href, "_blank", "noopener");
                break;
            case "submit":
                this.toast("Formulare werden in der Vorschau nicht abgeschickt.");
                break;
            case "error":
                if (this.scriptErrors.length < 20 && !this.scriptErrors.includes(m.message)) {
                    this.scriptErrors.push(m.message);
                    this.renderProblems();
                }
                break;
        }
    }

    private openInNewTab() {
        const page = this.file(this.previewPage);
        if (!page) return;
        const doc = buildDocument(page.name, this.files, { standalone: true });
        const url = URL.createObjectURL(new Blob([doc], { type: "text/html;charset=utf-8" }));
        const w = window.open(url, "_blank");
        if (!w) location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    // =====================================================================
    // Probleme und Hinweise
    // =====================================================================

    computeProblems() {
        const list: Problem[] = [];
        for (const f of this.files) {
            const kind = kindOf(f.name);
            if (kind != "html" && kind != "css") continue;
            const ds = diagnose(f.name, f.text, kind == "html" ? () => html() : () => css(), kind);
            for (const d of ds) {
                const line = f.text.substring(0, d.from).split("\n").length;
                list.push({ file: f.name, d, line });
            }
        }
        list.sort((a, b) => (a.d.severity == "error" ? 0 : 1) - (b.d.severity == "error" ? 0 : 1));
        this.problems = list;
        this.renderProblems();
        this.renderFileTabs();
    }

    renderProblems() {
        const host = this.el.problems;
        host.innerHTML = "";
        const count = this.problems.length + this.scriptErrors.length;
        if (count == 0) {
            host.innerHTML = `<div class="hp-empty">${icon("check")}<p>Keine Probleme gefunden.</p><p class="hp-hint">Alle Tags sind richtig geschlossen.</p></div>`;
        }
        for (const msg of this.scriptErrors) {
            const b = document.createElement("div");
            b.className = "hp-problem is-error";
            b.innerHTML = `<span class="hp-problem-where">JavaScript in ${escapeHtml(this.previewPage)}</span><span class="hp-problem-msg">${escapeHtml(msg)}</span>`;
            host.appendChild(b);
        }
        for (const p of this.problems) {
            const b = document.createElement("button");
            b.className = "hp-problem " + (p.d.severity == "error" ? "is-error" : "is-warning");
            b.innerHTML = `<span class="hp-problem-where">${escapeHtml(p.file)}, Zeile ${p.line}</span>
                <span class="hp-problem-msg">${escapeHtml(p.d.message)}</span>`;
            b.addEventListener("click", () => {
                if (this.active != p.file) this.setActive(p.file);
                this.setView("code");
                this.editor.revealOffset(p.d.from);
                this.editor.focus();
            });
            host.appendChild(b);
        }
        for (const badge of [this.el.navBadge, this.el.sideBadge]) {
            badge.textContent = count > 0 ? String(count) : "";
            badge.hidden = count == 0;
        }
    }

    private hintTimer: any;
    /** Zeigt unter dem Editor den Hinweis zur Cursorzeile an (auf dem iPad gibt es kein Mouse-over). */
    updateHintSoon() {
        clearTimeout(this.hintTimer);
        this.hintTimer = setTimeout(() => {
            const bar = this.el.hintBar;
            if (kindOf(this.active) == "image") { bar.hidden = true; return; }
            const pos = this.editor.getCursorOffset();
            const line = this.editor.view.state.doc.lineAt(pos);
            const ds = this.editor.diagnostics().filter(d => d.from <= line.to && d.to >= line.from);
            if (ds.length == 0) { bar.hidden = true; return; }
            const d = ds.find(x => x.severity == "error") || ds[0];
            bar.className = "hp-hintbar is-" + d.severity;
            bar.innerHTML = icon("problems") + `<span>${escapeHtml(d.message)}</span>`;
            bar.hidden = false;
        }, 150);
    }

    showInfo() {
        const tag = this.editor.tagAtCursor();
        if (tag && TAG_INFO[tag]) {
            this.dialogs.sheet(`<${tag}>`, `<div class="hp-doc"><p>${escapeHtml(TAG_INFO[tag])}</p></div>`);
            return;
        }
        if (tag) {
            this.toast(`Zu <${tag}> gibt es keine Beschreibung.`);
            return;
        }
        this.toast("Setze den Cursor in ein Tag, z. B. in <h1>, um zu erfahren, wofür es da ist.");
    }

    // =====================================================================
    // Projekte
    // =====================================================================

    renderProjectTitle() {
        this.el.projectName.textContent = this.project.name;
        const unsaved = this.project.modified > this.project.exported;
        this.el.projectState.textContent = unsaved
            ? (this.project.exported == 0 ? "noch nie als Datei gesichert" : "Änderungen nicht als Datei gesichert")
            : "als Datei gesichert";
        this.root.classList.toggle("is-unsaved", unsaved);
    }

    markModified() {
        this.project.modified = Date.now();
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flush(), 400);
    }

    /** Speichert sofort im Browser (IndexedDB). */
    flush() {
        clearTimeout(this.saveTimer);
        this.store.writeFiles(this.project.id, this.files).catch(e => console.warn("Speichern fehlgeschlagen", e));
        this.store.update(this.project.id, { modified: this.project.modified });
        this.renderProjectTitle();
    }

    async renameProject() {
        const name = await this.dialogs.prompt({
            title: "Projekt umbenennen", label: "Projektname", value: this.project.name, confirm: "Umbenennen",
            validate: v => v.trim().length == 0 ? "Bitte gib einen Namen ein." : null
        });
        if (!name || name.trim() == this.project.name) return;
        this.project.name = this.store.uniqueName(name.trim(), this.project.id);
        this.store.update(this.project.id, { name: this.project.name });
        this.renderProjectTitle();
        this.renderProjectList();
    }

    renderProjectList() {
        const ul = this.el.projectList;
        ul.innerHTML = "";
        const fmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" });
        for (const p of this.store.list()) {
            const li = document.createElement("li");
            const isCurrent = p.id == this.project.id;
            li.className = "hp-projectitem" + (isCurrent ? " is-current" : "");
            li.innerHTML = `
                <button class="hp-projectitem-open">${icon(isCurrent ? "check" : "folder")}
                    <span><span class="hp-projectitem-name">${escapeHtml(p.name)}</span>
                    <span class="hp-projectitem-date">geändert ${fmt.format(new Date(p.modified))}</span></span>
                </button>
                <button class="hp-iconbtn hp-projectitem-del" aria-label="Projekt „${escapeHtml(p.name)}“ löschen">${icon("trash")}</button>`;
            li.querySelector(".hp-projectitem-open")!.addEventListener("click", () => {
                if (!isCurrent) this.switchToProject(p.id); else this.closeDrawer();
            });
            li.querySelector(".hp-projectitem-del")!.addEventListener("click", () => this.deleteProject(p));
            ul.appendChild(li);
        }
    }

    async switchToProject(id: string) {
        this.flush();
        this.store.setCurrentId(id);
        const p = this.store.get(id);
        if (!p) return;
        this.project = p;
        this.files = (await this.store.readFiles(id)) || STARTER_FILES.map(f => ({ ...f }));
        this.editor.forgetAll();
        this.previewPage = "";
        this.problems = [];
        const first = this.files.find(f => kindOf(f.name) == "html") || this.files[0];
        this.setActive(first.name);
        this.computeProblems();
        this.renderProjectTitle();
        this.closeDrawer();
        this.setView("code");
    }

    async newProject() {
        const name = await this.dialogs.prompt({
            title: "Neues Projekt", label: "Projektname", placeholder: "z. B. Meine Hobbys", confirm: "Anlegen",
            validate: v => v.trim().length == 0 ? "Bitte gib einen Namen ein." : null
        });
        if (!name) return;
        const p = this.store.createInfo(name.trim());
        await this.store.writeFiles(p.id, STARTER_FILES);
        await this.switchToProject(p.id);
    }

    async deleteProject(p: ProjectInfo) {
        const ok = await this.dialogs.confirm({
            title: `„${p.name}“ löschen?`,
            text: p.exported >= p.modified ? "Das Projekt wird von diesem Gerät gelöscht. Deine gesicherte Datei bleibt erhalten."
                : "Das Projekt wird von diesem Gerät gelöscht. Es wurde nicht als Datei gesichert und ist danach verloren.",
            confirm: "Löschen", danger: true
        });
        if (!ok) return;
        const wasCurrent = p.id == this.project.id;
        await this.store.deleteProject(p.id);
        if (wasCurrent) {
            let next = this.store.list()[0];
            if (!next) {
                next = this.store.createInfo("Meine erste Webseite");
                await this.store.writeFiles(next.id, STARTER_FILES);
            }
            await this.switchToProject(next.id);
            this.openDrawer();
        } else {
            this.renderProjectList();
        }
    }

    /** Teilen-Menü (iPad: „In Dateien sichern“, AirDrop …) oder Download */
    private async saveFile(file: File): Promise<boolean> {
        const nav: any = navigator;
        if (nav.canShare && nav.canShare({ files: [file] })) {
            try {
                await nav.share({ files: [file], title: file.name });
                return true;
            } catch (e: any) {
                if (e && e.name == "AbortError") return false;
            }
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        return true;
    }

    async exportProject() {
        this.flush();
        const json = ProjectStore.toExport(this.project.name, this.files);
        const filename = this.project.name.replace(/[\\/:*?"<>|]/g, "_") + ".hyperpad.json";
        const ok = await this.saveFile(new File([json], filename, { type: "application/json" }));
        if (!ok) return;
        this.project.exported = Date.now();
        this.store.update(this.project.id, { exported: this.project.exported, modified: this.project.modified });
        this.renderProjectTitle();
        this.toast(`„${filename}“ gesichert.`, "check");
    }

    // ----- Projekt als ZIP: KLASSE_NACHNAME_VORNAME_PROJEKTNAME_DATUM_UHRZEIT.zip -----

    private getStudent(): { klasse: string, nachname: string, vorname: string } {
        try {
            const v = JSON.parse(localStorage.getItem("hyperpad.student") || "{}");
            return { klasse: v.klasse || "", nachname: v.nachname || "", vorname: v.vorname || "" };
        } catch (e) { return { klasse: "", nachname: "", vorname: "" }; }
    }

    private setStudent(v: { klasse: string, nachname: string, vorname: string }) {
        try { localStorage.setItem("hyperpad.student", JSON.stringify(v)); } catch (e) { }
    }

    /** Teil eines Datei-/Ordnernamens: ohne verbotene Zeichen, Leerzeichen werden zu Bindestrichen */
    private namePart(s: string): string {
        return s.trim().replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "-");
    }

    private zipBaseName(v: Record<string, string>): string {
        return [v.klasse, v.nachname, v.vorname, v.projekt].map(x => this.namePart(x || "")).filter(x => x).join("_");
    }

    private stamp(d: Date): string {
        const p = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
    }

    async exportZip() {
        this.flush();
        const student = this.getStudent();
        const v = await this.dialogs.form({
            title: "Projekt als zip sichern",
            text: "Klasse und Name helfen deiner Lehrkraft, die Abgabe zuzuordnen. Du kannst sie auch leer lassen.",
            fields: [
                { id: "klasse", label: "Klasse", value: student.klasse, placeholder: "z. B. 8b" },
                { id: "nachname", label: "Nachname", value: student.nachname, placeholder: "z. B. Müller", capitalize: true },
                { id: "vorname", label: "Vorname", value: student.vorname, placeholder: "z. B. Anna", capitalize: true },
                { id: "projekt", label: "Projektname", value: this.project.name, wide: true },
            ],
            confirm: "Sichern",
            previewLabel: "Dateiname",
            preview: (x) => this.zipBaseName(x) + "_" + this.stamp(new Date()) + ".zip",
            validate: (x) => this.namePart(x.projekt || "") ? null : "Bitte gib einen Projektnamen ein.",
        });
        if (!v) return;
        this.setStudent({ klasse: v.klasse.trim(), nachname: v.nachname.trim(), vorname: v.vorname.trim() });

        const now = new Date();
        const folder = this.zipBaseName(v);
        const filename = `${folder}_${this.stamp(now)}.zip`;
        const enc = new TextEncoder();
        const { createZip, dataUrlToBytes } = await import("./Zip.js");
        const entries: import("./Zip.js").ZipEntry[] = [{ path: folder + "/", data: new Uint8Array(0) }];
        for (const f of this.files) {
            const data = kindOf(f.name) == "image" && f.text.startsWith("data:") ? dataUrlToBytes(f.text) : enc.encode(f.text);
            entries.push({ path: `${folder}/${f.name}`, data });
        }
        const zip = createZip(entries, now);
        const ok = await this.saveFile(new File([zip], filename, { type: "application/zip" }));
        if (ok) this.toast(`„${filename}“ gesichert.`, "check");
    }

    // ----- Offenen Tab als einzelne Datei -----

    async exportOpenTab() {
        const f = this.file(this.active);
        if (!f) return;
        this.flush();
        const ext = extOf(f.name);
        const name = await this.dialogs.prompt({
            title: "Offenen Tab als Datei sichern",
            label: "Dateiname",
            value: f.name,
            confirm: "Sichern",
            validate: (x) => {
                const n = x.trim();
                if (!n) return "Bitte gib einen Dateinamen ein.";
                if (/[\\/:*?"<>|]/.test(n)) return "Diese Zeichen sind in Dateinamen nicht erlaubt: \\ / : * ? \" < > |";
                return null;
            }
        });
        if (!name) return;
        let n = name.trim();
        // Fehlt die Endung, die des Tabs anhängen (sonst lässt sich die Datei nicht öffnen)
        if (!extOf(n) && ext) n += "." + ext;
        this.downloadSingle(f, n);
    }

    private async downloadSingle(f: ProjectFile, saveAs: string = f.name) {
        let file: File;
        if (kindOf(f.name) == "image") {
            const blob = await (await fetch(f.text)).blob();
            file = new File([blob], saveAs, { type: blob.type });
        } else {
            const type = { html: "text/html;charset=utf-8", css: "text/css;charset=utf-8", js: "text/javascript;charset=utf-8" }[<string>kindOf(f.name)] || "text/plain";
            file = new File([f.text], saveAs, { type });
        }
        if (await this.saveFile(file)) this.toast(`„${saveAs}“ gesichert.`, "check");
    }

    async importProject(file: File) {
        try {
            const text = await file.text();
            const { name, files } = ProjectStore.parseImport(text, file.name.replace(/\.hyperpad\.json$/i, ".json"));
            const p = this.store.createInfo(name);
            await this.store.writeFiles(p.id, files);
            const now = Date.now();
            this.store.update(p.id, { exported: now, modified: now });
            await this.switchToProject(p.id);
            this.toast(`„${p.name}“ geöffnet.`, "check");
        } catch (e: any) {
            this.dialogs.alert({ title: "Datei lässt sich nicht öffnen", text: e?.message || String(e) });
        }
    }

    // =====================================================================
    // Menü & Einstellungen
    // =====================================================================

    async openColors() {
        const { openColorBook } = await import("./ColorBook.js");
        openColorBook(this.root, (t, i) => this.toast(t, i));
    }

    openDrawer() {
        this.flush();
        this.renderProjectList();
        this.renderSettings();
        this.root.classList.add("drawer-open");
        this.el.drawer.removeAttribute("inert");
        (<HTMLElement>this.el.drawerClose).focus({ preventScroll: true });
    }

    closeDrawer() {
        this.root.classList.remove("drawer-open");
        this.el.drawer.setAttribute("inert", "");
    }

    getEditorFullWidth(): boolean {
        try { return localStorage.getItem("hyperpad.editorFullWidth") == "1"; } catch (e) { return false; }
    }

    setEditorFullWidth(on: boolean) {
        try { localStorage.setItem("hyperpad.editorFullWidth", on ? "1" : "0"); } catch (e) { }
    }

    getThemeChoice(): ThemeChoice {
        try { return <ThemeChoice>(localStorage.getItem("hyperpad.theme") || "auto"); } catch (e) { return "auto"; }
    }

    effectiveTheme(): "light" | "dark" {
        const c = this.getThemeChoice();
        if (c == "auto") return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        return c;
    }

    setThemeChoice(c: ThemeChoice) {
        try { localStorage.setItem("hyperpad.theme", c); } catch (e) { }
        this.applyTheme(c);
        this.renderSettings();
    }

    applyTheme(c: ThemeChoice) {
        document.documentElement.dataset.theme = c;
        const eff = this.effectiveTheme();
        document.documentElement.dataset.effective = eff;
        document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", eff == "dark" ? "#151922" : "#F3F5F9"));
    }

    getFontSize(): number {
        try { return parseInt(localStorage.getItem("hyperpad.fontSize") || "") || 16; } catch (e) { return 16; }
    }

    changeFontSize(delta: number) {
        const size = Math.max(12, Math.min(24, this.getFontSize() + delta));
        try { localStorage.setItem("hyperpad.fontSize", String(size)); } catch (e) { }
        this.editor?.setFontSize(size);
        this.renderSettings();
    }

    renderSettings() {
        const c = this.getThemeChoice();
        this.el.themeSwitch.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach(b =>
            b.setAttribute("aria-pressed", String(b.dataset.themeChoice == c)));
        this.el.fontSizeLabel.textContent = this.getFontSize() + " pt";
    }

    // =====================================================================
    // Hinweise
    // =====================================================================

    async copy(text: string) {
        try {
            await navigator.clipboard.writeText(text);
            this.toast(`Kopiert: ${text}`, "check");
        } catch (e) {
            this.toast(text);
        }
    }

    private toastTimer: any;
    toast(text: string, iconName: string = "info") {
        let t = this.root.querySelector<HTMLElement>(".hp-toast");
        if (!t) {
            t = document.createElement("div");
            t.className = "hp-toast";
            t.setAttribute("role", "status");
            this.root.appendChild(t);
        }
        t.innerHTML = icon(iconName) + `<span>${escapeHtml(text)}</span>`;
        t.classList.add("is-visible");
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => t!.classList.remove("is-visible"), 3600);
    }
}
