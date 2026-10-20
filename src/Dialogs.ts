import { icon } from "./Icons.js";
import { escapeHtml } from "./util.js";

type PromptOptions = {
    title: string;
    label: string;
    value?: string;
    placeholder?: string;
    confirm: string;
    validate?: (value: string) => string | null;
    capitalize?: boolean;
};

export type FormField = { id: string, label: string, value?: string, placeholder?: string, capitalize?: boolean, wide?: boolean };

type FormOptions = {
    title: string;
    text?: string;
    fields: FormField[];
    confirm: string;
    focus?: string;
    preview?: (values: Record<string, string>) => string;
    previewLabel?: string;
    validate?: (values: Record<string, string>) => string | null;
};

type ConfirmOptions ={ title: string, text: string, confirm: string, danger?: boolean };

export type ActionItem = { id: string, label: string, icon: string, danger?: boolean, disabled?: boolean };

/**
 * Dialoge als Bottom-Sheets (Handy) bzw. zentrierte Karten (Tablet).
 * Ersetzen prompt()/confirm(), die auf dem iPad unpassend aussehen.
 */
export class Dialogs {

    constructor(private root: HTMLElement) { }

    private open(inner: string, onReady: (sheet: HTMLElement, close: (v: any) => void) => void): Promise<any> {
        return new Promise(resolve => {
            const layer = document.createElement("div");
            layer.className = "hp-sheet-layer";
            layer.innerHTML = `<div class="hp-sheet" role="dialog" aria-modal="true">${inner}</div>`;
            this.root.appendChild(layer);
            const sheet = <HTMLElement>layer.firstElementChild;
            requestAnimationFrame(() => layer.classList.add("is-open"));

            let closed = false;
            const close = (v: any) => {
                if (closed) return;
                closed = true;
                layer.classList.remove("is-open");
                document.removeEventListener("keydown", onKey);
                setTimeout(() => layer.remove(), 200);
                resolve(v);
            };
            const onKey = (e: KeyboardEvent) => { if (e.key == "Escape") close(null); };
            document.addEventListener("keydown", onKey);
            layer.addEventListener("click", (e) => { if (e.target == layer) close(null); });
            sheet.querySelectorAll<HTMLElement>("[data-cancel]").forEach(b => b.addEventListener("click", () => close(null)));
            onReady(sheet, close);
        });
    }

    prompt(o: PromptOptions): Promise<string | null> {
        return this.open(`
            <h2 class="hp-sheet-title">${escapeHtml(o.title)}</h2>
            <form class="hp-form">
                <label class="hp-field">
                    <span>${escapeHtml(o.label)}</span>
                    <input type="text" value="${escapeHtml(o.value || "")}" placeholder="${escapeHtml(o.placeholder || "")}"
                        autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="${o.capitalize ? "words" : "sentences"}" enterkeyhint="done">
                </label>
                <p class="hp-field-error" aria-live="polite"></p>
                <div class="hp-sheet-buttons">
                    <button type="button" class="hp-btn" data-cancel>Abbrechen</button>
                    <button type="submit" class="hp-btn hp-btn-primary">${escapeHtml(o.confirm)}</button>
                </div>
            </form>`, (sheet, close) => {
            const input = sheet.querySelector("input")!;
            const error = sheet.querySelector<HTMLElement>(".hp-field-error")!;
            const form = sheet.querySelector("form")!;
            setTimeout(() => { input.focus(); input.select(); }, 60);
            input.addEventListener("input", () => error.textContent = "");
            form.addEventListener("submit", (e) => {
                e.preventDefault();
                const msg = o.validate?.(input.value);
                if (msg) { error.textContent = msg; input.focus(); return; }
                close(input.value);
            });
        });
    }

