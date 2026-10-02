// Server entry point - WebSocket multiplayer server
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { GameEngine } from './game.js';
import { CONSTANTS, createDefaultMap, getMap, getAvailableMaps, MAP_REGISTRY } from '../shared/constants.js';

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// Create Express server for static files
const app = express();
app.use(express.static('client'));
app.use('/shared', express.static('shared'));

// Create HTTP server
const httpServer = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer });

// Initialize game engine with default map
let game = new GameEngine(createDefaultMap());
let currentMapName = 'default';

// Player name pool (auto-generated names)
const ADJECTIVES = ['Swift', 'Brave', 'Dark', 'Wild', 'Crazy', 'Silent', 'Fierce', 'Rapid', 'Shadow', 'Thunder'];
const NOUNS = ['Wolf', 'Eagle', 'Fox', 'Bear', 'Hawk', 'Tiger', 'Dragon', 'Phantom', 'Blade', 'Storm'];

function generateName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}${noun}${Math.floor(Math.random() * 99)}`;
}

// Send available maps to a client
function sendAvailableMaps(ws) {
  ws.send(JSON.stringify({
    type: 'availableMaps',
    maps: getAvailableMaps().map(m => ({ key: m.key, name: m.name, description: m.description })),
  }));
}

// Switch to a different map
function switchMap(mapName) {
  const mapDef = getMap(mapName);
  if (!mapDef) return false;
  
  // Save existing player data before creating new game engine
  const oldPlayers = [];
  for (const [id, player] of game.players) {
    oldPlayers.push({
      id,
      name: player.name,
      team: player.team,
      customColor: player.customColor,
      isAdmin: player.isAdmin,
      unlockedWeapons: [...player.unlockedWeapons],
    });
  }
  
  currentMapName = mapName;
  game = new GameEngine(mapDef.generator());
  
  // Preserve the configured round duration across map switches
  game.roundTimer = persistentRoundDuration;
  game.roundDuration = persistentRoundDuration;
  
  // Reload items for this map
  game.items = [];
  const items = mapDef.items();
  for (const item of items) {
    game.items.push({
      id: Math.random().toString(36).substr(2, 9),
      x: item.x,
      y: item.y,
      type: item.type,
      respawnTimer: 0,
      active: true,
    });
  }
  
  // Re-add players to the new game engine at spawn points
  for (const pData of oldPlayers) {
    const spawn = game.spawnPoints[Math.floor(Math.random() * game.spawnPoints.length)];
    const player = game.addPlayer(pData.id, pData.name, pData.team);
    if (player) {
      player.customColor = pData.customColor;
      player.isAdmin = pData.isAdmin;
      player.unlockedWeapons = new Set(pData.unlockedWeapons);
      // Respawn: full health at spawn point
      player.x = spawn.x;
      player.y = spawn.y;
      player.health = CONSTANTS.PLAYER_MAX_HEALTH;
      player.vx = 0;
      player.vy = 0;
    }
  }
  
  console.log(`Map switched to: ${mapDef.name} (${oldPlayers.length} players re-added)`);
  return true;
}

// Track client sequences for reliable messaging
const clientSequences = new Map();

// Persist round duration across map switches (set by first player/admin)
let persistentRoundDuration = 300;

wss.on('connection', (ws, req) => {
  console.log(`Client connected: ${req.socket.remoteAddress}`);
  
  const playerId = generateId();
  
  // Don't add player yet - wait for login message
  let playerName = null;
  let team = null;
  let mapName = 'default';
  
  // Initialize client sequence tracking
  clientSequences.set(ws, { lastSequence: 0 });
  
  // Send available maps on connect
  sendAvailableMaps(ws);
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle map selection before login
      if (message.type === 'mapSelect') {
        mapName = message.map || 'default';
        return;
      }
      
      // Handle login first
      if (message.type === 'login') {
        const result = handleLogin(ws, playerId, message, mapName);
        if (result) {
          playerName = result.name;
          team = result.team;
        }
        return;
      }
      
      // Only process other messages after login
      if (!playerName) return;
      
      handleMessage(ws, playerId, message);
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  });
  
  ws.on('close', () => {
    if (playerName) {
      console.log(`Client disconnected: ${playerName}`);
      game.removePlayer(playerId);
      clientSequences.delete(ws);
      
      // Broadcast updated player list
      broadcastPlayerList();
    } else {
      console.log(`Client disconnected before login: ${req.socket.remoteAddress}`);
      clientSequences.delete(ws);
    }
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

function handleLogin(ws, playerId, message, requestedMap = 'default') {
  const name = message.name?.trim() || generateName();
  let team = parseInt(message.team) || Math.floor(Math.random() * 3) + 1; // Default to random if not specified
  const customColor = message.color || null; // Custom color override
  const roundTime = parseInt(message.roundTime) || 300; // Round duration in seconds
  
  // Switch to requested map (only if different from current and no players on server)
  if (requestedMap !== currentMapName && game.players.size === 0) {
    switchMap(requestedMap);
  }
  
  // First player sets the round duration
  if (game.players.size === 0) {
    persistentRoundDuration = Math.max(30, Math.min(3600, roundTime));
    game.roundTimer = persistentRoundDuration;
    game.roundDuration = persistentRoundDuration;
  }
  
  // Add player to game with chosen name and team
  const player = game.addPlayer(playerId, name, team);
  
  if (!player) {
    ws.send(JSON.stringify({ type: 'loginError', reason: 'Server is full' }));
    ws.close(4000, 'Server full');
    return null;
  }
  
  // Apply custom color if provided
  if (customColor) {
    player.customColor = customColor;
  }
  
  console.log(`Player joined: ${name} (${playerId}) [Team ${team}]`);
  
  // Send initial state to the new player
  sendInitialState(ws, playerId);
  
  // Broadcast updated player list to all clients
  broadcastPlayerList();
  
  return { name, team };
}

function generateId() {
  return Math.random().toString(36).substr(2, 8);
}

function handleMessage(ws, playerId, message) {
  switch (message.type) {
    case 'input':
      handleInput(ws, playerId, message);
      break;
      
    case 'chat':
      handleChat(message.text);
      break;
      
    case 'respawn':
      respawnPlayer(playerId);
      break;
      
    case 'weaponSwitch':
      switchWeapon(playerId, message.weapon);
      break;
      
    case 'editTile':
      handleEditTile(ws, playerId, message);
      break;
      
    case 'vote':
      handleVote(playerId, message.map);
      break;
      
    case 'adminMapSelect':
      handleAdminMapSelect(playerId, message.map);
      break;
  }
}

function handleVote(playerId, mapKey) {
  if (game.castVote(playerId, mapKey)) {
    broadcastGameState();
  }
}

function handleAdminMapSelect(playerId, mapKey) {
  const player = game.players.get(playerId);
  if (!player || !player.isAdmin) return;
  
  // Only allow map change when no round is active (during voting or between rounds)
  if (game.roundActive && !game.votingActive) {
    ws.send(JSON.stringify({ type: 'adminError', reason: 'Cannot change map during a round' }));
    return;
  }
  
  switchMap(mapKey);
  broadcastGameState();
}

function handleEditTile(ws, playerId, message) {
  const player = game.players.get(playerId);
  if (!player) return;
  
  const tx = message.x;
  const ty = message.y;
  const value = parseInt(message.value);
  
  if (tx < 0 || ty < 0 || ty >= game.map.length || tx >= game.map[0].length) return;
  if (tx === 0 || ty === 0 || tx >= game.map[0].length - 1 || ty >= game.map.length - 1) return;
  
  // Update tile
  game.map[ty][tx] = value;
}

function switchWeapon(playerId, weaponKey) {
  const player = game.players.get(playerId);
  if (!player) return;
  
  // Allow switching to any unlocked weapon (gun always available, others unlock on pickup)
  if (CONSTANTS.WEAPONS[weaponKey] && player.unlockedWeapons.has(weaponKey)) {
    player.switchTo(weaponKey);
  }
}

function handleInput(ws, playerId, message) {
  const player = game.players.get(playerId);
  if (!player) return;
  
  // Store input for this tick
  player.input = {
    left: message.left || false,
    right: message.right || false,
    up: message.up || false,
    shoot: message.shoot || false,
    grapple: message.grapple || false,
    mouseX: message.mouseX || 0,
    mouseY: message.mouseY || 0,
  };
}

function handleChat(text) {
  console.log(`[CHAT] ${text}`);
  
  // Broadcast chat message to all clients
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'chat',
        text: text,
      }));
    }
  });
}

function respawnPlayer(playerId) {
  const player = game.players.get(playerId);
  if (!player) return;
  
  // Find a spawn point
  const spawn = game.spawnPoints[Math.floor(Math.random() * game.spawnPoints.length)];
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.health = CONSTANTS.PLAYER_MAX_HEALTH;
}

function sendInitialState(ws, playerId) {
  // Send map data (compressed as tile grid)
  const mapData = game.map.map(row => row.join(''));
  
  ws.send(JSON.stringify({
    type: 'init',
    playerId: playerId,
    mapWidth: CONSTANTS.WORLD_WIDTH,
    mapHeight: CONSTANTS.WORLD_HEIGHT,
    tileSize: CONSTANTS.TILE_SIZE,
    map: mapData,
    players: game.getPlayerStates(),
    items: game.getItems(),
    time: Date.now(),
  }));
}

function broadcastPlayerList() {
  const message = JSON.stringify({
    type: 'playerList',
    players: game.getPlayerStates(),
  });
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Game loop - runs at fixed tick rate
const TICK_INTERVAL = 1000 / CONSTANTS.SERVER_TICK_RATE;
let lastTick = Date.now();
let accumulator = 0;

function gameLoop() {
  const now = Date.now();
  const delta = now - lastTick;
  lastTick = now;
  accumulator += delta;
  
  // Process fixed timesteps
  while (accumulator >= TICK_INTERVAL) {
    const dt = TICK_INTERVAL / 1000;
    
    // Tick down round timer
    if (game.roundActive && game.roundTimer > 0) {
      game.roundTimer -= dt;
      
      if (game.roundTimer <= 0) {
        // Round ended — start voting
        game.startVoting();
        broadcastRoundEnd('Round over! Vote for the next map.');
      }
    }
    
    // Tick down vote timer
    if (game.votingActive && game.voteTimeLeft > 0) {
      game.voteTimeLeft -= dt;
      
      if (game.voteTimeLeft <= 0) {
        // Voting ended — resolve and pick next map
        const winner = game.resolveVotes();
        const nextMap = winner || currentMapName; // Keep current if no votes
        
        broadcastRoundEnd(`Voting ended. Next map: ${MAP_REGISTRY[nextMap]?.name || 'Current'}`);
        
        // Switch to winning map after a brief delay
        setTimeout(() => {
          switchMap(nextMap);
          game.endRound(nextMap);
          
          // Convert map data to array format for client
          const mapArray = [];
          for (let y = 0; y < game.map.length; y++) {
            let row = '';
            for (let x = 0; x < game.map[y].length; x++) {
              const tile = game.map[y][x];
              if (tile === 1) row += '1'; // Solid
              else if (tile === 2) row += '2'; // Water
              else if (tile === 3) row += '3'; // Lava
              else row += '0'; // Empty
            }
            mapArray.push(row);
          }
          
          // Tell all clients their player was re-added and they should respawn
          const players = game.getPlayerStates();
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ 
                type: 'mapSwitched',
                players: players,
                currentMap: currentMapName,
                map: mapArray,
              }));
            }
          });
        }, 3000);
      }
    }
    
    game.update(dt);
    accumulator -= TICK_INTERVAL;
  }
  
  // Broadcast state to all connected clients every frame
  broadcastGameState();
  
}

function broadcastGameState() {
  const gameState = game.getGameState();
  const state = {
    type: 'state',
    players: game.getPlayerStates(),
    projectiles: game.getProjectiles(),
    particles: game.getParticles(),
    items: game.getItems(),
    time: Date.now(),
    round: gameState.round,
    voting: gameState.voting,
    currentMap: currentMapName,
  };
  
  const message = JSON.stringify(state);
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastRoundEnd(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'roundEnd', message }));
    }
  });
}

// Start server
httpServer.listen(PORT, HOST, () => {
  console.log(`\n=== Teeworlds Clone Server ===`);
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`WebSocket endpoint: ws://${HOST}:${PORT}`);
  console.log('==============================\n');
  
  // Start game loop (use setInterval for Node.js compatibility)
  setInterval(gameLoop, TICK_INTERVAL);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  wss.clients.forEach(client => client.close());
  wss.close();
  httpServer.close(() => process.exit(0));
});
