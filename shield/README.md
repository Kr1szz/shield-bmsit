# Avengers Command — S.H.I.E.L.D. Crisis Management System

Hackathon build. React 19 + TypeScript + Vite, Tailwind v4, GSAP, Three.js (react-three-fiber), Zustand (state persisted to localStorage), SQLite (`node:sqlite`) for mission records.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle
```

Design rules live in [DESIGN.md](DESIGN.md).

## Where each required module lives

| Module | Section | File |
|---|---|---|
| Command dashboard | 01 Command | `src/sections/Dashboard.tsx` |
| Avengers database | 02 Database (+ personnel file modal) | `src/sections/Database.tsx`, `src/components/Dossier.tsx` |
| Team formation (min 4) | 03 Assemble | `src/sections/TeamFormation.tsx` |
| Mission control (7 missions, LOW to OMEGA; Doctor Doom unlocks after 3) | 04 Missions | `src/sections/MissionControl.tsx` |
| Hero allocation | 04 Missions → Deploy team / Recall | same, logic in `src/store/useShieldStore.ts` |
| Battle simulation | 05 Battle (turn-based, auto-battle) | `src/sections/BattleSim.tsx` |
| Mission status (Pending / In Progress / Completed) | 06 Status (drag or arrows) | `src/sections/MissionStatus.tsx` |
| SQLite database (live tables + SQL console) | 07 Data vault | `src/sections/DataVault.tsx`, `server/db.ts`, `server/api.ts` |

The 3D threat globe behind the page (`src/components/ThreatGlobe.tsx`) shows each mission as a red beacon; click one to open that mission.

Use the reset icon in the top bar to clear saved state (this also clears the play history in the database).

## SQLite database

`npm run dev` also starts a small API inside the Vite server, backed by a real SQLite 3 database at `data/shield.db` (created and seeded automatically on first run). It uses Node's built-in `node:sqlite` driver, so there is nothing extra to install — Node 22.5+ is required (Node prints an "experimental" notice for it; that's expected).

| Table / view | What's in it |
|---|---|
| `heroes`, `abilities`, `combos` | The 17-hero roster, their Q/W/E abilities and combo finishers |
| `villains`, `missions` | Villains and the 7 missions, with live `status` and `current_threat` |
| `deployments` | Every hero sent to a mission, with deploy / recall timestamps |
| `battles`, `battle_damage` | Each battle's outcome and rounds, and damage dealt per hero |
| `mission_events` | Status changes, threat escalations, deployments and recalls |
| `activity_log` | Every comms message shown in the app |
| `hero_leaderboard`, `active_deployments` | Views joining the above |

Section **07 Data vault** shows the tables updating live as you play, each table's schema, and a read-only SQL console (queries run on a read-only connection, so they can't change data). You can also open the file directly:

```bash
sqlite3 data/shield.db "SELECT * FROM hero_leaderboard;"
```

API: `GET /api/db`, `GET /api/db/:table`, `POST /api/db/query {sql}`, `POST /api/events`.

Fan project: Marvel, the Avengers and all characters are trademarks of Marvel. Logos come from Wikimedia Commons; character art from the Marvel Database (Fandom), resized and self-hosted in `public/art`.