    /**
     * Dialog mit mehreren Eingabefeldern. preview() liefert eine Zeile, die sich beim Tippen
     * aktualisiert (z. B. der entstehende Dateiname). Ergebnis: Werte nach Feld-id oder null.
     */
    form(o: FormOptions): Promise<Record<string, string> | null> {
        return this.open(`
            <h2 class="hp-sheet-title">${escapeHtml(o.title)}</h2>
            ${o.text ? `<p class="hp-sheet-text">${escapeHtml(o.text)}</p>` : ""}
            <form class="hp-form">
                <div class="hp-form-grid">
                ${o.fields.map(f => `
                    <label class="hp-field${f.wide ? " is-wide" : ""}">
                        <span>${escapeHtml(f.label)}</span>
                        <input type="text" name="${f.id}" value="${escapeHtml(f.value || "")}" placeholder="${escapeHtml(f.placeholder || "")}"
                            autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="${f.capitalize ? "words" : "off"}" enterkeyhint="next">
                    </label>`).join("")}
                </div>
                ${o.preview ? `<div class="hp-form-preview"><span class="hp-form-preview-label">${escapeHtml(o.previewLabel || "")}</span><code></code></div>` : ""}
                <p class="hp-field-error" aria-live="polite"></p>
                <div class="hp-sheet-buttons">
                    <button type="button" class="hp-btn" data-cancel>Abbrechen</button>
                    <button type="submit" class="hp-btn hp-btn-primary">${escapeHtml(o.confirm)}</button>
                </div>
            </form>`, (sheet, close) => {
            const inputs = Array.from(sheet.querySelectorAll<HTMLInputElement>("input"));
            const error = sheet.querySelector<HTMLElement>(".hp-field-error")!;
            const previewEl = sheet.querySelector<HTMLElement>(".hp-form-preview code");
            const form = sheet.querySelector("form")!;
            const values = () => Object.fromEntries(inputs.map(i => [i.name, i.value]));
            const update = () => { if (previewEl && o.preview) previewEl.textContent = o.preview(values()); };
            update();
            const first = inputs.find(i => i.name == o.focus) || inputs.find(i => !i.value) || inputs[0];
            setTimeout(() => { first.focus(); first.select(); }, 60);
            inputs.forEach((input, idx) => {
                input.addEventListener("input", () => { error.textContent = ""; update(); });
                // Enter springt ins nächste Feld, im letzten Feld wird gesichert
                input.addEventListener("keydown", e => {
                    if (e.key == "Enter" && idx < inputs.length - 1) { e.preventDefault(); inputs[idx + 1].focus(); }
                });
            });
            inputs[inputs.length - 1].setAttribute("enterkeyhint", "done");
            form.addEventListener("submit", (e) => {
                e.preventDefault();
                const v = values();
                const msg = o.validate?.(v);
                if (msg) { error.textContent = msg; return; }
                close(v);
            });
        });
    }

    confirm(o: ConfirmOptions): Promise<boolean> {
        return this.open(`
            <h2 class="hp-sheet-title">${escapeHtml(o.title)}</h2>
            <p class="hp-sheet-text">${escapeHtml(o.text)}</p>
            <div class="hp-sheet-buttons">
                <button class="hp-btn" data-cancel>Abbrechen</button>
                <button class="hp-btn ${o.danger ? "hp-btn-danger" : "hp-btn-primary"}" data-ok>${escapeHtml(o.confirm)}</button>
            </div>`, (sheet, close) => {
            const ok = sheet.querySelector<HTMLElement>("[data-ok]")!;
            ok.addEventListener("click", () => close(true));
            setTimeout(() => ok.focus(), 60);
        }).then(v => v === true);
    }

    alert(o: { title: string, text: string }): Promise<void> {
        return this.open(`
            <h2 class="hp-sheet-title">${escapeHtml(o.title)}</h2>
            <p class="hp-sheet-text">${escapeHtml(o.text)}</p>
            <div class="hp-sheet-buttons"><button class="hp-btn hp-btn-primary" data-cancel>OK</button></div>`, () => { });
    }

    actions(title: string, items: ActionItem[]): Promise<string | null> {
        return this.open(`
            <h2 class="hp-sheet-title">${escapeHtml(title)}</h2>
            <div class="hp-action-list">
                ${items.map(i => `<button class="hp-action${i.danger ? " is-danger" : ""}" data-id="${i.id}" ${i.disabled ? "disabled" : ""}>
                    ${icon(i.icon)}<span>${escapeHtml(i.label)}</span></button>`).join("")}
            </div>
            <div class="hp-sheet-buttons"><button class="hp-btn" data-cancel>Abbrechen</button></div>`, (sheet, close) => {
            sheet.querySelectorAll<HTMLElement>("[data-id]").forEach(b => b.addEventListener("click", () => close(b.dataset.id)));
        });
    }

    sheet(title: string, html: string): Promise<void> {
        return this.open(`
            <h2 class="hp-sheet-title">${escapeHtml(title)}</h2>
            <div class="hp-sheet-content">${html}</div>
            <div class="hp-sheet-buttons"><button class="hp-btn hp-btn-primary" data-cancel>Schließen</button></div>`, () => { });
    }
}
