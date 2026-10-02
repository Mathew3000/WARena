// Server entry point - WebSocket multiplayer server with lobbies
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GameEngine } from './game.js';
import { CONSTANTS, createDefaultMap, getMap, getAvailableMaps, MAP_REGISTRY } from '../shared/constants.js';

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const LOBBY_TIMEOUT = 120; // seconds before empty lobby is destroyed

// ─── Express server for static files ──────────────────────
const app = express();
app.use(express.static('client'));
app.use('/shared', express.static('shared'));

// Serve editor at /editor
app.get('/editor', (req, res) => {
  res.sendFile(require('path').join(__dirname, '..', 'client', 'editor.html'));
});

// ─── HTTP + WebSocket server ──────────────────────────────
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// ─── Lobby system ─────────────────────────────────────────
/** @type {Map<string, Lobby>} */
const lobbies = new Map(); // id -> lobby object

function generateLobbyId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function createLobby(name, mapKey) {
  const id = generateLobbyId();
  const mapDef = getMap(mapKey || 'default');
  const lobby = {
    id,
    name: name || `Lobby ${id}`,
    mapKey: mapDef ? (mapKey || 'default') : 'default',
    gameEngine: new GameEngine((mapDef?.generator ?? createDefaultMap)()),
    players: new Map(), // ws -> { playerId, name, team, color }
    roundTimer: 300,
    roundDuration: 300,
    persistentRoundDuration: 300,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    votingActive: false,
    voteTimeLeft: 0,
  };
  
  // Initialize items for this map
  const itemsDef = mapDef?.items ?? (() => []);
  lobby.gameEngine.items = [];
  for (const item of itemsDef()) {
    lobby.gameEngine.items.push({
      id: Math.random().toString(36).substr(2, 9),
      x: item.x,
      y: item.y,
      type: item.type,
      respawnTimer: 0,
      active: true,
    });
  }

  lobbies.set(id, lobby);
  console.log(`[LOBBY] Created "${lobby.name}" (${id}) on map ${lobby.mapKey}`);
  return id;
}

function getLobby(lobbyId) {
  return lobbies.get(lobbyId);
}

function destroyLobby(lobbyId) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return;
  
  // Notify all players
  for (const [ws] of lobby.players) {
    ws.send(JSON.stringify({ type: 'lobbyDestroyed', reason: 'Lobby timed out' }));
  }
  
  console.log(`[LOBBY] Destroyed "${lobby.name}" (${lobbyId})`);
  lobbies.delete(lobbyId);
}

function getLobbyStats(lobby) {
  return {
    id: lobby.id,
    name: lobby.name,
    mapKey: lobby.mapKey,
    mapName: MAP_REGISTRY[lobby.mapKey]?.name || 'Unknown',
    playerCount: lobby.players.size,
    roundActive: lobby.gameEngine.roundActive,
    roundTimer: Math.max(0, Math.ceil(lobby.gameEngine.roundTimer)),
    roundDuration: lobby.roundDuration,
    votingActive: lobby.votingActive,
  };
}

