import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import googleIcon from './google.png';
import loaderGif from './loader.gif';
import './styles.css';

const ALL_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'RCF', 'RF'] as const;
type RosterPosition = typeof ALL_POSITIONS[number];
type Position = RosterPosition | 'CF';
type Gender = 'Woman' | 'Man' | 'Other';
type Player = { id: string; name: string; gender: Gender; positions: RosterPosition[]; primaryPosition?: RosterPosition; battingStrength: number; fieldingStrength: number; available: boolean; lateArrivalInning?: number; earlyDepartureInning?: number; sheetRow?: number };
type InningPlan = { inning: number; assignments: Record<string, string>; bench: string[] };
type SheetsConfig = { spreadsheet: string; gid: string };
type AppTab = 'game' | 'roster';
type Change = { id: string; action: 'IN' | 'OUT'; pos?: string };
type StoredGame = { version: 1; plan: InningPlan[]; battingOrder: string[]; inning: number; updatedAt: string };

const GAME_RULES = Object.freeze({ innings: 7, fielders: 10, minWomen: 4 });
const LOADING_MESSAGES = [
  'Loading lineup',
  'We got the runsing',
  'Shitting',
  'Running around the bases',
  'Swinging and possibly missing',
  'Softballing',
  'Max iz da goat',
  'Hitting dingers',
  'Popping tha fuck off'
] as const;
const FIELD_ANIMATION_ORDER: Position[] = ['LF', 'LCF', 'CF', 'RCF', 'RF', 'SS', '2B', 'P', '3B', '1B', 'C'];

const PLAYER_SEEDS: Array<[string, Gender, RosterPosition[], number, number]> = [
  ['Maya', 'Woman', ['P', '2B'], 7, 8], ['Alex', 'Man', ['C', '1B'], 6, 6], ['Jamie', 'Woman', ['SS', '3B'], 8, 8],
  ['Sam', 'Man', ['LF', 'LCF', 'RCF'], 7, 7], ['Taylor', 'Woman', ['1B', 'RF'], 6, 6], ['Morgan', 'Man', ['2B', 'SS'], 8, 7],
  ['Riley', 'Woman', ['C', 'RF'], 5, 6], ['Jordan', 'Man', ['3B', 'LF'], 7, 7], ['Casey', 'Woman', ['LCF', 'RCF'], 6, 7],
  ['Drew', 'Man', ['P', '1B'], 8, 8], ['Avery', 'Woman', ['LF', 'RF'], 5, 5], ['Quinn', 'Man', ['RCF', 'RF'], 6, 6]
];
const DEFAULT_PLAYERS: Player[] = PLAYER_SEEDS.map((p, i) => ({ id: `p${i}`, name: p[0], gender: p[1], positions: p[2], primaryPosition: p[2][0], battingStrength: p[3], fieldingStrength: p[4], available: true }));

const DEFAULT_SHEET = 'https://docs.google.com/spreadsheets/d/1LLm4LPiC9C5_SInYt5pqw7YPfDD8cKLYDvMWpUyOZ4A/edit?gid=0#gid=0';
const SHEET_CONFIG: SheetsConfig = Object.freeze({ spreadsheet: DEFAULT_SHEET, gid: '0' });
const GAME_SHEET_GID = '1464823862';
const GOOGLE_CLIENT_ID = '146985538868-deqlmntf9fpeaqfuk2fmdk3k32d2paq8.apps.googleusercontent.com';
const POSITION_COLUMNS: Record<string, RosterPosition> = {
  pitcher: 'P', catcher: 'C', '1st base': '1B', '2nd base': '2B', '3rd base': '3B', shortstop: 'SS',
  'left field': 'LF', 'left center field': 'LCF', 'right center field': 'RCF', 'right field': 'RF'
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const genderLabel = (gender: Gender) => gender === 'Woman' ? 'W' : gender === 'Man' ? 'M' : 'O';
const randomLoadingMessage = () => LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];

function spreadsheetIdFrom(value: string): string {
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || value.trim();
}

function normalizePlayers(value: Player[]): Player[] {
  return value.map(player => {
    const positions = (player.positions as string[]).map(position => position === 'LC' ? 'LCF' : position === 'RC' ? 'RCF' : position) as RosterPosition[];
    const primaryValue = String(player.primaryPosition ?? '');
    const rawPrimary = (primaryValue === 'LC' ? 'LCF' : primaryValue === 'RC' ? 'RCF' : primaryValue) as RosterPosition;
    return {
      ...player,
      battingStrength: Number(player.battingStrength) || 5,
      fieldingStrength: Number(player.fieldingStrength) || 5,
      positions,
      primaryPosition: rawPrimary && positions.includes(rawPrimary) ? rawPrimary : positions[0],
      lateArrivalInning: normalizeInning(player.lateArrivalInning),
      earlyDepartureInning: normalizeInning(player.earlyDepartureInning)
    };
  });
}

function normalizeInning(value: unknown): number | undefined {
  const inning = Number(value);
  return Number.isInteger(inning) && inning >= 1 && inning <= GAME_RULES.innings ? inning : undefined;
}

function playerSchedule(player: Player): string {
  const details: string[] = [];
  if (player.lateArrivalInning && player.lateArrivalInning > 1) details.push(`Arrives inning ${player.lateArrivalInning}`);
  if (player.earlyDepartureInning && player.earlyDepartureInning < GAME_RULES.innings) details.push(`Last inning ${player.earlyDepartureInning}`);
  return details.join(' · ');
}

function copyPlayer(player: Player): Player {
  return { ...player, positions: [...player.positions] };
}

function playersMatch(left: Player, right: Player): boolean {
  return left.id === right.id
    && left.name === right.name
    && left.gender === right.gender
    && left.positions.join('|') === right.positions.join('|')
    && left.primaryPosition === right.primaryPosition
    && left.available === right.available
    && left.lateArrivalInning === right.lateArrivalInning
    && left.earlyDepartureInning === right.earlyDepartureInning;
}

