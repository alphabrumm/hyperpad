import { icon } from "./Icons.js";
import { HtmlEditor } from "./Editor.js";

type Key = { label: string, insert?: string, action?: string, aria?: string };

/**
 * Hilfsleiste über der Bildschirmtastatur mit den Zeichen, die man für HTML und CSS
 * ständig braucht und die auf der iPad-Tastatur nur über Umwege erreichbar sind.
 * § markiert die Cursorposition nach dem Einfügen.
 */
const KEYS: Key[] = [
    { label: icon("tab"), action: "tab", aria: "Einrücken" },
    { label: "&lt;", insert: "<", aria: "Kleiner-Zeichen" },
    { label: "&gt;", insert: ">", aria: "Größer-Zeichen" },
    { label: "&lt;/", insert: "</", aria: "Schließendes Tag beginnen" },
    { label: "/", insert: "/" },
    { label: "=\"\"", insert: "=\"§\"", aria: "Gleich und Anführungszeichen" },
    { label: "\" \"", insert: "\"§\"", aria: "Anführungszeichen" },
    { label: "{ }", insert: "{\n  §\n}", aria: "Geschweifte Klammern" },
    { label: ":", insert: ": " },
    { label: ";", insert: ";" },
    { label: "#", insert: "#" },
    { label: ".", insert: "." },
    { label: "−", insert: "-", aria: "Bindestrich" },
    { label: "( )", insert: "(§)", aria: "Runde Klammern" },
    { label: "!", insert: "!" },
    { label: "&amp;", insert: "&", aria: "Und-Zeichen" },
    { label: "px", insert: "px" },
    { label: "%", insert: "%" },
];

export class KeyBar {

    el: HTMLElement;