// ─── Broadcast helpers for a specific lobby ───────────────
function broadcastToLobby(lobby, message) {
  const data = JSON.stringify(message);
  for (const [ws] of lobby.players) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// ─── Client tracking ──────────────────────────────────────
/** @type {Map<WebSocket, { playerId: string, name: string, team: number, color: string|null, lobbyId: string|null }>} */
const clients = new Map();

function getClient(ws) {
  return clients.get(ws);
}

// ─── Generate random names ────────────────────────────────
const ADJECTIVES = ['Swift', 'Brave', 'Dark', 'Wild', 'Crazy', 'Silent', 'Fierce', 'Rapid', 'Shadow', 'Thunder'];
const NOUNS = ['Wolf', 'Eagle', 'Fox', 'Bear', 'Hawk', 'Tiger', 'Dragon', 'Phantom', 'Blade', 'Storm'];

function generateName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}${noun}${Math.floor(Math.random() * 99)}`;
}

function generateId() {
  return Math.random().toString(36).substr(2, 8);
}

// ─── WebSocket connections ────────────────────────────────
wss.on('connection', (ws) => {
  const playerId = generateId();
  clients.set(ws, { playerId, name: '', team: 1, color: null, lobbyId: null });

  // Send available maps and lobbies on connect
  ws.send(JSON.stringify({
    type: 'initConnect',
    maps: getAvailableMaps().map(m => ({ key: m.key, name: m.name, description: m.description })),
    lobbies: Array.from(lobbies.values()).map(l => getLobbyStats(l)),
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleClientMessage(ws, msg);
    } catch (e) {
      console.error('[WS] Parse error:', e.message);
    }
  });

  ws.on('close', () => {
    const client = getClient(ws);
    if (!client) return;

    // Remove from lobby
    if (client.lobbyId) {
      const lobby = lobbies.get(client.lobbyId);
      if (lobby) {
        lobby.players.delete(ws);
        
        // Broadcast updated player list
        broadcastToLobby(lobby, {
          type: 'playerList',
          players: lobby.gameEngine.getPlayerStates(),
        });

        // Destroy lobby if empty
        if (lobby.players.size === 0) {
          destroyLobby(client.lobbyId);
        }
      }
    }

    clients.delete(ws);
  });
});

// ─── Message handler ──────────────────────────────────────
function handleClientMessage(ws, msg) {
  const client = getClient(ws);
  if (!client) return;

  switch (msg.type) {
    case 'listLobbies':
      // Return current lobby list
      ws.send(JSON.stringify({
        type: 'lobbyList',
        lobbies: Array.from(lobbies.values()).map(l => getLobbyStats(l)),
      }));
      break;

    case 'createLobby': {
      const name = msg.name || '';
      const mapKey = msg.mapKey || 'default';
      const lobbyId = createLobby(name, mapKey);
      
      // Join the created lobby
      joinLobby(ws, client.playerId, lobbyId);
      break;
    }

    case 'joinLobby': {
      const lobbyId = msg.lobbyId;
      const lobby = getLobby(lobbyId);
      if (!lobby) {
        ws.send(JSON.stringify({ type: 'joinError', reason: 'Lobby not found' }));
        return;
      }
      joinLobby(ws, client.playerId, lobbyId);
      break;
    }

    case 'login': {
      // Player provides name + color after selecting/joining a lobby
      const name = msg.name?.trim() || generateName();
      let team = parseInt(msg.team) || 1;
      const color = msg.color || null;
      
      if (!client.lobbyId) {
        ws.send(JSON.stringify({ type: 'loginError', reason: 'No lobby selected' }));
        return;
      }

      const lobby = lobbies.get(client.lobbyId);
      if (!lobby) {
        ws.send(JSON.stringify({ type: 'loginError', reason: 'Lobby no longer exists' }));
        return;
      }

      // Add player to the game engine
      const player = lobby.gameEngine.addPlayer(client.playerId, name, team);
      if (!player) {
        ws.send(JSON.stringify({ type: 'loginError', reason: 'Lobby is full' }));
        return;
      }

      if (color) player.customColor = color;

      // Set round duration on first join
      if (lobby.players.size === 1 && lobby.gameEngine.players.size === 1) {
        const roundTime = Math.max(30, Math.min(3600, msg.roundTime || 300));
        lobby.persistentRoundDuration = roundTime;
        lobby.roundTimer = roundTime;
        lobby.roundDuration = roundTime;
      }

      // Track client info
      client.name = name;
      client.team = team;
      client.color = color;
      client.lobbyId = lobby.id;
      lobby.lastActivity = Date.now();

      // Send initial state
      const mapData = lobby.gameEngine.map.map(row => row.join(''));
      ws.send(JSON.stringify({
        type: 'init',
        playerId: client.playerId,
        mapWidth: CONSTANTS.WORLD_WIDTH,
        mapHeight: CONSTANTS.WORLD_HEIGHT,
        tileSize: CONSTANTS.TILE_SIZE,
        map: mapData,
        players: lobby.gameEngine.getPlayerStates(),
        items: lobby.gameEngine.getItems(),
        time: Date.now(),
      }));

      // Broadcast player list to all in lobby
      broadcastToLobby(lobby, {
        type: 'playerList',
        players: lobby.gameEngine.getPlayerStates(),
      });

      console.log(`[LOBBY ${lobby.id}] Player joined: ${name}`);
      break;
    }

    case 'input': {
      if (!client.lobbyId) return;
      const lobby = lobbies.get(client.lobbyId);
      if (!lobby) return;
      
      const player = lobby.gameEngine.players.get(client.playerId);
      if (!player) return;

      player.input = {
        left: msg.left || false,
        right: msg.right || false,
        up: msg.up || false,
        shoot: msg.shoot || false,
        grapple: msg.grapple || false,
        mouseX: msg.mouseX || 0,
        mouseY: msg.mouseY || 0,
      };
      break;
    }

    case 'weaponSwitch': {
      if (!client.lobbyId) return;
      const lobby = lobbies.get(client.lobbyId);
      if (!lobby) return;
      
      const player = lobby.gameEngine.players.get(client.playerId);
      if (!player) return;

      const weaponKey = msg.weapon;
      if (CONSTANTS.WEAPONS[weaponKey] && player.unlockedWeapons.has(weaponKey)) {
        player.switchTo(weaponKey);
      }
      break;
    }

    case 'respawn': {
      if (!client.lobbyId) return;
      const lobby = lobbies.get(client.lobbyId);
      if (!lobby) return;
      
      const player = lobby.gameEngine.players.get(client.playerId);
      if (!player) return;

      const spawn = lobby.gameEngine.spawnPoints[Math.floor(Math.random() * lobby.gameEngine.spawnPoints.length)];
      player.x = spawn.x;
      player.y = spawn.y;
      player.vx = 0;
      player.vy = 0;
      player.health = CONSTANTS.PLAYER_MAX_HEALTH;
      break;
    }

    case 'chat': {
      if (!client.lobbyId) return;
      const lobby = lobbies.get(client.lobbyId);
      if (!lobby) return;
      
      broadcastToLobby(lobby, { type: 'chat', text: msg.text, player: client.name });
      break;
    }

    case 'vote': {
      if (!client.lobbyId) return;
      const lobby = lobbies.get(client.lobbyId);
      if (!lobby) return;
      
      lobby.gameEngine.castVote(client.playerId, msg.map);
      broadcastToLobby(lobby, { type: 'state', players: lobby.gameEngine.getPlayerStates() });
      break;
    }

    case 'adminMapSelect': {
      if (!client.lobbyId) return;
      const lobby = lobbies.get(client.lobbyId);
      if (!lobby) return;
      
      const player = lobby.gameEngine.players.get(client.playerId);
      if (!player || !player.isAdmin) return;

      switchLobbyMap(lobby, msg.map);
      broadcastToLobby(lobby, { type: 'state', players: lobby.gameEngine.getPlayerStates() });
      break;
    }

    case 'editTile': {
      if (!client.lobbyId) return;
      const lobby = lobbies.get(client.lobbyId);
      if (!lobby) return;
      
      const tx = msg.x;
      const ty = msg.y;
      const value = parseInt(msg.value);

      if (tx < 0 || ty < 0 || ty >= lobby.gameEngine.map.length || tx >= lobby.gameEngine.map[0].length) return;
      if (tx === 0 || ty === 0 || tx >= lobby.gameEngine.map[0].length - 1 || ty >= lobby.gameEngine.map.length - 1) return;

      lobby.gameEngine.map[ty][tx] = value;
      break;
    }
  }
}

function joinLobby(ws, playerId, lobbyId) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) {
    ws.send(JSON.stringify({ type: 'joinError', reason: 'Lobby not found' }));
    return;
  }

  // Send lobby info to joining client
  ws.send(JSON.stringify({
    type: 'lobbyInfo',
    id: lobby.id,
    name: lobby.name,
    mapKey: lobby.mapKey,
    mapName: MAP_REGISTRY[lobby.mapKey]?.name || 'Unknown',
    players: Array.from(lobby.players.values()).map(p => ({
      playerId: p.playerId,
      name: p.name,
      team: p.team,
      color: p.color,
    })),
  }));

  // Notify others in lobby
  broadcastToLobby(lobby, {
    type: 'playerJoined',
    player: { playerId, name: '', team: 1 },
  });
}

function switchLobbyMap(lobby, mapKey) {
  const mapDef = getMap(mapKey);
  if (!mapDef) return;

  // Save existing players
  const oldPlayers = [];
  for (const [ws, pData] of lobby.players) {
    const player = lobby.gameEngine.players.get(pData.playerId);
    if (player) {
      oldPlayers.push({
        playerId: pData.playerId,
        name: pData.name,
        team: pData.team,
        color: pData.color,
      });
    }
  }

  // Create new game engine with new map
  lobby.gameEngine = new GameEngine(mapDef.generator());
  
  // Preserve round duration
  lobby.roundTimer = lobby.persistentRoundDuration;
  lobby.roundDuration = lobby.persistentRoundDuration;

  // Reload items
  lobby.gameEngine.items = [];
  for (const item of (mapDef.items ?? (() => []))()) {
    lobby.gameEngine.items.push({
      id: Math.random().toString(36).substr(2, 9),
      x: item.x,
      y: item.y,
      type: item.type,
      respawnTimer: 0,
      active: true,
    });
  }

  // Re-add players at spawn points
  for (const pData of oldPlayers) {
    const spawn = lobby.gameEngine.spawnPoints[Math.floor(Math.random() * lobby.gameEngine.spawnPoints.length)];
    const player = lobby.gameEngine.addPlayer(pData.playerId, pData.name, pData.team);
    if (player) {
      player.customColor = pData.color;
      player.isAdmin = false; // Reset admin on map switch
      player.unlockedWeapons = new Set(['gun']);
      player.x = spawn.x;
      player.y = spawn.y;
      player.health = CONSTANTS.PLAYER_MAX_HEALTH;
    }
  }

  lobby.lastActivity = Date.now();
  console.log(`[LOBBY ${lobby.id}] Map switched to: ${mapDef.name}`);

  // Notify all clients
  const mapArray = [];
  for (let y = 0; y < lobby.gameEngine.map.length; y++) {
    let row = '';
    for (let x = 0; x < lobby.gameEngine.map[y].length; x++) {
      const tile = lobby.gameEngine.map[y][x];
      if (tile === 1) row += '1';
      else if (tile === 2) row += '2';
      else if (tile === 3) row += '3';
      else row += '0';
    }
    mapArray.push(row);
  }

  broadcastToLobby(lobby, {
    type: 'mapSwitched',
    players: lobby.gameEngine.getPlayerStates(),
    currentMap: mapKey,
    map: mapArray,
  });
}

// ─── Game loop per lobby ──────────────────────────────────
const TICK_INTERVAL = 1000 / CONSTANTS.SERVER_TICK_RATE;
let lastTick = Date.now();
let accumulator = 0;

function gameLoop() {
  const now = Date.now();
  const delta = now - lastTick;
  lastTick = now;
  accumulator += delta;

  while (accumulator >= TICK_INTERVAL) {
    const dt = TICK_INTERVAL / 1000;

    // Update all active lobbies
    for (const [id, lobby] of lobbies) {
      if (lobby.players.size === 0) continue;

      lobby.lastActivity = Date.now();

      // Round timer
      if (lobby.gameEngine.roundActive && lobby.roundTimer > 0) {
        lobby.roundTimer -= dt;
        
        if (lobby.roundTimer <= 0) {
          lobby.gameEngine.startVoting();
          broadcastToLobby(lobby, { type: 'roundEnd', message: 'Round over! Vote for the next map.' });
        }
      }

      // Vote timer
      if (lobby.votingActive && lobby.voteTimeLeft > 0) {
        lobby.voteTimeLeft -= dt;
        
        if (lobby.voteTimeLeft <= 0) {
          const winner = lobby.gameEngine.resolveVotes();
          const nextMap = winner || lobby.mapKey;
          
          broadcastToLobby(lobby, { type: 'roundEnd', message: `Voting ended. Next map: ${MAP_REGISTRY[nextMap]?.name || 'Current'}` });

          setTimeout(() => {
            switchLobbyMap(lobby, nextMap);
            lobby.gameEngine.endRound(nextMap);
          }, 3000);
        }
      }

      // Update game engine
      lobby.gameEngine.update(dt);

      // Broadcast state to all clients in this lobby
      const message = JSON.stringify({
        type: 'state',
        players: lobby.gameEngine.getPlayerStates(),
        projectiles: lobby.gameEngine.getProjectiles(),
        particles: lobby.gameEngine.getParticles(),
        items: lobby.gameEngine.getItems(),
        time: Date.now(),
        round: lobby.gameEngine.getGameState().round,
        voting: lobby.gameEngine.getGameState().voting,
      });

      for (const [ws] of lobby.players) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }
    }

    accumulator -= TICK_INTERVAL;
  }

  // Check for timed-out lobbies (every ~10 seconds)
  const nowSec = Date.now() / 1000;
  for (const [id, lobby] of lobbies) {
    if (lobby.players.size === 0 && (nowSec - lobby.createdAt / 1000) > LOBBY_TIMEOUT) {
      destroyLobby(id);
    }
  }
}

// ─── Start server ─────────────────────────────────────────
httpServer.listen(PORT, HOST, () => {
  console.log(`\n=== WARena Server ===`);
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`WebSocket endpoint: ws://${HOST}:${PORT}`);
  console.log(`Editor: http://${HOST}:${PORT}/editor`);
  console.log('==============================\n');

  // Auto-create a default lobby
  createLobby('Classic Arena', 'default');

  setInterval(gameLoop, TICK_INTERVAL);
});

// ─── Graceful shutdown ────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  wss.clients.forEach(client => client.close());
  wss.close();
  httpServer.close(() => process.exit(0));
});
