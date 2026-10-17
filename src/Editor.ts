import { EditorState, Extension, Compartment, EditorSelection } from "@codemirror/state";
import {
    EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, dropCursor, layer, RectangleMarker
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth, toggleComment, indentMore } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, indentUnit, getIndentUnit } from "@codemirror/language";
import {
    autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, startCompletion,
    Completion, CompletionContext, CompletionResult, CompletionSource, completeFromList, pickedCompletion
} from "@codemirror/autocomplete";
import { lintGutter, forEachDiagnostic, Diagnostic } from "@codemirror/lint";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import { kindOf } from "./util.js";
import { TAG_INFO, VOID_TAGS, BOOLEAN_ATTRIBUTES } from "./tagInfo.js";
import { htmlLinter, cssLinter } from "./lint.js";

/**
 * Der Editor von HyperPad (CodeMirror 6).
 *
 * CodeMirror verwendet ein natives contenteditable-Element. Dadurch funktionieren auf
 * iPad und Handy die systemeigene Textauswahl (Griffe, Lupe), Diktat und Hardware-Tastaturen.
 * Jede Datei hat ihren eigenen EditorState (eigene Rückgängig-Historie).
 */

/**
 * iPhone/iPad mit Bildschirmtastatur: Ein Doppeltipp auf ein Wort liefert von Safari manchmal
 * eine Auswahl vom Textanfang (Position 0) bis zum Wort. Kommt so eine Auswahl direkt nach zwei
 * schnellen Fingertipps an, ersetzen wir sie durch das angetippte Wort. Echte Auswahlen
 * (Griffe ziehen, „Alles auswählen“) sind davon nicht betroffen.
 */
function iosDoubleTapFix(): Extension {
    const taps: number[] = [];
    return [
        EditorView.domEventHandlers({
            touchend: (e) => {
                if (e.touches.length == 0 && e.changedTouches.length == 1) {
                    taps.push(Date.now());
                    if (taps.length > 2) taps.shift();
                }
                return false;
            }
        }),
        EditorState.transactionFilter.of(tr => {
            if (!tr.selection || tr.docChanged || !tr.isUserEvent("select")) return tr;
            const now = Date.now();
            if (taps.length < 2 || now - taps[1] > 900 || taps[1] - taps[0] > 600) return tr;
            const sel = tr.selection.main, doc = tr.newDoc;
            if (tr.selection.ranges.length != 1 || sel.empty || sel.from != 0 || sel.to >= doc.length) return tr;
            const word = tr.state.wordAt(sel.to) || (sel.to > 0 ? tr.state.wordAt(sel.to - 1) : null);
            if (!word || word.from == 0) return tr;
            return [tr, { selection: EditorSelection.range(word.from, word.to), userEvent: "select.pointer", sequential: true }];
        })
    ];
}

/**
 * Hervorhebung der Cursorzeile als eigene Ebene hinter dem Text.
 *
 * CodeMirrors highlightActiveLine() setzt die Klasse „cm-activeLine“ direkt an den Zeilen im
 * bearbeitbaren Bereich. Auf iPhone/iPad passiert das beim ersten Tipp eines Doppeltipps – Safari
 * verliert dadurch den Ankerpunkt der Wortauswahl und markiert alles vom Textanfang bis zum Wort
 * (außer in der Zeile, in der der Cursor schon stand). Diese Ebene liegt außerhalb des
 * contenteditable-Elements und verändert die Zeilen nicht.
 */
const activeLineLayer = layer({
    above: false,
    class: "pad-activeline-layer",
    update: (update) => update.selectionSet || update.docChanged || update.viewportChanged || update.geometryChanged || update.focusChanged,
    markers: (view) => {
        const sel = view.state.selection.main;
        if (!sel.empty) return [];
        const block = view.lineBlockAt(sel.head);
        const scroller = view.scrollDOM.getBoundingClientRect();
        const content = view.contentDOM.getBoundingClientRect();
        const baseLeft = scroller.left - view.scrollDOM.scrollLeft * view.scaleX;
        const baseTop = scroller.top - view.scrollDOM.scrollTop * view.scaleY;
        const top = (view.documentTop + block.top * view.scaleY - baseTop) / view.scaleY;
        const left = (content.left - baseLeft) / view.scaleX;
        return [new RectangleMarker("pad-activeline", left, top, content.width / view.scaleX, block.height)];
    }
});