function buildBadgeLabels(players: Player[]): Record<string, string> {
  return Object.fromEntries(players.map(player => {
    const name = player.name.trim();
    const lowerName = name.toLowerCase();
    let length = 1;
    while (length < name.length && players.some(other => other.id !== player.id && other.name.trim().toLowerCase().startsWith(lowerName.slice(0, length)))) length++;
    let label = name.slice(0, length);
    if (players.some(other => other.id !== player.id && other.name.trim().toLowerCase().startsWith(label.toLowerCase()))) {
      const matches = players.filter(other => other.name.trim().toLowerCase() === lowerName);
      if (matches.length > 1) label += String(matches.findIndex(other => other.id === player.id) + 1);
    }
    return [player.id, label];
  }));
}

let chartsPromise: Promise<void> | null = null;
let identityPromise: Promise<void> | null = null;
const SESSION_TOKEN_KEY = 'wgtr.googleToken';
const restoredToken = (() => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_TOKEN_KEY) || 'null') as { token: string; expiresAt: number } | null;
    return saved && saved.expiresAt > Date.now() ? saved : { token: '', expiresAt: 0 };
  } catch { return { token: '', expiresAt: 0 }; }
})();
let sheetsToken = restoredToken.token;
let sheetsTokenExpiresAt = restoredToken.expiresAt;
let cachedSheetTitles: { roster: string; game: string } | null = null;
function loadGoogleCharts(): Promise<void> {
  if (window.google?.visualization) return Promise.resolve();
  if (chartsPromise) return chartsPromise;
  chartsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-charts]');
    const script = existing || document.createElement('script');
    script.dataset.googleCharts = 'true';
    script.src = 'https://www.gstatic.com/charts/loader.js';
    script.onload = () => {
      window.google.charts.load('current');
      window.google.charts.setOnLoadCallback(resolve);
    };
    script.onerror = () => reject(new Error('Could not load Google Sheets. Check your connection.'));
    if (!existing) document.head.appendChild(script);
  });
  return chartsPromise;
}

async function queryPublicSheet(spreadsheetId: string, gid: string): Promise<string[][]> {
  await loadGoogleCharts();
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?headers=1&gid=${encodeURIComponent(gid || '0')}`;
  return new Promise((resolve, reject) => {
    const query = new window.google.visualization.Query(url);
    query.send((response: any) => {
      if (response.isError()) return reject(new Error(response.getMessage() || 'Google could not read the public sheet.'));
      const data = response.getDataTable();
      const headers = Array.from({ length: data.getNumberOfColumns() }, (_, column) => String(data.getColumnLabel(column) || ''));
      const rows = Array.from({ length: data.getNumberOfRows() }, (_, row) => headers.map((_, column) => String(data.getValue(row, column) ?? '')));
      resolve([headers, ...rows]);
    });
  });
}

async function queryPublicCell(spreadsheetId: string, gid: string, range: string): Promise<string> {
  await loadGoogleCharts();
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?headers=0&gid=${encodeURIComponent(gid)}&range=${encodeURIComponent(range)}`;
  return new Promise((resolve, reject) => {
    const query = new window.google.visualization.Query(url);
    query.send((response: any) => {
      if (response.isError()) return reject(new Error(response.getMessage() || 'Google could not read the public lineup.'));
      const data = response.getDataTable();
      resolve(data.getNumberOfRows() ? String(data.getValue(0, 0) ?? '') : '');
    });
  });
}

function parseStoredGame(raw: string): StoredGame | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as StoredGame;
  if (parsed.version !== 1 || !Array.isArray(parsed.plan) || !Array.isArray(parsed.battingOrder)) throw new Error('The active-game worksheet contains invalid data.');
  return parsed;
}

async function readPublicGameFromSheet(): Promise<StoredGame | null> {
  const spreadsheetId = spreadsheetIdFrom(SHEET_CONFIG.spreadsheet);
  const raw = await queryPublicCell(spreadsheetId, GAME_SHEET_GID, 'A1');
  return parseStoredGame(raw);
}

function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (identityPromise) return identityPromise;
  identityPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google authorization. Check your connection.'));
    document.head.appendChild(script);
  });
  return identityPromise;
}

async function requestSheetsToken(): Promise<string> {
  if (sheetsToken && Date.now() < sheetsTokenExpiresAt) return sheetsToken;
  await loadGoogleIdentity();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      callback: (response: any) => {
        if (response.error || !response.access_token) return reject(new Error(response.error_description || response.error || 'Google authorization was not completed.'));
        sheetsToken = response.access_token;
        sheetsTokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000 - 60_000;
        try { sessionStorage.setItem(SESSION_TOKEN_KEY, JSON.stringify({ token: sheetsToken, expiresAt: sheetsTokenExpiresAt })); } catch { /* Continue with the in-memory token. */ }
        resolve(sheetsToken);
      },
      error_callback: () => reject(new Error('Google authorization was closed or blocked.'))
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function getSheetTitles(token: string): Promise<{ roster: string; game: string }> {
  if (cachedSheetTitles) return cachedSheetTitles;
  const spreadsheetId = spreadsheetIdFrom(SHEET_CONFIG.spreadsheet);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('Google could not open the spreadsheet. Enable the Sheets API and confirm this account has edit access.');
  const metadata = await response.json();
  const rosterSheet = metadata.sheets?.find((entry: any) => String(entry.properties?.sheetId) === SHEET_CONFIG.gid);
  const gameSheet = metadata.sheets?.find((entry: any) => String(entry.properties?.sheetId) !== SHEET_CONFIG.gid);
  if (!rosterSheet) throw new Error('Google could not find the roster sheet.');
  if (!gameSheet) throw new Error('Add a second worksheet for active-game data.');
  cachedSheetTitles = {
    roster: String(rosterSheet.properties.title).replace(/'/g, "''"),
    game: String(gameSheet.properties.title).replace(/'/g, "''")
  };
  return cachedSheetTitles;
}

async function savePlayerToSheet(player: Player): Promise<void> {
  const token = await requestSheetsToken();
  const spreadsheetId = spreadsheetIdFrom(SHEET_CONFIG.spreadsheet);
  const { roster: title } = await getSheetTitles(token);
  const values = [[
    player.name,
    ...ALL_POSITIONS.map(position => player.positions.includes(position) ? 'Yes' : 'No'),
    player.primaryPosition ?? '',
    player.battingStrength,
    player.fieldingStrength,
    player.gender === 'Woman' ? 'Female' : player.gender === 'Man' ? 'Male' : 'Other',
    player.available,
    player.lateArrivalInning ?? '',
    player.earlyDepartureInning ?? ''
  ]];
  const range = player.sheetRow ? `'${title}'!A${player.sheetRow}:R${player.sheetRow}` : `'${title}'!A:R`;
  const endpoint = player.sheetRow
    ? `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`
    : `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const response = await fetch(endpoint, {
    method: player.sheetRow ? 'PUT' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  if (!response.ok) throw new Error('Google could not save this player. Confirm you signed in with an editor account.');
}

async function saveAttendanceToSheet(player: Player, available: boolean): Promise<void> {
  if (!player.sheetRow) return;
  const token = await requestSheetsToken();
  const spreadsheetId = spreadsheetIdFrom(SHEET_CONFIG.spreadsheet);
  const { roster: title } = await getSheetTitles(token);
  const range = `'${title}'!P${player.sheetRow}`;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[available]] })
  });
  if (!response.ok) throw new Error(`Could not update ${player.name}'s attendance in Google Sheets.`);
}

async function persistGameToSheet(plan: InningPlan[], battingOrder: string[], inning: number): Promise<void> {
  const token = await requestSheetsToken();
  const spreadsheetId = spreadsheetIdFrom(SHEET_CONFIG.spreadsheet);
  const { game: title } = await getSheetTitles(token);
  const range = `'${title}'!A1`;
  const state: StoredGame = { version: 1, plan, battingOrder, inning, updatedAt: new Date().toISOString() };
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[JSON.stringify(state)]] })
  });
  if (!response.ok) throw new Error('Could not save the active game to Google Sheets.');
}

