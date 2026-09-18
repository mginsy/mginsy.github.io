# We Got the Runs — Lineup Generator

An offline-capable softball lineup planner for iPhone, built as a React + Vite PWA and ready for GitHub Pages.

## Run locally

```bash
npm install
npm start
```

`npm` is the package manager and command runner. Vite is the build tool invoked behind the npm scripts; visitors never interact with Vite.

For iPhone emulation in desktop DevTools, use the normal `http://localhost:5173` URL and select an iPhone preset in the device toolbar. The service worker is disabled and old Dugout caches are removed in development so cached production files cannot interfere when switching device modes.

For a physical iPhone, connect the Mac and iPhone to the same Wi-Fi network and open the **Network** URL printed by `npm start` instead of `localhost`.

## Google Sheets setup

Dugout reads a public Google Sheet directly from the browser. No Google Cloud project, OAuth client, API key, or service account is required.

The app is preconfigured for spreadsheet `1LLm4LPiC9C5_SInYt5pqw7YPfDD8cKLYDvMWpUyOZ4A`, sheet GID `0`.

It reads the existing columns directly: `Name`, each individual position column containing `Yes` or `No`, `Batting Strength`, `Fielding Strength`, `Gender`, and `Here`.

Share the sheet as **Anyone with the link → Viewer**. The app loads it anonymously at startup and keeps the most recent roster locally for offline use. The header’s **Refresh data** button immediately pulls this same fixed sheet; there is no spreadsheet configuration popup.

The `Here` column is read at startup and on refresh. When a Google editor account is connected, changing a roster toggle immediately writes `TRUE` or `FALSE` back to that player's cell in column O.

The second worksheet stores the active game as a JSON record in cell A1, including the fielding plan, batting order, and current inning. Generation requires a connected Google account. Ending the game clears the second worksheet. The short-lived Google access token is kept in session storage so an ordinary page refresh stays connected until the token expires; closing the browser or waiting for expiration requires reconnecting.

Field time remains nearly equal, with fielding strength used as a weighted tiebreaker so stronger defenders tend to sit later and receive the extra inning when the total cannot divide evenly. Batting order alternates gender whenever mathematically possible and weights stronger hitters toward the top, with controlled randomness between generated games.

League rules are fixed in the app: every generated game has exactly 7 innings, 10 fielders, and at least 4 women on the field. There is no configurable game-setup screen.

Never put a service-account JSON key in a frontend or GitHub repository. Its private key would be visible to every visitor. A service account is appropriate only behind a server-side endpoint. It provides no benefit for a publicly readable sheet.

## Deploy to GitHub Pages

Build with `npm run build` and publish the `dist/` directory. This user-site repository is configured to run from `/`; project-site deployments should set Vite's `base` option.

The interface is designed mobile-first for iPhone, including safe-area padding, 44px touch targets, a fixed thumb-friendly navigation bar, 16px form controls to prevent Safari zoom, and standalone PWA metadata.
