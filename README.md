# Avengers Command

A S.H.I.E.L.D.-style crisis console: assemble a team of Avengers, deploy them to threats on a live 3D globe, and fight it out in turn-based battles. Every move is saved to a SQLite database.

Built by **Team Breakpoints**: Devika Menon and Gopalkrishna J S.

## Features

- **3D threat globe** with clickable mission beacons and Iron Man on patrol
- **17 heroes** across six roles, including five Avengers: Doomsday recruits
- **Turn-based battles** with combo finishers (attack, then special the next round)
- **7 missions** that escalate from LOW to OMEGA if left waiting; Doctor Doom unlocks last
- **SQLite database** with a live Data Vault and read-only SQL console
- **Director Fury commentary**, with an optional voice

## Run it

Requires Node 22.5 or newer.

```bash
cd shield
npm install
npm run dev
```

Then open the local address it prints (usually http://localhost:5173).

## Tech

React 19, TypeScript, Vite, Tailwind CSS, three.js, GSAP, Zustand and SQLite.

Full details (module map, database tables and API) are in [shield/README.md](shield/README.md).

---

Fan-made hackathon project. Marvel, the Avengers and all characters are trademarks of Marvel.
