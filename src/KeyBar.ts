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
        this.el.addEventListener("pointerdown", e => {
            if ((<HTMLElement>e.target).closest("button")) e.preventDefault();
        });

        /*
         * iOS Safari nimmt dem Editor beim Tippen auf einen Knopf trotzdem den Fokus, wenn der
         * Knopf nicht in einem scrollbaren Bereich liegt. Für die fest stehenden Knöpfe behandeln
         * wir die Berührung deshalb selbst (wie in JPad).
         */
        let touched: HTMLElement | null = null;
        const narrow = matchMedia("(max-width: 600px)");
        const handleSelf = (b: HTMLElement) => !!b.closest(".is-left") || !narrow.matches;
        this.el.querySelectorAll<HTMLElement>(".hp-keybar-fixed button").forEach(b => {
            b.addEventListener("touchstart", e => {
                if (!handleSelf(b)) return;
                e.preventDefault();
                touched = b;
                b.classList.add("is-pressed");
            }, { passive: false });
            b.addEventListener("touchend", e => {
                if (touched != b) return;
                e.preventDefault();
                b.classList.remove("is-pressed");
                this.activate(b);
                touched = null;
            }, { passive: false });
            b.addEventListener("touchcancel", () => { b.classList.remove("is-pressed"); touched = null; });
        });

        this.el.addEventListener("click", e => {
            const b = (<HTMLElement>e.target).closest<HTMLElement>("button");
            if (b) this.activate(b);
        });

        // Leiste über der Bildschirmtastatur halten
        const vv = window.visualViewport;
        if (vv) {
            const update = () => {
                const offset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
                document.documentElement.style.setProperty("--keyboard-offset", offset + "px");
                document.documentElement.classList.toggle("keyboard-open", offset > 80);
            };
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
