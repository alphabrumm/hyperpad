export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type FileKind = "html" | "css" | "js" | "image" | "text";

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "svg", "webp"];

export function extOf(name: string): string {
    const i = name.lastIndexOf(".");
    return i < 0 ? "" : name.substring(i + 1).toLowerCase();
}

export function kindOf(name: string): FileKind {
    const e = extOf(name);
    if (e == "html" || e == "htm") return "html";
    if (e == "css") return "css";
    if (e == "js") return "js";
    if (IMAGE_EXT.includes(e)) return "image";
    return "text";
}

export function isImageFile(name: string) { return kindOf(name) == "image"; }

/** Dateinamen, wie sie in Webadressen funktionieren: keine Leerzeichen, keine Umlaute. */
export function validateFileName(name: string): string | null {
    if (name.length == 0) return "Bitte gib einen Namen ein.";
    if (/\s/.test(name)) return "Dateinamen dürfen keine Leerzeichen enthalten. Nimm z. B. „meine-seite“ oder „meine_seite“.";
    if (/[äöüÄÖÜß]/.test(name)) return "Verwende keine Umlaute und kein ß im Dateinamen (ä → ae, ö → oe, ü → ue, ß → ss).";
    if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(name)) return "Erlaubt sind nur Buchstaben a–z, Ziffern, Bindestrich - und Unterstrich _.";
    return null;
}
