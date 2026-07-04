# ◈ NETNEXUS — STARK-CORE Digital Environment

A cinematic, fully client-side toolbox of **19 IT & productivity utilities** wrapped in an Iron-Man-style holographic HUD. Everything runs in the browser — no server, no build step, no bundler. Open `index.html` and go.

> **v2.1** · Vanilla HTML5 / CSS3 / ES6+ · Tailwind (Play CDN, with a hand-written style-core fallback) · zero backend.

---

## Launch

Open **`index.html`** directly in any modern browser (Chrome, Edge, Firefox). No install, no local server required — though serving the folder over `http://` (e.g. `python -m http.server`) also works and avoids any browser `file://` restrictions.

Each tool is a self-contained `index.html` inside its own folder and can be opened on its own.

---

## The Command Deck (`index.html`)

The hub is a 3D orbital interface where the 19 tools orbit a central **NEXUS** core as planets:

- **3-layer parallax background** — a drifting diagnostic grid, a cursor-reactive node lattice with click shockwaves, and cascading foreground telemetry (binary rain, graphs, a radar sweep).
- **NEXUS core** — concentric vector rings on independent axes, a cursor-tracking lens, and the browser's Web Speech API for spoken responses with live frequency bars. Click the core for a random diagnostic quip. A **VOX picker** in the command bar lets you choose which installed system voice NEXUS speaks with (pitched low by default).
- **Voice commands** — click **LISTEN** (or the mic button on phones) and speak naturally: *"open the subnet toolkit"*, *"passwords"*, *"switch to the general galaxy"*, *"search cisco"*, *"status report"*. An on-device fuzzy intent engine tolerates transcription slop and deduces the closest module; nothing you say leaves the browser except the browser's own speech-to-text. Requires Chrome/Edge + mic permission.
- **True-3D orbital mechanics** — cards scale, dim, blur, and re-layer with `sin`/`cos`; hovering one pauses the orbit and opens a glassmorphic live-metrics preview.
- **Galaxy switch** — a space-warp transition between the **IT Galaxy** (cyan) and **General Galaxy** (hyper-glow orange).
- **Search engine** — live keyword/tag filtering over a module registry; `Enter` triggers the warp + spoken hand-off + redirect. Unresolved queries shake the field with a `QUERY UNRESOLVED IN MAIN DATA BANKS` warning.
- **Diagnostic terminal** — a hidden drawer (button or `Ctrl+`` ` `) that intercepts `window.onerror`, promise rejections, and `console` output into a live system log. Present on every page.

---

## Tools

### IT Galaxy (12)

| Code | Tool | What it does |
|------|------|--------------|
| NET-01 | **Subnet Toolkit** | CIDR calculator (network/broadcast/host range/wildcard, binary lattice) that auto-forges a matching Cisco IOS interface config. |
| NET-02 | **Network Discovery** | Fetches public WAN/ISP/ASN data client-side and runs proxy/VPN signature heuristics with a pulsing tunnel-detected badge, plus local client intel. |
| HW-03 | **Hardware Reference** | Interactive SVG motherboard schematic that disambiguates the three classic "is-it-broken?" parts (bare solder pads, VRM inductors, grounding screw rings), plus POST beep-code matrices and T568A/B wiring. |
| SEC-04 | **Crypto Forge** | High-entropy passwords, API tokens (hex/Base64/UUID), and real SSH keypairs via WebCrypto (Ed25519 → ECDSA P-256 fallback). Nothing is transmitted. |
| OPS-05 | **Deskside & AD Builder** | Generates production PowerShell for AD account recovery and SCCM client policy trigger cycles. |
| NET-06 | **Cisco Configurator** | Variable-driven IOS config synthesis for OSPF, AAA (TACACS+/RADIUS), and route-based IPsec VTI tunnels. |
| LOG-07 | **Syslog Analyzer** | Parses pasted logs into a searchable, severity-colour-coded grid (Cisco/ASA + keyword classification). |
| NET-08 | **MAC OUI Lookup** | Sanitizes any MAC format to its OUI, resolves the vendor from a local cache with a live registry fallback, and decodes the U/L and I/G bits. |
| AST-09 | **Asset & Warranty Router** | RegEx-detects Dell/Lenovo/HP/Apple/Cisco/Surface serials (incl. Dell tag↔express base-36) and deep-links to the right warranty terminal. |
| PWR-10 | **PoE Power Budget** | Drop device profiles against a switch budget; live utilization gauge, stacked composition chart, and breach alarms. |
| LOG-11 | **CMTrace Reader** | Drag-and-drop SCCM/MECM `.log` parsing into a CMTrace-style grid with severity highlighting and jump-to-error. |
| UTL-12 | **Unit & Time Converter** | Digital-storage conversions (decimal & binary) alongside a DST-aware global datacenter time-zone board. |

### General Galaxy (7)

| Code | Tool | What it does |
|------|------|--------------|
| GEN-13 | **Vibe & Focus** | Pomodoro timer, generated Web-Audio ambience (white/pink/brown noise, rain, wind, reactor hum), and a persistent Markdown notes canvas. |
| GEN-14 | **Resume Editor** | Split-pane Markdown → clean resume with plain-language entry-level IT blueprints and one-click print-to-PDF. |
| GEN-15 | **Image Compressor** | In-browser `<canvas>` pipeline crushing JPG/PNG to WebP with quality/dimension controls — files never leave the machine. |
| GEN-16 | **Audio Conversion Bay** | Local audio/video decode → trim → gain → re-export (WAV / WebM-Opus). *(Deliberately does not rip from YouTube/streaming — see note below.)* |
| GEN-17 | **Market Tracker** | Live crypto cards with 7-day sparklines via the CoinGecko public API, a persistent watchlist, and deep-linked semiconductor/tech equities. |
| GEN-18 | **Tactical Game Tracker** | Per-profile mod ledger, graphics-config log, FPS benchmark charts (avg vs 1% low), and a saved link matrix — all local. |
| GEN-19 | **Finance Flow** | 100% private subscription ledger — burn-rate metrics, category donut, 12-month projection, and renewal radar, stored only in `localStorage`. |

---

## Design & architecture

- **Self-contained** — every module resolves inside a single `index.html` per folder. No frameworks, no bundlers, no server.
- **Resilient** — remote calls (market/geo/OUI feeds, the Tailwind CDN) are wrapped in `try/catch` with graceful inline fallbacks; a failure surfaces a status message instead of breaking the UI.
- **Isolated** — all logic lives inside per-page `DOMContentLoaded` initializers to prevent cross-tool collisions.
- **Accessible data-viz** — charts use a colourblind-safe categorical palette validated for the dark surface (OKLCH lightness band, adjacent-pair CVD separation, contrast), with direct labels and legends rather than colour alone.

## A note on the Audio Bay

The Audio Conversion Bay (GEN-16) intentionally **does not** rip audio from YouTube or other streaming URLs. Doing so violates those platforms' Terms of Service and typically the source's copyright, and the public "conversion endpoints" that offer it are unreliable and frequently malicious. For media you own, the tool fully supports local decode/trim/gain/re-export; for pulling an audio track from your own video files the clean route is `yt-dlp` or `ffmpeg` on your own machine.

## Privacy

There is no backend and no analytics. Passwords, keys, notes, ledgers, images, and audio are processed entirely in your browser. The only outbound requests are the optional public data feeds noted per tool (WAN geo-IP, MAC OUI registry, CoinGecko) and the Tailwind CDN.

---

*Generated with [Claude Code](https://claude.com/claude-code).*