export const hyperHighlight = HighlightStyle.define([
    // HTML
    { tag: [t.tagName], color: "var(--syn-tag)", fontWeight: "600" },
    { tag: [t.angleBracket], color: "var(--syn-bracket)" },
    { tag: [t.attributeName], color: "var(--syn-attr)" },
    { tag: [t.attributeValue], color: "var(--syn-string)" },
    { tag: [t.documentMeta, t.processingInstruction], color: "var(--syn-meta)", fontStyle: "italic" },
    { tag: [t.character, t.special(t.string)], color: "var(--syn-entity)" },
    // CSS
    { tag: [t.className, t.labelName], color: "var(--syn-selector)" },
    { tag: [t.constant(t.className)], color: "var(--syn-selector)" },
    { tag: [t.propertyName], color: "var(--syn-property)" },
    { tag: [t.unit], color: "var(--syn-number)" },
    { tag: [t.color], color: "var(--syn-number)" },
    // JavaScript & allgemein
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: "var(--syn-keyword)", fontWeight: "600" },
    { tag: [t.typeName, t.namespace], color: "var(--syn-type)" },
    { tag: [t.string], color: "var(--syn-string)" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syn-number)" },
    { tag: [t.lineComment, t.blockComment, t.docComment, t.comment], color: "var(--syn-comment)", fontStyle: "italic" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-method)" },
    { tag: [t.operator, t.punctuation, t.bracket, t.paren, t.brace, t.squareBracket, t.separator], color: "var(--syn-punct)" },
    { tag: t.invalid, color: "var(--danger)" },
]);

// ---------------------------------------------------------------------------
// Vervollständigung: Tags werden gleich vollständig eingefügt, <p> → <p>|</p>
// ---------------------------------------------------------------------------

/** Vorlagen für die Vervollständigung; § markiert die Cursorposition. */
const TAG_TEMPLATES: Record<string, string> = {
    a: 'a href="§"></a>',
    img: 'img src="§" alt="">',
    link: 'link rel="stylesheet" href="§">',
    meta: 'meta §>',
    input: 'input type="§">',
    script: 'script>§</script>',
    style: 'style>§</style>',
};

function templateFor(name: string): string {
    const n = name.toLowerCase();
    if (TAG_TEMPLATES[n]) return TAG_TEMPLATES[n];
    if (VOID_TAGS.has(n)) return n + ">§";
    return `${n}>§</${n}>`;
}

function insertTemplate(view: EditorView, completion: Completion, from: number, to: number, template: string) {
    const cursor = template.indexOf("§");
    const text = template.replace("§", "");
    view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + (cursor < 0 ? text.length : cursor) },
        annotations: pickedCompletion.of(completion),
        userEvent: "input.complete",
        scrollIntoView: true,
    });
}

/** Steht hinter dem Cursor schon der Rest eines Tags (Name wird nur geändert)? */
function editingExisting(state: EditorState, to: number): boolean {
    const next = state.sliceDoc(to, to + 1);
    return next == ">" || next == " " || next == "/";
}

function enhanceTag(o: Completion, state: EditorState, from: number, name: string): Completion {
    const info = TAG_INFO[name.toLowerCase()];
    return {
        ...o,
        detail: info,
        apply: (view, completion, f, to) => {
            if (editingExisting(view.state, to)) {
                view.dispatch({
                    changes: { from: f, to, insert: (o.label.startsWith("<") ? "<" : "") + name },
                    selection: { anchor: f + name.length + (o.label.startsWith("<") ? 1 : 0) },
                    annotations: pickedCompletion.of(completion), userEvent: "input.complete"
                });
                return;
            }
            insertTemplate(view, completion, f, to, (o.label.startsWith("<") ? "<" : "") + templateFor(name));
        }
    };
}

function enhanceAttribute(o: Completion): Completion {
    if (BOOLEAN_ATTRIBUTES.has(o.label)) return o;
    return {
        ...o,
        apply: (view, completion, from, to) => {
            if (view.state.sliceDoc(to, to + 1) == "=") {
                view.dispatch({ changes: { from, to, insert: o.label }, annotations: pickedCompletion.of(completion), userEvent: "input.complete" });
                return;
            }
            insertTemplate(view, completion, from, to, o.label + '="§"');
        }
    };
}

function transform(result: CompletionResult, state: EditorState): CompletionResult {
    const before = state.sliceDoc(result.from - 1, result.from);
    const options = result.options.map(o => {
        if (o.type == "type" && !o.apply) {
            if (before == "<" && /^[a-zA-Z][\w-]*$/.test(o.label)) return enhanceTag(o, state, result.from, o.label);
            if (/^<[a-zA-Z][\w-]*$/.test(o.label)) return enhanceTag(o, state, result.from, o.label.substring(1));
        }
        if (o.type == "property" && !o.apply && before != ":" && /^[a-z][\w-]*$/.test(o.label) && kindAt(state, result.from) == "html-attr") {
            return enhanceAttribute(o);
        }
        return o;
    });
    return { ...result, options };
}

