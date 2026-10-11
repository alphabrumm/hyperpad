// Schriften lokal ausliefern (keine Verbindung zu Google & Co., datenschutzfreundlich)
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";

import "./hyperpad.css";

import { App } from "./App.js";

async function boot() {
    const root = document.getElementById("hyperpad-app")!;
    try {
        await new App(root).start();
    } catch (e: any) {
        console.error(e);
        root.removeAttribute("aria-busy");
        root.innerHTML = `<div class="hp-fatal"><h1>HyperPad konnte nicht starten</h1>
            <p>Lade die Seite neu. Wenn das nicht hilft, nutze einen aktuellen Browser (Safari ab iOS 16, Chrome, Edge, Firefox).</p>
            <pre>${String(e?.message || e).replace(/</g, "&lt;")}</pre></div>`;
    }
}

if (document.readyState == "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

// Offline-Fähigkeit (nur im fertigen Build, nicht im Entwicklungsserver)
if ("serviceWorker" in navigator && !import.meta.env.DEV) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./hyperpad-sw.js").catch(e => console.warn("Service Worker:", e));
    });
}
