import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import { linter, Diagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { VOID_TAGS } from "./tagInfo.js";

/**
 * Einfache, schülergerechte Prüfung des HTML-Codes: nicht geschlossene Tags,
 * falsch verschachtelte Tags, unbekannte Tag-Namen und Schreibfehler in CSS/JavaScript.
 */

const KNOWN_TAGS = new Set(("a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup " +
    "data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html " +
    "i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p param picture pre " +
    "progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup svg table tbody td template " +
    "textarea tfoot th thead time title tr track u ul var video wbr center font marquee " +
    // Elemente innerhalb von <svg>
    "circle ellipse line path polygon polyline rect g text tspan defs use lineargradient radialgradient stop math").split(" "));

function tagName(node: SyntaxNode | null, state: EditorState): string {
    const n = node?.getChild("TagName");
    return n ? state.sliceDoc(n.from, n.to) : "";
}

function htmlDiagnostics(state: EditorState): Diagnostic[] {
    const list: Diagnostic[] = [];
    syntaxTree(state).iterate({
        enter: (ref) => {
            const node = ref.node;
            switch (ref.name) {
                case "Element": {
                    const open = node.getChild("OpenTag");
                    const name = tagName(open, state);
                    const lower = name.toLowerCase();
                    if (!open || !name) break;
                    const nameNode = open.getChild("TagName")!;
                    if (!KNOWN_TAGS.has(lower) && !lower.includes("-")) {
                        list.push({
                            from: nameNode.from, to: nameNode.to, severity: "warning",
                            message: `Das Tag <${name}> gibt es in HTML nicht. Tippfehler?`
                        });
                    }
                    if (!VOID_TAGS.has(lower) && !node.getChild("CloseTag") && !node.getChild("SelfClosingTag")) {
                        list.push({
                            from: nameNode.from, to: nameNode.to, severity: "warning",
                            message: `<${name}> wird nicht mit </${name}> geschlossen.`
                        });
                    }
                    break;
                }
                case "MismatchedCloseTag": {
                    const name = tagName(node, state);
                    const parentOpen = tagName(node.parent?.getChild("OpenTag") ?? null, state);
                    list.push({
                        from: node.from, to: node.to, severity: "error",
                        message: parentOpen
                            ? `</${name}> passt hier nicht: Zuerst muss <${parentOpen}> geschlossen werden.`
                            : `Zu </${name}> gibt es kein öffnendes Tag <${name}>.`
                    });
                    break;
                }
                case "IncompleteCloseTag":
                    list.push({ from: node.from, to: node.to, severity: "error", message: "Das schließende Tag ist unvollständig. Es fehlt das Zeichen >." });
                    break;
                case "⚠":
                    if (node.to > node.from) {
                        list.push({ from: node.from, to: node.to, severity: "warning", message: "Hier stimmt etwas mit der Schreibweise nicht." });
                    }
                    break;
            }
        }
    });
    return list;
}

function cssDiagnostics(state: EditorState): Diagnostic[] {
    const list: Diagnostic[] = [];
    syntaxTree(state).iterate({
        enter: (ref) => {
            if (ref.name == "⚠") {
                const from = ref.from, to = Math.max(ref.to, Math.min(state.doc.length, ref.from + 1));
                list.push({ from, to, severity: "warning", message: "Hier stimmt etwas mit der CSS-Schreibweise nicht (fehlt ein ; oder eine Klammer?)." });
            }
        }
    });
    return list;
}

export const htmlLinter = () => linter(view => htmlDiagnostics(view.state), { delay: 500 });
export const cssLinter = () => linter(view => cssDiagnostics(view.state), { delay: 500 });

/** Prüft eine Datei, ohne dass sie im Editor offen sein muss (für Reiter und Problemliste). */
export function diagnose(name: string, text: string, langExt: () => import("@codemirror/state").Extension, kind: "html" | "css"): Diagnostic[] {
    const state = EditorState.create({ doc: text, extensions: [langExt()] });
    ensureSyntaxTree(state, state.doc.length, 300);
    return kind == "html" ? htmlDiagnostics(state) : cssDiagnostics(state);
}