/** Grobe Einordnung: stehen wir in einem HTML-Tag (Attribut)? */
function kindAt(state: EditorState, pos: number): string {
    const lineStart = Math.max(0, pos - 400);
    const text = state.sliceDoc(lineStart, pos);
    const lt = text.lastIndexOf("<"), gt = text.lastIndexOf(">");
    return lt > gt && /^<[a-zA-Z]/.test(text.substring(lt)) ? "html-attr" : "other";
}

/** Fragt die Sprachdienste an der Cursorstelle ab (HTML, eingebettetes CSS/JS) und verfeinert die Vorschläge. */
const smartCompletion: CompletionSource = async (ctx: CompletionContext) => {
    const sources = ctx.state.languageDataAt<CompletionSource | readonly (string | Completion)[]>("autocomplete", ctx.pos);
    for (const s of sources) {
        const source: CompletionSource = typeof s == "function" ? s : completeFromList(s as any);
        const r = await source(ctx);
        if (r && r.options.length > 0) return transform(r, ctx.state);
    }
    return null;
};

/** Enter zwischen <tag> und </tag>: schließendes Tag in eine eigene Zeile, Cursor eingerückt dazwischen. */
function explodeTag(view: EditorView): boolean {
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const before = view.state.sliceDoc(sel.head - 1, sel.head);
    const after = view.state.sliceDoc(sel.head, sel.head + 2);
    if (before != ">" || after != "</") return false;
    const line = view.state.doc.lineAt(sel.head);
    const indent = /^\s*/.exec(line.text)![0];
    const unit = getIndentUnit(view.state);
    const inner = indent + " ".repeat(unit);
    view.dispatch({
        changes: { from: sel.head, insert: "\n" + inner + "\n" + indent },
        selection: { anchor: sel.head + 1 + inner.length },
        scrollIntoView: true, userEvent: "input"
    });
    return true;
}

export type EditorListener = {
    onCursorActivity?: () => void;
    onDocChanged?: (name: string, text: string) => void;
    onFocusChanged?: (focused: boolean) => void;
    onHistoryChanged?: (canUndo: boolean, canRedo: boolean) => void;
    onDiagnostics?: (name: string, diagnostics: Diagnostic[]) => void;
};

export class HtmlEditor {

    view: EditorView;
    private name: string | undefined;
    private states: Map<string, EditorState> = new Map();
    private fontSizeCompartment = new Compartment();

    constructor(parent: HTMLElement, private listener: EditorListener, fontSize: number) {
        this.view = new EditorView({
            parent,
            state: EditorState.create({ doc: "", extensions: this.extensionsFor("index.html") }),
        });
        this.view.contentDOM.setAttribute("autocapitalize", "off");
        this.view.contentDOM.setAttribute("autocorrect", "off");
        this.view.contentDOM.setAttribute("spellcheck", "false");
        this.view.contentDOM.setAttribute("translate", "no");
        this.setFontSize(fontSize);
    }

    private extensionsFor(name: string): Extension[] {
        const kind = kindOf(name);
        const lang: Extension[] =
            kind == "html" ? [html({ autoCloseTags: true, matchClosingTags: true }), htmlLinter()] :
                kind == "css" ? [css(), cssLinter()] :
                    kind == "js" ? [javascript()] : [];

        return [
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightSpecialChars(),
            history(),
            dropCursor(),
            indentOnInput(),
            indentUnit.of("  "),
            EditorState.tabSize.of(2),
            syntaxHighlighting(hyperHighlight),
            bracketMatching(),
            closeBrackets(),
            autocompletion({ override: [smartCompletion], activateOnTyping: true, icons: false, maxRenderedOptions: 60 }),
            activeLineLayer,
            iosDoubleTapFix(),
            highlightSelectionMatches(),
            lintGutter(),
            EditorView.lineWrapping,
            ...lang,
            keymap.of([
                { key: "Enter", run: explodeTag },
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...searchKeymap,
                ...historyKeymap,
                ...completionKeymap,
                { key: "Mod-/", run: toggleComment },
                indentWithTab,
            ]),
            this.fontSizeCompartment.of(this.fontTheme(16)),
            EditorView.updateListener.of(u => {
                if (u.docChanged && this.name) this.listener.onDocChanged?.(this.name, u.state.doc.toString());
                if (u.selectionSet || u.docChanged) this.listener.onCursorActivity?.();
                if (u.focusChanged) this.listener.onFocusChanged?.(u.view.hasFocus);
                if (u.transactions.length > 0) {
                    this.listener.onHistoryChanged?.(undoDepth(u.state) > 0, redoDepth(u.state) > 0);
                }
                // Diagnosen (Fehler/Warnungen) weiterreichen
                if (this.name && u.transactions.some(tr => tr.effects.length > 0)) {
                    this.listener.onDiagnostics?.(this.name, this.diagnostics(u.state));
                }
            }),
        ];
    }