    constructor(root: HTMLElement, private editor: HtmlEditor, private showInfo: () => void) {
        this.el = document.createElement("div");
        this.el.className = "hp-keybar";
        this.el.setAttribute("role", "toolbar");
        this.el.setAttribute("aria-label", "Sonderzeichen");
        this.el.innerHTML = `
            <div class="hp-keybar-fixed is-left">
                <button data-action="left" aria-label="Cursor nach links">${icon("left")}</button>
                <button data-action="right" aria-label="Cursor nach rechts">${icon("right")}</button>
            </div>
            <div class="hp-keybar-main">
            <div class="hp-keybar-scroll">
                ${KEYS.map((k, i) => `<button data-key="${i}" ${k.aria ? `aria-label="${k.aria}"` : ""}>${k.label}</button>`).join("")}
            </div>
            <div class="hp-keybar-fixed is-right">
                <button data-action="complete" aria-label="Vorschläge anzeigen" class="hp-key-accent">${icon("lightbulb")}</button>
                <button data-action="info" aria-label="Info zum Tag am Cursor">${icon("info")}</button>
                <button data-action="hide" aria-label="Tastatur ausblenden">${icon("keyboardDown")}</button>
            </div>
            </div>`;
        root.appendChild(this.el);

        // Fokus im Editor behalten, sonst schließt sich die Tastatur
        // (wie qPad) auch „mousedown“ – das reicht Safari nach dem Fingertipp nach und verschiebt sonst den Fokus
        for (const ev of ["pointerdown", "mousedown"]) this.el.addEventListener(ev, e => {
            if ((<HTMLElement>e.target).closest("button")) e.preventDefault();
        });

        /*
         * iOS Safari nimmt dem Editor beim Tippen auf einen Knopf der Leiste trotz preventDefault
         * bei pointerdown oft den Fokus – dann klappt die Bildschirmtastatur zu. Ursache sind die
         * Maus-Ereignisse, die Safari nach dem Fingertipp nachreicht. Deshalb behandeln wir jede
         * Berührung selbst: Ein Tipp ohne Wischen wird bei touchend ausgeführt und mit
         * preventDefault abgeschlossen (keine nachgereichten Maus-Ereignisse, kein Fokuswechsel).
         * Knöpfe außerhalb eines scrollbaren Bereichs fangen schon touchstart ab; in der
         * scrollbaren Zeichenleiste bleibt Wischen zum Scrollen erhalten.
         */
        const inScroller = (b: HTMLElement) => {
            for (let p = b.parentElement; p && p != this.el.parentElement; p = p.parentElement) {
                const ox = getComputedStyle(p).overflowX;
                if ((ox == "auto" || ox == "scroll") && p.scrollWidth > p.clientWidth + 1) return true;
            }
            return false;
        };
        let tap: { b: HTMLElement, x: number, y: number, moved: boolean, hadFocus: boolean } | null = null;
        this.el.addEventListener("touchstart", e => {
            const b = (<HTMLElement>e.target).closest<HTMLElement>("button");
            if (!b || e.touches.length > 1) { tap?.b.classList.remove("is-pressed"); tap = null; return; }
            if (!inScroller(b)) e.preventDefault();
            const t = e.touches[0];
            tap = { b, x: t.clientX, y: t.clientY, moved: false, hadFocus: this.editor.view.hasFocus };
            b.classList.add("is-pressed");
        }, { passive: false });
        this.el.addEventListener("touchmove", e => {
            if (!tap || tap.moved) return;
            const t = e.touches[0];
            if (Math.abs(t.clientX - tap.x) > 10 || Math.abs(t.clientY - tap.y) > 10) {
                tap.moved = true;
                tap.b.classList.remove("is-pressed");
            }
        }, { passive: true });
        this.el.addEventListener("touchend", e => {
            const t = tap;
            tap = null;
            if (!t) return;
            t.b.classList.remove("is-pressed");
            if (t.moved) return;
            e.preventDefault();
            t.b.click();
            // Falls Safari den Fokus doch genommen hat: zurückgeben, solange der Finger-Gestus noch gilt
            if (t.hadFocus && !this.editor.view.hasFocus && t.b.dataset.action != "hide") this.editor.view.focus();
        }, { passive: false });
        this.el.addEventListener("touchcancel", () => { tap?.b.classList.remove("is-pressed"); tap = null; });

        this.el.addEventListener("click", e => {
            const b = (<HTMLElement>e.target).closest<HTMLElement>("button");
            if (b) this.activate(b);
        });

        // Leiste über der Bildschirmtastatur halten
        const vv = window.visualViewport;
        if (vv) {
            /*
             * iOS verschiebt bei offener Bildschirmtastatur den sichtbaren Bereich schon beim
             * Antippen ein Stück (Cursor sichtbar halten). Würden wir darauf sofort mit neuem Layout
             * reagieren, änderte sich die Seite zwischen den beiden Tipps eines Doppeltipps – Safari
             * verliert dann den Anker der Wortauswahl und markiert alles bis zum Textanfang.
             * Deshalb: nur echte Änderungen schreiben, Tastatur auf/zu sofort, kleine Verschiebungen
             * erst, wenn gerade nicht getippt wird.
             */
            let lastOffset = -1, lastOpen: boolean | null = null, lastTouch = 0, timer: any;
            const update = () => {
                clearTimeout(timer);
                const offset = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
                const open = offset > 80;
                if (open === lastOpen && Math.abs(offset - lastOffset) < 2) return;
                const quiet = Date.now() - lastTouch;
                if (open === lastOpen && quiet < 700) { timer = setTimeout(update, 700 - quiet); return; }
                lastOffset = offset; lastOpen = open;
                document.documentElement.style.setProperty("--keyboard-offset", offset + "px");
                document.documentElement.classList.toggle("keyboard-open", open);
            };
            const touched = () => { lastTouch = Date.now(); };
            document.addEventListener("touchstart", touched, { capture: true, passive: true });
            document.addEventListener("touchend", touched, { capture: true, passive: true });
            vv.addEventListener("resize", update);
            vv.addEventListener("scroll", update);
            update();
        }
    }

    private activate(b: HTMLElement) {
        if (b.dataset.key != null) {
            const k = KEYS[parseInt(b.dataset.key)];
            if (k.action == "tab") this.editor.indentMore();
            else if (k.insert) this.editor.insert(k.insert);
        } else {
            switch (b.dataset.action) {
                case "left": this.editor.moveCursor(-1); break;
                case "right": this.editor.moveCursor(1); break;
                case "complete": this.editor.startCompletion(); break;
                case "info": this.showInfo(); break;
                case "hide": this.editor.view.contentDOM.blur(); break;
            }
        }
    }

    setEditorFocused(focused: boolean) {
        document.documentElement.classList.toggle("editor-focused", focused);
    }
}