async function readGameFromSheet(): Promise<StoredGame | null> {
  const token = await requestSheetsToken();
  const spreadsheetId = spreadsheetIdFrom(SHEET_CONFIG.spreadsheet);
  const { game: title } = await getSheetTitles(token);
  const range = `'${title}'!A1`;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('Could not load the active game from Google Sheets.');
  const data = await response.json();
  const raw = data.values?.[0]?.[0];
  return parseStoredGame(String(raw ?? ''));
}

async function clearGameSheet(): Promise<void> {
  const token = await requestSheetsToken();
  const spreadsheetId = spreadsheetIdFrom(SHEET_CONFIG.spreadsheet);
  const { game: title } = await getSheetTitles(token);
  const range = `'${title}'!A:ZZZ`;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!response.ok) throw new Error('Could not clear the active-game worksheet.');
}

const TEN_PLAYER_POSITIONS: Position[] = [...ALL_POSITIONS];
const NINE_PLAYER_POSITIONS: Position[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

function canPlay(player: Player, position: Position): boolean {
  return position === 'CF'
    ? player.positions.includes('LCF') || player.positions.includes('RCF')
    : player.positions.includes(position);
}

function preferenceRank(player: Player, position: Position): number {
  if (position !== 'CF') return player.positions.indexOf(position);
  const centerRanks = ['LCF', 'RCF'].map(pos => player.positions.indexOf(pos as RosterPosition)).filter(rank => rank >= 0);
  return centerRanks.length ? Math.min(...centerRanks) : player.positions.length;
}

function isPrimaryPosition(player: Player, position: Position): boolean {
  return position === 'CF'
    ? player.primaryPosition === 'LCF' || player.primaryPosition === 'RCF'
    : player.primaryPosition === position;
}

function scoreCandidate(player: Player, position: Position, counts: Record<string, number>, lastAssignment: Record<string, string>, jitter: Record<string, number>): number {
  const played = counts[player.id] || 0;
  let score = played * 100;
  score -= player.fieldingStrength * 5;
  if (lastAssignment[player.id] === position) score -= 12;
  if (lastAssignment[player.id] && lastAssignment[player.id] !== 'BENCH') score += 3;
  score += preferenceRank(player, position) * 2;
  score += jitter[`${player.id}:${position}`] || 0;
  return score;
}

function generateLineup(players: Player[], preservedPlan: InningPlan[] = []): InningPlan[] {
  const available = players.filter(p => p.available);
  const counts = Object.fromEntries(available.map(p => [p.id, 0]));
  const lastAssignment: Record<string, string> = {};
  const plan: InningPlan[] = [...preservedPlan];

  for (const preserved of preservedPlan) {
    for (const id of Object.values(preserved.assignments)) {
      if (id in counts) counts[id]++;
    }
  }
  const lastPreserved = preservedPlan[preservedPlan.length - 1];
  if (lastPreserved) {
    for (const player of available) {
      const position = Object.keys(lastPreserved.assignments).find(pos => lastPreserved.assignments[pos] === player.id);
      if (position) lastAssignment[player.id] = position;
      else if (lastPreserved.bench.includes(player.id)) lastAssignment[player.id] = 'BENCH';
    }
  }

  for (let inning = preservedPlan.length + 1; inning <= GAME_RULES.innings; inning++) {
    const eligible = available.filter(player => (player.lateArrivalInning ?? 1) <= inning && (player.earlyDepartureInning ?? GAME_RULES.innings) >= inning);
    if (eligible.length < NINE_PLAYER_POSITIONS.length) throw new Error(`Inning ${inning} only has ${eligible.length} eligible players. At least 9 are required.`);
    const positions = eligible.length === NINE_PLAYER_POSITIONS.length ? NINE_PLAYER_POSITIONS : TEN_PLAYER_POSITIONS;
    const eligibleWomen = eligible.filter(player => player.gender === 'Woman').length;
    if (eligibleWomen < GAME_RULES.minWomen) throw new Error(`Inning ${inning} needs 4 eligible women, but only ${eligibleWomen} are available.`);
    const assigned: Record<string, string> = {};
    const used = new Set<string>();
    const jitter = Object.fromEntries(eligible.flatMap(player => positions.map(position => {
      const positionWeight = isPrimaryPosition(player, position) ? 3 : 1;
      const weightedRandom = -Math.log(Math.max(Math.random(), Number.EPSILON)) * 8 / positionWeight;
      return [`${player.id}:${position}`, weightedRandom];
    })));
    const orderedPositions = [...positions].sort((a, b) => {
      const ac = eligible.filter(p => canPlay(p, a)).length;
      const bc = eligible.filter(p => canPlay(p, b)).length;
      return ac - bc;
    });

    function search(index: number): boolean {
      if (index === orderedPositions.length) {
        const field = Object.values(assigned);
        const women = field.filter(id => eligible.find(p => p.id === id)?.gender === 'Woman').length;
        return women >= GAME_RULES.minWomen;
      }
      const pos = orderedPositions[index];
      const candidates = eligible
        .filter(p => !used.has(p.id) && canPlay(p, pos))
        .sort((a, b) => scoreCandidate(a, pos, counts, lastAssignment, jitter) - scoreCandidate(b, pos, counts, lastAssignment, jitter));
      for (const player of candidates) {
        assigned[pos] = player.id; used.add(player.id);
        if (search(index + 1)) return true;
        used.delete(player.id); delete assigned[pos];
      }
      return false;
    }

    if (!search(0)) throw new Error(`No legal lineup fits inning ${inning}. Add position flexibility or adjust attendance.`);
    Object.values(assigned).forEach(id => counts[id]++);
    eligible.forEach(p => { lastAssignment[p.id] = used.has(p.id) ? (Object.keys(assigned).find(pos => assigned[pos] === p.id) ?? 'BENCH') : 'BENCH'; });
    const bench = eligible.filter(p => !used.has(p.id)).map(p => p.id);
    plan.push({ inning, assignments: assigned, bench });
  }
  return plan;
}

function generateBattingOrder(players: Player[]): string[] {
  const available = players.filter(player => player.available);
  const rank = (player: Player) => player.battingStrength * 10 + Math.random() * 18;
  const women = available.filter(player => player.gender === 'Woman').map(player => ({ player, score: rank(player) })).sort((a, b) => b.score - a.score);
  const men = available.filter(player => player.gender === 'Man').map(player => ({ player, score: rank(player) })).sort((a, b) => b.score - a.score);
  const other = available.filter(player => player.gender === 'Other').map(player => ({ player, score: rank(player) })).sort((a, b) => b.score - a.score);
  let next: 'Woman' | 'Man' = women.length > men.length || (women.length === men.length && (women[0]?.score || 0) > (men[0]?.score || 0)) ? 'Woman' : 'Man';
  const order: string[] = [];
  while (women.length || men.length) {
    const preferred = next === 'Woman' ? women : men;
    const alternate = next === 'Woman' ? men : women;
    const pick = (preferred.length ? preferred : alternate).shift();
    if (pick) order.push(pick.player.id);
    next = next === 'Woman' ? 'Man' : 'Woman';
  }
  for (const entry of other) {
    const insertion = order.findIndex((id, index) => index > 0 && players.find(player => player.id === id)?.gender === players.find(player => player.id === order[index - 1])?.gender);
    order.splice(insertion < 0 ? order.length : insertion, 0, entry.player.id);
  }
  return order;
}

function App() {
  const [players, setPlayers] = useState<Player[]>(() => normalizePlayers(JSON.parse(localStorage.getItem('dugout.players') || 'null') || DEFAULT_PLAYERS));
  const [plan, setPlan] = useState<InningPlan[]>([]);
  const [battingOrder, setBattingOrder] = useState<string[]>([]);
  const [inning, setInning] = useState(0);
  const [tab, setTab] = useState<AppTab>('game');
  const [gameView, setGameView] = useState<'field' | 'batting'>('field');
  const [notice, setNotice] = useState('');
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState(() => randomLoadingMessage());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(() => Boolean(sheetsToken && sheetsTokenExpiresAt > Date.now()));
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegeneratingFielding, setIsRegeneratingFielding] = useState(false);
  const [isEndingGame, setIsEndingGame] = useState(false);
  const [attendanceWrites, setAttendanceWrites] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<Player | null>(null);
  const [editingOriginal, setEditingOriginal] = useState<Player | null>(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [selectedFieldPlayer, setSelectedFieldPlayer] = useState<string | null>(null);
  const [isSavingManualField, setIsSavingManualField] = useState(false);
  const [draggingBatter, setDraggingBatter] = useState<string | null>(null);
  const battingDragRef = useRef<{ id: string; original: string[] } | null>(null);
  const battingOrderRef = useRef<string[]>(battingOrder);

  useEffect(() => localStorage.setItem('dugout.players', JSON.stringify(players)), [players]);
  useEffect(() => { battingOrderRef.current = battingOrder; }, [battingOrder]);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (import.meta.env.PROD) {
      void navigator.serviceWorker.register('/sw.js');
      return;
    }
    void navigator.serviceWorker.getRegistrations().then(registrations => registrations.forEach(registration => void registration.unregister()));
    if ('caches' in window) void caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('dugout-')).map(key => caches.delete(key))));
  }, []);
  useEffect(() => {
    void refreshPublicData(true);
  }, []);
  useEffect(() => { void loadGoogleIdentity(); }, []);

  const current = plan[inning];
  const byId = useMemo<Record<string, Player>>(() => Object.fromEntries(players.map(p => [p.id, p])), [players]);
  const badgeLabels = useMemo(() => buildBadgeLabels(players), [players]);
  const hasPlayerChanges = Boolean(editing && editingOriginal && !playersMatch(editing, editingOriginal));
  const previous = plan[inning - 1];
  const changes: Change[] = current && previous ? [
    ...Object.values(previous.assignments).filter(id => !Object.values(current.assignments).includes(id)).map(id => ({ id, action: 'OUT' as const })),
    ...Object.values(current.assignments).filter(id => !Object.values(previous.assignments).includes(id)).map(id => ({ id, action: 'IN' as const, pos: Object.keys(current.assignments).find(p => current.assignments[p] === id) }))
  ] : [];

  async function regenerate(): Promise<void> {
    if (!isAuthorized) return;
    setIsGenerating(true);
    try {
      const next = generateLineup(players);
      const nextBattingOrder = generateBattingOrder(players);
      await persistGameToSheet(next, nextBattingOrder, 0);
      setPlan(next); setBattingOrder(nextBattingOrder); setInning(0); setGameView('field'); setTab('game');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not generate the lineup.');
    } finally {
      setIsGenerating(false);
    }
  }

  async function regenerateRemainingFielding(): Promise<void> {
    if (!isAuthorized || !plan.length) return;
    setIsRegeneratingFielding(true);
    try {
      const preservedPlan = plan.slice(0, inning);
      const nextPlan = generateLineup(players, preservedPlan);
      const activeIds = new Set(players.filter(player => player.available).map(player => player.id));
      const nextBattingOrder = battingOrder.filter(id => activeIds.has(id));
      await persistGameToSheet(nextPlan, nextBattingOrder, inning);
      setPlan(nextPlan);
      setBattingOrder(nextBattingOrder);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not regenerate the remaining fielding lineup.');
    } finally {
      setIsRegeneratingFielding(false);
    }
  }

  async function selectFieldPlayer(playerId: string): Promise<void> {
    if (!isAuthorized || isSavingManualField || !current) return;
    if (!selectedFieldPlayer) {
      setSelectedFieldPlayer(playerId);
      return;
    }
    if (selectedFieldPlayer === playerId) {
      setSelectedFieldPlayer(null);
      return;
    }

    const assignments = { ...current.assignments };
    const bench = [...current.bench];
    const firstPosition = Object.keys(assignments).find(position => assignments[position] === selectedFieldPlayer);
    const secondPosition = Object.keys(assignments).find(position => assignments[position] === playerId);
    const firstBenchIndex = bench.indexOf(selectedFieldPlayer);
    const secondBenchIndex = bench.indexOf(playerId);

    if (firstPosition && secondPosition) {
      assignments[firstPosition] = playerId;
      assignments[secondPosition] = selectedFieldPlayer;
    } else if (firstPosition && secondBenchIndex >= 0) {
      assignments[firstPosition] = playerId;
      bench[secondBenchIndex] = selectedFieldPlayer;
    } else if (firstBenchIndex >= 0 && secondPosition) {
      assignments[secondPosition] = selectedFieldPlayer;
      bench[firstBenchIndex] = playerId;
    } else if (firstBenchIndex >= 0 && secondBenchIndex >= 0) {
      [bench[firstBenchIndex], bench[secondBenchIndex]] = [bench[secondBenchIndex], bench[firstBenchIndex]];
    } else {
      setSelectedFieldPlayer(null);
      return;
    }

    const previousPlan = plan;
    const nextPlan = plan.map((item, index) => index === inning ? { ...item, assignments, bench } : item);
    setSelectedFieldPlayer(null);
    setIsSavingManualField(true);
    setPlan(nextPlan);
    try {
      await persistGameToSheet(nextPlan, battingOrder, inning);
    } catch (error) {
      setPlan(previousPlan);
      setNotice(error instanceof Error ? error.message : 'Could not save the fielding swap.');
    } finally {
      setIsSavingManualField(false);
    }
  }

  function beginBattingDrag(event: React.PointerEvent<HTMLButtonElement>, playerId: string): void {
    if (!isAuthorized) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    battingDragRef.current = { id: playerId, original: [...battingOrderRef.current] };
    setDraggingBatter(playerId);
  }

  function moveBattingDrag(event: React.PointerEvent<HTMLButtonElement>): void {
    const drag = battingDragRef.current;
    if (!drag) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-batter-id]') as HTMLElement | null;
    const targetId = target?.dataset.batterId;
    if (!targetId || targetId === drag.id) return;
    const currentOrder = battingOrderRef.current;
    const from = currentOrder.indexOf(drag.id);
    const to = currentOrder.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    const nextOrder = [...currentOrder];
    nextOrder.splice(from, 1);
    nextOrder.splice(to, 0, drag.id);
    battingOrderRef.current = nextOrder;
    setBattingOrder(nextOrder);
  }

  async function finishBattingDrag(event: React.PointerEvent<HTMLButtonElement>, cancelled = false): Promise<void> {
    const drag = battingDragRef.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    battingDragRef.current = null;
    setDraggingBatter(null);
    if (cancelled) {
      battingOrderRef.current = drag.original;
      setBattingOrder(drag.original);
      return;
    }
    const nextOrder = battingOrderRef.current;
    if (nextOrder.join('|') === drag.original.join('|')) return;
    try {
      await persistGameToSheet(plan, nextOrder, inning);
    } catch (error) {
      battingOrderRef.current = drag.original;
      setBattingOrder(drag.original);
      setNotice(error instanceof Error ? error.message : 'Could not save the batting order.');
    }
  }

  async function restoreGame(): Promise<void> {
    try {
      const stored = await readGameFromSheet();
      applyStoredGame(stored);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not restore the active game.');
    }
  }

  function applyStoredGame(stored: StoredGame | null): void {
    setSelectedFieldPlayer(null);
    if (!stored) {
      setPlan([]);
      setBattingOrder([]);
      setInning(0);
      return;
    }
    setPlan(stored.plan);
    setBattingOrder(stored.battingOrder);
    setInning(Math.min(Math.max(stored.inning, 0), Math.max(stored.plan.length - 1, 0)));
  }

  async function restorePublicGame(silent = false): Promise<void> {
    try {
      applyStoredGame(await readPublicGameFromSheet());
    } catch (error) {
      if (!silent) setNotice(error instanceof Error ? error.message : 'Could not load the public lineup.');
    }
  }

  async function refreshPublicData(initial = false): Promise<void> {
    if (initial) setIsInitialLoading(true);
    else {
      setLoadingMessage(randomLoadingMessage());
      setIsRefreshing(true);
    }
    try {
      await Promise.all([importSheet(SHEET_CONFIG, true), restorePublicGame(initial)]);
    } finally {
      if (initial) setIsInitialLoading(false);
      else setIsRefreshing(false);
    }
  }

  async function selectInning(nextInning: number): Promise<void> {
    setSelectedFieldPlayer(null);
    setInning(nextInning);
    if (!isAuthorized) return;
    try {
      await persistGameToSheet(plan, battingOrder, nextInning);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save the current inning.');
    }
  }

  async function endGame(): Promise<void> {
    if (!window.confirm('End this game and clear the active-game worksheet?')) return;
    setIsEndingGame(true);
    try {
      await clearGameSheet();
      setPlan([]);
      setBattingOrder([]);
      setInning(0);
      setGameView('field');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not end the game.');
    } finally {
      setIsEndingGame(false);
    }
  }

  async function savePlayer(player: Player): Promise<void> {
    setIsSaving(true);
    try {
      await savePlayerToSheet(player);
      setIsAuthorized(true);
      setPlayers(old => old.some(p => p.id === player.id) ? old.map(p => p.id === player.id ? player : p) : [...old, player]);
      setEditing(null);
      setEditingOriginal(null);
      setNotice(`${player.name} saved to Google Sheets.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save this player.');
    } finally {
      setIsSaving(false);
    }
  }

  function openPlayerEditor(player: Player): void {
    if (!isAuthorized) return;
    const draft = copyPlayer(player);
    setEditing(draft);
    setEditingOriginal(copyPlayer(draft));
  }

  function closePlayerEditor(): void {
    setEditing(null);
    setEditingOriginal(null);
  }

  async function authorizeGoogle(): Promise<void> {
    setIsAuthorizing(true);
    try {
      await requestSheetsToken();
      setIsAuthorized(true);
      await restoreGame();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not connect your Google account.');
    } finally {
      setIsAuthorizing(false);
    }
  }

  function logoutGoogle(): void {
    const token = sheetsToken;
    sheetsToken = '';
    sheetsTokenExpiresAt = 0;
    cachedSheetTitles = null;
    try { sessionStorage.removeItem(SESSION_TOKEN_KEY); } catch { /* The in-memory session is still cleared. */ }
    setIsAuthorized(false);
    setSelectedFieldPlayer(null);
    battingDragRef.current = null;
    setDraggingBatter(null);
    closePlayerEditor();
    setShowAccountMenu(false);
    if (token && window.google?.accounts?.oauth2?.revoke) window.google.accounts.oauth2.revoke(token, () => undefined);
  }

  async function toggleAvailability(player: Player): Promise<void> {
    const available = !player.available;
    setPlayers(old => old.map(item => item.id === player.id ? { ...item, available } : item));
    if (!isAuthorized || !player.sheetRow) return;
    setAttendanceWrites(old => new Set(old).add(player.id));
    try {
      await saveAttendanceToSheet(player, available);
    } catch (error) {
      setPlayers(old => old.map(item => item.id === player.id ? { ...item, available: player.available } : item));
      setNotice(error instanceof Error ? error.message : 'Could not update attendance in Google Sheets.');
    } finally {
      setAttendanceWrites(old => {
        const next = new Set(old);
        next.delete(player.id);
        return next;
      });
    }
  }

  async function importSheet(c: SheetsConfig, silent = false): Promise<void> {
    if (!silent) setIsRefreshing(true);
    try {
      const spreadsheetId = spreadsheetIdFrom(c.spreadsheet);
      if (!spreadsheetId) throw new Error('Paste the public spreadsheet URL or ID first.');
      const table = await queryPublicSheet(spreadsheetId, c.gid || '0');
      const headers = (table[0] || []).map(value => value.trim().toLowerCase());
      const column = (name: string) => headers.indexOf(name);
      const value = (row: string[], name: string) => row[column(name)] ?? '';
      if (column('name') < 0) throw new Error('The sheet needs a Name header column.');
      const hasHereColumn = column('here') >= 0;
      const imported: Player[] = table.slice(1).map((row, rowIndex) => ({ row, sheetRow: rowIndex + 2 })).filter(({ row }) => value(row, 'name').trim()).map(({ row, sheetRow }) => {
        const positions = Object.entries(POSITION_COLUMNS).filter(([header]) => value(row, header).toLowerCase() === 'yes').map(([, position]) => position);
        const requestedPrimary = value(row, 'primary position').trim().toUpperCase() || value(row, 'primary').trim().toUpperCase();
        const primaryPosition = (requestedPrimary === 'LC' ? 'LCF' : requestedPrimary === 'RC' ? 'RCF' : requestedPrimary) as RosterPosition;
        return {
          id: `sheet-${value(row, 'name').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          name: value(row, 'name').trim(),
          gender: (value(row, 'gender').toLowerCase() === 'female' ? 'Woman' : value(row, 'gender').toLowerCase() === 'male' ? 'Man' : 'Other') as Gender,
          positions,
          primaryPosition: positions.includes(primaryPosition) ? primaryPosition : undefined,
          battingStrength: Math.max(1, Math.min(10, Number(value(row, 'batting strength')) || 5)),
          fieldingStrength: Math.max(1, Math.min(10, Number(value(row, 'fielding strength')) || 5)),
          available: !hasHereColumn || ['true', 'yes', 'y', '1', 'x'].includes(value(row, 'here').trim().toLowerCase()),
          lateArrivalInning: normalizeInning(value(row, 'late')),
          earlyDepartureInning: normalizeInning(value(row, 'early')),
          sheetRow
        };
      });
      setPlayers(imported);
      if (!silent) setNotice(`Loaded ${imported.length} players from Google Sheets.`);
    } catch (error) {
      if (!silent) setNotice(error instanceof Error ? error.message : 'Could not load the public sheet.');
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setTab('game')}><span className="ball" aria-hidden="true">🥎</span><span>WE GOT THE RUNS</span></button>
      <div className="top-actions"><span className="saved"><i /> Saved on this iPhone</span><div className="cloud-actions"><button className={`profile-button ${isAuthorized ? 'connected' : ''}`} aria-label={isAuthorized ? 'Open Google account menu' : 'Connect Google account'} disabled={isAuthorizing} onClick={() => isAuthorized ? setShowAccountMenu(true) : void authorizeGoogle()}><img src={googleIcon} alt=""/></button><button className="sync-button" aria-label={isRefreshing ? 'Refreshing roster and lineup data' : 'Refresh roster and lineup data'} disabled={isRefreshing || isInitialLoading} onClick={() => void refreshPublicData()}>↻ <span>{isRefreshing ? 'Refreshing…' : 'Refresh data'}</span></button></div></div>
    </header>

    {(isInitialLoading || isRefreshing) ? <div className="data-loader" role="status" aria-live="polite"><img src={loaderGif} alt=""/><strong>{loadingMessage}</strong></div> : null}

    <main>
      <div className="desktop-tabs" role="tablist">
        <button className={tab === 'game' ? 'active' : ''} onClick={() => setTab('game')}>Game card</button>
        <button className={tab === 'roster' ? 'active' : ''} onClick={() => setTab('roster')}>Roster <b>{players.length}</b></button>
      </div>

      {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}

      {tab === 'game' && <section className="game-view">
        <div className="game-heading">
          <div><p className="eyebrow">Thursday night · Game card</p><h1>{plan.length ? <>Inning <em className="inning-number" key={inning}>{inning + 1}</em> of {plan.length}</> : 'Ready when you are.'}</h1></div>
        </div>

        {plan.length ? <>
          <div className="game-view-switch" role="tablist" aria-label="Lineup view"><button role="tab" aria-selected={gameView === 'field'} className={gameView === 'field' ? 'active' : ''} onClick={() => setGameView('field')}>Field</button><button role="tab" aria-selected={gameView === 'batting'} className={gameView === 'batting' ? 'active' : ''} onClick={() => { setSelectedFieldPlayer(null); setGameView('batting'); }}>Batting order</button></div>
          {gameView === 'field' ? <>
            <div className="inning-strip" aria-label="Choose inning">{plan.map((item, i) => <button key={item.inning} onClick={() => void selectInning(i)} className={i === inning ? 'current' : i < inning ? 'past' : ''}><span>{item.inning}</span><small>{i < inning ? 'Played' : i === inning ? 'Now' : 'Next'}</small></button>)}</div>
            <div className="game-grid">
              <div className="field-card">
                <div className="card-label"><span>Fielding lineup</span><b>{isAuthorized ? (selectedFieldPlayer ? 'Tap another player' : 'Tap to swap') : 'Connect Google to swap'}</b></div>
                <div className="diamond">
                  <div className="foul-line foul-line-left" aria-hidden="true" />
                  <div className="foul-line foul-line-right" aria-hidden="true" />
                  <div className="infield-dirt" aria-hidden="true"><div className="infield-grass" /></div>
                  <div className="pitchers-circle" aria-hidden="true" />
                  <i className="base base-home" aria-hidden="true" />
                  <i className="base base-first" aria-hidden="true" />
                  <i className="base base-second" aria-hidden="true" />
                  <i className="base base-third" aria-hidden="true" />
                  {Object.entries(current.assignments).sort(([left], [right]) => FIELD_ANIMATION_ORDER.indexOf(left as Position) - FIELD_ANIMATION_ORDER.indexOf(right as Position)).map(([pos, id], index) => <button type="button" className={`position pos-${pos.toLowerCase()} ${selectedFieldPlayer === id ? 'selected-player' : ''}`} disabled={!isAuthorized || isSavingManualField} aria-pressed={selectedFieldPlayer === id} onClick={() => void selectFieldPlayer(id)} key={`${inning}-${pos}`} style={{ '--i': index } as React.CSSProperties}><span>{pos}</span><strong>{byId[id]?.name}</strong></button>)}
                </div>
              </div>
              <aside className="side-stack">
                <div className="bench-card"><div className="card-label"><span>Bench</span><b>{current.bench.length} players</b></div>{current.bench.length ? current.bench.map(id => <button type="button" className={`bench-player ${selectedFieldPlayer === id ? 'selected-player' : ''}`} disabled={!isAuthorized || isSavingManualField} aria-pressed={selectedFieldPlayer === id} onClick={() => void selectFieldPlayer(id)} key={id}><span className={`avatar prefix-${Math.min(badgeLabels[id]?.length || 1, 4)} ${byId[id]?.gender.toLowerCase()}`}><span className="centered-glyph">{badgeLabels[id]}</span></span><strong>{byId[id]?.name}</strong></button>) : <p className="empty">Everyone is fielding.</p>}</div>
                <div className="change-card"><p className="eyebrow">At the change</p><h2>{inning === 0 ? 'Start here' : `For inning ${inning + 1}`}</h2>{inning === 0 ? <p className="muted">Take the field with the positions shown. The next card will list every swap.</p> : changes.length ? changes.map((c, i) => <div className={`change ${c.action.toLowerCase()}`} key={`${c.id}-${i}`}><b>{c.action}</b><span><strong>{byId[c.id]?.name}</strong>{c.pos && ` → ${c.pos}`}</span></div>) : <p className="muted">No bench changes this inning.</p>}</div>
              </aside>
            </div>
            <div className="next-bar"><button disabled={inning === 0} onClick={() => void selectInning(inning - 1)}>← Previous</button><span><i /> Gender rule met</span><button className="next" disabled={inning === plan.length - 1} onClick={() => void selectInning(inning + 1)}>Next inning →</button></div>
          </> : <section className="batting-card batting-tab-panel" role="tabpanel">
            <div className="card-label"><span>Batting order</span></div>
            <ol className={`editable ${isAuthorized ? '' : 'locked'}`}>{battingOrder.map((id, index) => <li className={draggingBatter === id ? 'dragging' : ''} data-batter-id={id} key={id} style={{ '--i': index } as React.CSSProperties}><button type="button" className="batting-grip" disabled={!isAuthorized} aria-label={isAuthorized ? `Move ${byId[id]?.name || 'player'} in the batting order` : 'Connect Google to edit the batting order'} onPointerDown={event => beginBattingDrag(event, id)} onPointerMove={moveBattingDrag} onPointerUp={event => void finishBattingDrag(event)} onPointerCancel={event => void finishBattingDrag(event, true)}><span aria-hidden="true">⠿</span></button><span className={`lineup-number ${byId[id]?.gender.toLowerCase()}`}><span className="centered-glyph">{index + 1}</span></span><strong>{byId[id]?.name}</strong></li>)}</ol>
          </section>}
          <button className="regenerate-fielding-button" disabled={!isAuthorized || isRegeneratingFielding || isEndingGame} onClick={() => void regenerateRemainingFielding()}>{isRegeneratingFielding ? 'Regenerating fielding…' : `Regenerate fielding from inning ${inning + 1}`}</button>
          <button className="end-game-button" disabled={!isAuthorized || isEndingGame || isRegeneratingFielding} onClick={() => void endGame()}>{isEndingGame ? 'Ending game…' : 'End game and clear saved lineup'}</button>
        </> : <div className="empty-game"><div className="empty-ball">🥎</div><h2>Your lineup card is blank.</h2><p>{isAuthorized ? 'Mark who’s here, then generate a fair seven-inning rotation.' : 'Connect your Google account above before generating a lineup.'}</p><button className="button primary" disabled={!isAuthorized || isGenerating} onClick={() => void regenerate()}>{isGenerating ? 'Generating…' : isAuthorized ? 'Generate 7-inning lineup' : 'Connect Google to generate'}</button></div>}
      </section>}

      {tab === 'roster' && <section className="panel-view">
        <div className="section-heading"><div><p className="eyebrow">Team sheet</p><h1>Who’s here?</h1><p>Tap a player to edit their positions. Switch them off if they’re late, hurt, or leaving early.</p></div></div>
        <div className={`roster-list ${isAuthorized ? '' : 'read-only'}`}>{players.map(player => <article className={!player.available ? 'unavailable' : ''} key={player.id} onClick={() => openPlayerEditor(player)}>
          <button className="player-main" disabled={!isAuthorized} onClick={event => { event.stopPropagation(); openPlayerEditor(player); }}><span className={`avatar prefix-${Math.min(badgeLabels[player.id]?.length || 1, 4)} ${player.gender.toLowerCase()}`}><span className="centered-glyph">{badgeLabels[player.id]}</span></span><span><strong>{player.name}</strong><small>{genderLabel(player.gender)}{player.primaryPosition ? ` · Primary: ${player.primaryPosition}` : ''} · {player.positions.join(', ') || 'No positions yet'}{playerSchedule(player) && ` · ${playerSchedule(player)}`}</small></span></button>
          <label className="switch" onClick={event => event.stopPropagation()}><input type="checkbox" checked={player.available} disabled={!isAuthorized || attendanceWrites.has(player.id)} onChange={() => void toggleAvailability(player)}/><span /></label>
        </article>)}</div>
        <button className="button primary add-player-button" disabled={!isAuthorized} onClick={() => openPlayerEditor({ id: uid(), name: '', gender: 'Woman', positions: [], battingStrength: 5, fieldingStrength: 5, available: true })}>+ Add player</button>
      </section>}

    </main>

    <nav className="mobile-nav"><button className={tab === 'game' ? 'active' : ''} onClick={() => setTab('game')}><span>🥎</span>Game</button><button className={tab === 'roster' ? 'active' : ''} onClick={() => setTab('roster')}><span>♟️</span>Roster</button></nav>

    {showAccountMenu ? <div className="account-backdrop" onClick={() => setShowAccountMenu(false)}><section className="account-sheet" role="dialog" aria-modal="true" aria-labelledby="account-sheet-title" onClick={event => event.stopPropagation()}><div className="sheet-handle"/><img src={googleIcon} alt=""/><p className="eyebrow">Google Sheets access</p><h2 id="account-sheet-title">Account connected</h2><p>Your account can update the roster and saved lineup. Logging out leaves the public lineup visible.</p><button className="button logout-button" onClick={logoutGoogle}>Log out</button><button className="button secondary" onClick={() => setShowAccountMenu(false)}>Cancel</button></section></div> : null}

    {editing && <div className="modal-backdrop"><section className="modal player-modal">
      <button className="icon-button close" aria-label="Close player editor" onClick={closePlayerEditor}>×</button>
      <p className="eyebrow">Player card</p><h2>{editing.name || 'New player'}</h2>
      <label>Name<input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}/></label>
      <label>Gender<select value={editing.gender} onChange={e => setEditing({ ...editing, gender: e.target.value as Gender })}><option value="Woman">W</option><option value="Man">M</option><option value="Other">O</option></select></label>
      <fieldset><legend>Positions they can play</legend><div className="position-pills">{ALL_POSITIONS.map(pos => <button type="button" className={editing.positions.includes(pos) ? 'selected' : ''} onClick={() => {
        const positions = editing.positions.includes(pos) ? editing.positions.filter(p => p !== pos) : [...editing.positions, pos];
        const primaryPosition = editing.primaryPosition && positions.includes(editing.primaryPosition) ? editing.primaryPosition : positions[0];
        setEditing({ ...editing, positions, primaryPosition });
      }} key={pos}>{pos}</button>)}</div></fieldset>
      <label>Primary position<select value={editing.primaryPosition ?? ''} disabled={!editing.positions.length} onChange={e => setEditing({ ...editing, primaryPosition: e.target.value as RosterPosition })}><option value="" disabled>Select a primary position</option>{editing.positions.map(pos => <option value={pos} key={pos}>{pos}</option>)}</select></label>
      <div className="schedule-options">
        <div className="schedule-option">
          <div className="schedule-option-header"><span><strong>Coming late</strong><small>Set the first inning they can play.</small></span><label className="switch"><input type="checkbox" checked={Boolean(editing.lateArrivalInning)} onChange={e => setEditing({ ...editing, lateArrivalInning: e.target.checked ? Math.min(2, editing.earlyDepartureInning ?? 2) : undefined })}/><span /></label></div>
          {editing.lateArrivalInning ? <label>First eligible inning<input type="number" inputMode="numeric" min="1" max="7" value={editing.lateArrivalInning} onChange={e => setEditing({ ...editing, lateArrivalInning: normalizeInning(e.target.value) ?? 1 })}/></label> : null}
        </div>
        <div className="schedule-option">
          <div className="schedule-option-header"><span><strong>Leaving early</strong><small>Set the last inning they can play.</small></span><label className="switch"><input type="checkbox" checked={Boolean(editing.earlyDepartureInning)} onChange={e => setEditing({ ...editing, earlyDepartureInning: e.target.checked ? Math.max(6, editing.lateArrivalInning ?? 6) : undefined })}/><span /></label></div>
          {editing.earlyDepartureInning ? <label>Last eligible inning<input type="number" inputMode="numeric" min="1" max="7" value={editing.earlyDepartureInning} onChange={e => setEditing({ ...editing, earlyDepartureInning: normalizeInning(e.target.value) ?? 7 })}/></label> : null}
        </div>
      </div>
      {editing.lateArrivalInning && editing.earlyDepartureInning && editing.lateArrivalInning > editing.earlyDepartureInning ? <p className="schedule-error">Arrival must be on or before the last eligible inning.</p> : null}
      <div className="modal-actions"><button className="button danger" disabled={isSaving} onClick={() => { setPlayers(old => old.filter(p => p.id !== editing.id)); closePlayerEditor(); }}>Delete</button><button className="button primary" disabled={isSaving || !hasPlayerChanges || !editing.name || !editing.positions.length || !editing.primaryPosition || Boolean(editing.lateArrivalInning && editing.earlyDepartureInning && editing.lateArrivalInning > editing.earlyDepartureInning)} onClick={() => void savePlayer(editing)}>{isSaving ? 'Saving…' : 'Save player'}</button></div>
    </section></div>}
  </div>;
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('App root is missing.');
createRoot(rootElement).render(<App />);