    private fontTheme(size: number) {
        return EditorView.theme({ "&": { fontSize: size + "px" } });
    }

    setFontSize(size: number) {
        this.view.dispatch({ effects: this.fontSizeCompartment.reconfigure(this.fontTheme(size)) });
    }

    diagnostics(state: EditorState = this.view.state): Diagnostic[] {
        const list: Diagnostic[] = [];
        forEachDiagnostic(state, (d, from, to) => list.push({ ...d, from, to }));
        return list;
    }

    // ---------- Dateien ----------

    getName() { return this.name; }

    /** Zeigt eine Datei an; jede Datei behält ihren eigenen Zustand (Cursor, Rückgängig). */
    showFile(name: string, text: string) {
        if (this.name) this.states.set(this.name, this.view.state);
        let state = this.states.get(name);
        if (!state || state.doc.toString() != text) {
            state = EditorState.create({ doc: text, extensions: this.extensionsFor(name), selection: EditorSelection.cursor(0) });
        }
        this.name = name;
        // setState löst keinen Update-Listener aus – Name vorher setzen, danach Zustand melden
        this.view.setState(state);
        this.listener.onHistoryChanged?.(undoDepth(state) > 0, redoDepth(state) > 0);
        this.view.scrollDOM.scrollTop = 0;
    }

    renameFile(oldName: string, newName: string) {
        // Die Sprache kann sich mit der Endung ändern – der Zustand wird beim nächsten Anzeigen neu aufgebaut
        this.states.delete(oldName);
        if (this.name == oldName) {
            this.name = newName;
            this.view.setState(EditorState.create({ doc: this.view.state.doc, extensions: this.extensionsFor(newName), selection: this.view.state.selection }));
        }
    }

    forgetFile(name: string) {
        this.states.delete(name);
        if (this.name == name) this.name = undefined;
    }

    forgetAll() {
        this.states.clear();
        this.name = undefined;
    }

    getText() { return this.view.state.doc.toString(); }

    // ---------- Bearbeiten ----------

    focus() { this.view.focus(); }
    undo() { undo(this.view); this.view.focus(); }
    redo() { redo(this.view); this.view.focus(); }
    indentMore() { indentMore(this.view); }
    startCompletion() { this.view.focus(); startCompletion(this.view); }

    /** Fügt Text ein; § markiert die Cursorposition danach, ausgewählter Text landet dort. */
    insert(template: string) {
        const view = this.view;
        const sel = view.state.selection.main;
        const selected = view.state.sliceDoc(sel.from, sel.to);
        const cursor = template.indexOf("§");
        const text = cursor < 0 ? template : template.replace("§", selected);
        const anchor = sel.from + (cursor < 0 ? text.length : cursor + selected.length);
        view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: { anchor },
            userEvent: "input.type",
            scrollIntoView: true,
        });
        view.focus();
    }

    moveCursor(delta: number) {
        const view = this.view;
        const pos = Math.max(0, Math.min(view.state.doc.length, view.state.selection.main.head + delta));
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        view.focus();
    }

    revealOffset(offset: number) {
        const pos = Math.max(0, Math.min(offset, this.view.state.doc.length));
        this.view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    }

    getCursorOffset() { return this.view.state.selection.main.head; }

    /** Name des HTML-Tags an der Cursorstelle (für den Info-Knopf) */
    tagAtCursor(): string | null {
        const pos = this.getCursorOffset();
        const text = this.view.state.sliceDoc(Math.max(0, pos - 300), Math.min(this.view.state.doc.length, pos + 60));
        const rel = pos - Math.max(0, pos - 300);
        const lt = text.lastIndexOf("<", rel);
        if (lt < 0) return null;
        const gt = text.lastIndexOf(">", rel - 1);
        if (gt > lt) return null;
        const m = /^<\/?([a-zA-Z][\w-]*)/.exec(text.substring(lt));
        return m ? m[1].toLowerCase() : null;
    }
}
