/**
 * Verwaltung der Projekte von HyperPad.
 *
 * - Die Projektliste (Name, Zeitstempel) liegt im localStorage.
 * - Die Dateien eines Projekts liegen in der IndexedDB „HyperPad“ (ein Eintrag pro Projekt).
 *   Bilder werden als data:-URL gespeichert, damit ein Projekt eine einzige Datei bleibt.
 * - Exportiert wird eine JSON-Datei { hyperpad: 1, name, files: [{ name, text }] }.
 */

import { kindOf } from "./util.js";

export type ProjectInfo = {
    id: string;
    name: string;
    created: number;
    modified: number;
    /** Zeitpunkt des letzten Sicherns als Datei (0 = noch nie) */
    exported: number;
};

export type ProjectFile = { name: string, text: string };

const LIST_KEY = "hyperpad.projects";
const CURRENT_KEY = "hyperpad.current";

function lsGet(key: string): string | null {
    try { return localStorage.getItem(key); } catch (e) { return null; }
}

function lsSet(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch (e) { /* privater Modus o. ä. */ }
}

export function pageTemplate(title: string, body: string = `  <h1>${title}</h1>\n  <p></p>\n`): string {
    return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
</head>
<body>
${body}</body>
</html>
`;
}

/** Neue Projekte starten mit einer kleinen Startseite. */
export const STARTER_FILES: ProjectFile[] = [{
    name: "index.html",
    text: pageTemplate("Meine Seite", "  <h1>Hallo Welt!</h1>\n  <p>Das ist meine erste Webseite.</p>\n")
}];

export class ProjectStore {

    private db: IDBDatabase | undefined;

    async open(): Promise<void> {
        if (this.db) return;
        this.db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("HyperPad", 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore("projects", { keyPath: "id" });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // ---------- Projektliste ----------

    list(): ProjectInfo[] {
        try {
            const list = JSON.parse(lsGet(LIST_KEY) || "[]") as ProjectInfo[];
            return list.sort((a, b) => b.modified - a.modified);
        } catch (e) {
            return [];
        }
    }

    private saveList(list: ProjectInfo[]) {
        lsSet(LIST_KEY, JSON.stringify(list));
    }

    get(id: string): ProjectInfo | undefined {
        return this.list().find(p => p.id == id);
    }

    update(id: string, changes: Partial<ProjectInfo>) {
        const list = this.list();
        const p = list.find(p => p.id == id);
        if (!p) return;
        Object.assign(p, changes);
        this.saveList(list);
    }

    getCurrentId(): string | null { return lsGet(CURRENT_KEY); }
    setCurrentId(id: string) { lsSet(CURRENT_KEY, id); }

    /** Liefert das aktuelle Projekt; legt beim allerersten Start eines an. */
    ensureCurrent(): ProjectInfo {
        const current = this.getCurrentId();
        let p = current ? this.get(current) : undefined;
        if (!p) p = this.list()[0];
        if (!p) p = this.createInfo("Meine erste Webseite");
        this.setCurrentId(p.id);
        return p;
    }

    createInfo(name: string): ProjectInfo {
        const now = Date.now();
        const p: ProjectInfo = {
            id: now.toString(36) + Math.random().toString(36).substring(2, 6),
            name: this.uniqueName(name),
            created: now,
            modified: now,
            exported: 0
        };
        const list = this.list();
        list.push(p);
        this.saveList(list);
        return p;
    }

    uniqueName(name: string, exceptId?: string): string {
        const names = new Set(this.list().filter(p => p.id != exceptId).map(p => p.name));
        if (!names.has(name)) return name;
        let i = 2;
        while (names.has(`${name} (${i})`)) i++;
        return `${name} (${i})`;
    }

    // ---------- Dateien in der IndexedDB ----------

    private request<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction("projects", mode);
            const r = fn(tx.objectStore("projects"));
            tx.oncomplete = () => resolve(r ? r.result : undefined);
            tx.onerror = () => reject(tx.error);
        });
    }

    async readFiles(projectId: string): Promise<ProjectFile[] | null> {
        await this.open();
        const entry: any = await this.request("readonly", s => s.get(projectId));
        return entry ? entry.files : null;
    }

    async writeFiles(projectId: string, files: ProjectFile[]): Promise<void> {
        await this.open();
        await this.request("readwrite", s => { s.put({ id: projectId, files: files.map(f => ({ name: f.name, text: f.text })) }); });
    }

    async deleteProject(projectId: string): Promise<void> {
        await this.open();
        await this.request("readwrite", s => { s.delete(projectId); });
        this.saveList(this.list().filter(p => p.id != projectId));
        if (this.getCurrentId() == projectId) {
            try { localStorage.removeItem(CURRENT_KEY); } catch (e) { }
        }
    }

    // ---------- Import / Export ----------

    static toExport(name: string, files: ProjectFile[]): string {
        return JSON.stringify({ hyperpad: 1, name, files }, undefined, 2);
    }

    /**
     * Liest eine Projektdatei von HyperPad. Einzelne HTML-Dateien werden zu einem Projekt
     * mit dieser einen Seite. Wirft eine Exception mit verständlicher Meldung.
     */
    static parseImport(text: string, filename: string): { name: string, files: ProjectFile[] } {
        const base = filename.replace(/\.[^.]*$/, "");
        if (kindOf(filename) == "html") {
            return { name: base, files: [{ name: "index.html", text }] };
        }
        let data: any;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error(`„${filename}“ ist keine HyperPad-Projektdatei.`);
        }
        if (!data || !Array.isArray(data.files)) {
            throw new Error(`„${filename}“ enthält kein HyperPad-Projekt.`);
        }
        const files: ProjectFile[] = data.files
            .filter((f: any) => f && typeof f.name == "string" && typeof f.text == "string")
            .map((f: any) => ({ name: f.name, text: f.text }));
        if (files.length == 0) throw new Error(`„${filename}“ enthält keine Dateien.`);
        return { name: typeof data.name == "string" && data.name ? data.name : base, files };
    }
}
