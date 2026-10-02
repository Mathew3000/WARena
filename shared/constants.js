// Shared constants for the WARena game

export const CONSTANTS = {
  // World dimensions (in tiles)
  WORLD_WIDTH: 200,
  WORLD_HEIGHT: 60,
  
  // Tile size in pixels
  TILE_SIZE: 64,
  
  // Player settings
  PLAYER_RADIUS: 18,
  PLAYER_SPEED: 280,        // pixels per second
  PLAYER_ACCEL: 1800,       // acceleration px/s²
  PLAYER_FRICTION: 0.85,    // ground friction multiplier per frame
  PLAYER_JUMP_FORCE: -480,  // jump velocity (negative = up)
  PLAYER_GRAVITY: 1200,     // gravity px/s²
  
  // Weapon settings (default gun)
  WEAPON_NADE_SPEED: 1400,   // projectile speed (fast shot)
  WEAPON_NADE_GRAVITY: 200,  // projectile gravity (slight arc at range)
  WEAPON_FIRE_RATE: 0.18,   // seconds between shots
  WEAPON_MAX_AMMO: 40,      // max ammo per weapon type
  WEAPON_PICKUP_AMOUNT: 25, // amount when picking up ammo
  
  // Weapon definitions
  WEAPONS: {
    gun: {
      name: 'Gun',
      damage: 18,
      fireRate: 0.35,
      speed: 1400,
      gravity: 200,
      maxAmmo: 10,
      pickupAmmo: 30,
      pellets: 1,           // number of projectiles per shot
      spread: 0,            // angle spread in radians (0 = straight)
      explosive: false,     // AoE damage on hit
      explosionRadius: 0,
      instantHit: false,    // hitscan instead of projectile
      color: '#ffcc00',
      trailColor: 'rgba(255, 204, 0, 0.3)',
      size: 4,              // projectile visual size
    },
    shotgun: {
      name: 'Shotgun',
      damage: 12,           // per pellet
      fireRate: 0.7,        // slow between shots
      speed: 900,
      gravity: 400,
      maxAmmo: 16,
      pickupAmmo: 8,
      pellets: 5,           // 5 pellets per shot
      spread: 0.15,         // wide spread
      explosive: false,
      explosionRadius: 0,
      instantHit: false,
      color: '#ff8844',
      trailColor: 'rgba(255, 136, 68, 0.3)',
      size: 3,
    },
    rocket: {
      name: 'Rocket Launcher',
      damage: 65,
      fireRate: 0.9,        // very slow
      speed: 550,           // slower projectile
      gravity: 80,
      maxAmmo: 8,
      pickupAmmo: 4,
      pellets: 1,
      spread: 0,
      explosive: true,      // AoE explosion on impact
      explosionRadius: 80,  // pixel radius of explosion
      instantHit: false,
      color: '#ff4444',
      trailColor: 'rgba(255, 68, 68, 0.4)',
      size: 6,
    },
    minigun: {
      name: 'Minigun',
      damage: 8,
      fireRate: 0.06,       // very fast
      speed: 1600,
      gravity: 100,
      maxAmmo: 120,
      pickupAmmo: 50,
      pellets: 1,
      spread: 0.06,         // slight spread for auto-fire feel
      explosive: false,
      explosionRadius: 0,
      instantHit: false,
      color: '#44ff88',
      trailColor: 'rgba(68, 255, 136, 0.2)',
      size: 3,
    },
    laser: {
      name: 'Laser',
      damage: 45,
      fireRate: 0.5,
      speed: 0,             // instant hit
      gravity: 0,
      maxAmmo: 12,
      pickupAmmo: 6,
      pellets: 1,
      spread: 0.01,         // nearly perfect accuracy
      explosive: false,
      explosionRadius: 0,
      instantHit: true,     // hitscan
      color: '#44aaff',
      trailColor: 'rgba(68, 170, 255, 0.6)',
      size: 2,
    },
  },

  // Weapon pickup tile types (separate from ammo/health)
  TILE_WEAPON_GUN: 10,
  TILE_WEAPON_SHOTGUN: 11,
  TILE_WEAPON_ROCKET: 12,
  TILE_WEAPON_MINIGUN: 13,
  TILE_WEAPON_LASER: 14,

  // Health
  PLAYER_MAX_HEALTH: 100,
  
  // Game settings
  SERVER_TICK_RATE: 60,     // server updates per second
  CLIENT_RESEND_DELTA: 3,   // ticks before client resends input
  
  // Colors (Teeworlds-inspired)
  COLORS: {
    sky_top: '#1a1a2e',
    sky_bottom: '#16213e',
    ground: '#4a7c59',
    ground_dark: '#3d6b4e',
    wall: '#8b7355',
    wall_light: '#a0896b',
    wall_shadow: '#6b5741',
    water: 'rgba(64, 164, 223, 0.5)',
    player_team_blue: '#4a9eff',
    player_team_red: '#ff4a4a',
    player_team_green: '#4aff8b',
    player_team_yellow: '#ffff4a',
    projectile: '#ffcc00',
    explosion: '#ff6600',
  },
  
  // Team colors
  TEAM_COLORS: {
    0: '#aaaaaa',   // Spectator/No team
    1: '#4a9eff',   // Blue
    2: '#ff4a4a',   // Red
    3: '#4aff8b',   // Green
    4: '#ffff4a',   // Yellow
  },
  
  // Map tile types
  TILE_EMPTY: 0,
  TILE_SOLID: 1,
  TILE_WATER: 2,
  TILE_LAVA: 3,

  // Item pickup types (stored as special tiles in map)
  TILE_AMMO: 4,
  TILE_HEALTH: 5,
};

// Item definitions
export const ITEM_TYPES = {
  AMMO: 'ammo',
  HEALTH: 'health',
  WEAPON_GUN: 'weapon_gun',
  WEAPON_SHOTGUN: 'weapon_shotgun',
  WEAPON_ROCKET: 'weapon_rocket',
  WEAPON_MINIGUN: 'weapon_minigun',
  WEAPON_LASER: 'weapon_laser',
};

// Weapon name lookup for display
export const WEAPON_NAMES = {
  weapon_gun: 'Gun',
  weapon_shotgun: 'Shotgun',
  weapon_rocket: 'Rocket Launcher',
  weapon_minigun: 'Minigun',
  weapon_laser: 'Laser',
};

// Default map layout with ramps and reachable platforms
export function createDefaultMap() {
  const width = CONSTANTS.WORLD_WIDTH;
  const height = CONSTANTS.WORLD_HEIGHT;
  const map = [];
  
  for (let y = 0; y < height; y++) {
    map[y] = [];
    for (let x = 0; x < width; x++) {
      // Border walls
      if (x === 0 || y === 0 || x >= width - 1 || y >= height - 1) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      } 
      // Floor with gaps (lava pits between sections)
      else if (y >= height - 6 && x > 5 && x < width - 6) {
        // Ground floor, but add lava pits at intervals
        const pitStart = 40 + Math.floor((x - 5) / 30) * 12;
        const pitEnd = pitStart + 8;
        if (x >= pitStart && x <= pitEnd) {
          map[y][x] = CONSTANTS.TILE_LAVA;
        } else {
          map[y][x] = CONSTANTS.TILE_SOLID;
        }
      }
      // Lower platform with ramp on left side
      else if (y === height - 14 && x > 25 && x < width / 2 - 10) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Ramp to lower platform (left side)
      else if (y >= height - 20 && y <= height - 14 
               && x > 15 && x < 26) {
        const rampProgress = (x - 15);
        const rampY = height - 20 + rampProgress;
        if (y === rampY) map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Upper platform with ramp on right side  
      else if (y === height - 22 && x > width / 2 + 10 && x < width - 30) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Ramp to upper platform (right side)
      else if (y >= height - 28 && y <= height - 22 
               && x > width / 2 + 1 && x < width / 2 + 10) {
        const rampProgress = (x - (width / 2 + 1));
        const rampY = height - 28 + rampProgress;
        if (y === rampY) map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Center elevated platform with stairs
      else if (y >= height - 30 && y <= height - 26 
               && x > width / 2 - 8 && x < width / 2 + 9) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Stairs to center platform (left side)
      else if (y >= height - 36 && y <= height - 30 
               && x > width / 2 - 14 && x < width / 2 - 7) {
        const stairProgress = (x - (width / 2 - 14));
        const stairY = height - 36 + stairProgress;
        if (y === stairY) map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Stairs to center platform (right side)
      else if (y >= height - 36 && y <= height - 30 
               && x > width / 2 + 7 && x < width / 2 + 14) {
        const stairProgress = (x - (width / 2 + 7));
        const stairY = height - 36 + stairProgress;
        if (y === stairY) map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Walls for cover on ground level
      else if ((x === 50 || x === width / 2 - 18) && y > height - 14 && y < height - 6) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Walls for cover on upper platform
      else if ((x === width / 2 + 5 || x === width / 2 + 20) 
               && y > height - 30 && y < height - 26) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Cover walls near spawn points (for grappling hooks)
      else if ((x === 15 || x === 20) && y > height - 20 && y < height - 6) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else if ((x === width / 4 - 5 || x === width / 4 + 5) 
               && y > height - 14 && y < height - 6) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else if ((x === (3 * width / 4) - 5 || x === (3 * width / 4) + 5) 
               && y > height - 14 && y < height - 6) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Vertical pillars on platforms for grappling
      else if ((x === 30 || x === 40) && y >= height - 20 && y <= height - 14) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else if ((x === width / 2 + 15 || x === width / 2 + 25) 
               && y >= height - 28 && y <= height - 22) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Water pool on lower platform
      else if (y === height - 15 && x > 40 && x < 55) {
        map[y][x] = CONSTANTS.TILE_WATER;
      }
      else {
        map[y][x] = CONSTANTS.TILE_EMPTY;
      }
    }
  }
  
  return map;
}

// Item pickup positions (tile coordinates)
export function createDefaultItems() {
  const h = CONSTANTS.WORLD_HEIGHT;
  const w = CONSTANTS.WORLD_WIDTH;
  return [
    // Ground level ammo pickups
    { x: 20 * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.AMMO },
    { x: 60 * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.AMMO },
    { x: 100 * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.HEALTH },
    { x: 140 * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.AMMO },
    { x: 180 * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.HEALTH },
    
    // Lower platform items
    { x: 35 * CONSTANTS.TILE_SIZE, y: (h - 15) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.AMMO },
    { x: 70 * CONSTANTS.TILE_SIZE, y: (h - 15) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.HEALTH },
    
    // Upper platform items
    { x: (w / 2 + 30) * CONSTANTS.TILE_SIZE, y: (h - 23) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.AMMO },
    { x: (w / 2 + 50) * CONSTANTS.TILE_SIZE, y: (h - 23) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.HEALTH },
    
    // Center elevated platform items
    { x: (w / 2 - 3) * CONSTANTS.TILE_SIZE, y: (h - 31) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.AMMO },
    { x: (w / 2 + 3) * CONSTANTS.TILE_SIZE, y: (h - 31) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.HEALTH },
    
    // Ramp top items
    { x: 24 * CONSTANTS.TILE_SIZE, y: (h - 15) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.AMMO },
    { x: (w / 2 + 8) * CONSTANTS.TILE_SIZE, y: (h - 23) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.HEALTH },
    
    // Weapon pickups - placed on elevated/strategic positions
    { x: 45 * CONSTANTS.TILE_SIZE, y: (h - 15) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_SHOTGUN },   // Lower platform - close combat
    { x: (w / 2 + 35) * CONSTANTS.TILE_SIZE, y: (h - 23) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_ROCKET }, // Upper platform - long range
    { x: (w / 2 - 1) * CONSTANTS.TILE_SIZE, y: (h - 31) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_MINIGUN }, // Center elevated - mid control
    { x: 80 * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_LASER },   // Ground level - power pickup
  ];
}

// ─── Map Registry ──────────────────────────────────────────────────────

/**
 * Generate a simple arena map with open space and some cover
 */
function createArenaMap() {
  const w = CONSTANTS.WORLD_WIDTH;
  const h = CONSTANTS.WORLD_HEIGHT;
  const map = [];
  
  for (let y = 0; y < h; y++) {
    map[y] = [];
    for (let x = 0; x < w; x++) {
      // Border walls
      if (x === 0 || y === 0 || x >= w - 1 || y >= h - 1) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Floor
      else if (y >= h - 6) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Central platform
      else if (y === h - 14 && x > w/2 - 15 && x < w/2 + 15) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Cover pillars at cardinal points
      else if ((x === 30 || x === w - 30) && y > h - 14 && y < h - 6) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else if (y === h - 10 && (x === w/2 - 25 || x === w/2 + 25)) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Ramps on sides
      else if (y >= h - 20 && y <= h - 14 && x > 10 && x < 25) {
        const prog = (x - 10);
        if (y === h - 20 + prog) map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else if (y >= h - 20 && y <= h - 14 && x > w - 25 && x < w - 10) {
        const prog = (w - 10 - x);
        if (y === h - 20 + prog) map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else {
        map[y][x] = CONSTANTS.TILE_EMPTY;
      }
    }
  }
  
  return map;
}

/**
 * Generate a canyon map with narrow passages and verticality
 */
function createCanyonMap() {
  const w = CONSTANTS.WORLD_WIDTH;
  const h = CONSTANTS.WORLD_HEIGHT;
  const map = [];
  
  for (let y = 0; y < h; y++) {
    map[y] = [];
    for (let x = 0; x < w; x++) {
      // Border walls
      if (x === 0 || y === 0 || x >= w - 1 || y >= h - 1) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Canyon walls on sides (narrow passage in middle)
      else if (x < 25 && y > h - 30) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else if (x >= w - 25 && y > h - 30) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Floor with lava gaps
      else if (y >= h - 6) {
        const pitStart = 50 + Math.floor(x / 40) * 15;
        if (x >= pitStart && x <= pitStart + 6 && x > 30 && x < w - 30) {
          map[y][x] = CONSTANTS.TILE_LAVA;
        } else {
          map[y][x] = CONSTANTS.TILE_SOLID;
        }
      }
      // Platforms at various heights across the canyon
      else if (y === h - 14 && x > 25 && x < w/2 - 30) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else if (y === h - 18 && x > w/2 + 30 && x < w - 25) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Upper platforms
      else if (y === h - 24 && x > 30 && x < w/2 - 40) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else if (y === h - 28 && x > w/2 + 40 && x < w - 30) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Connecting ramps
      else if (y >= h - 20 && y <= h - 14 && x > w/2 - 35 && x < w/2 - 28) {
        const prog = (x - (w/2 - 35));
        if (y === h - 20 + prog * 1.2) map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else if (y >= h - 24 && y <= h - 18 && x > w/2 + 28 && x < w/2 + 35) {
        const prog = (x - (w/2 + 28));
        if (y === h - 24 + prog * 1.2) map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Staircase sections
      else if (y >= h - 36 && y <= h - 28 && x > 35 && x < 45) {
        const stairProg = (x - 35);
        if (y === h - 36 + stairProg * 1) map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else if (y >= h - 36 && y <= h - 28 && x > w - 45 && x < w - 35) {
        const stairProg = (w - 35 - x);
        if (y === h - 36 + stairProg * 1) map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else {
        map[y][x] = CONSTANTS.TILE_EMPTY;
      }
    }
  }
  
  return map;
}

/**
 * Generate a fortress map with multiple levels and towers
 */
function createFortressMap() {
  const w = CONSTANTS.WORLD_WIDTH;
  const h = CONSTANTS.WORLD_HEIGHT;
  const map = [];
  
  for (let y = 0; y < h; y++) {
    map[y] = [];
    for (let x = 0; x < w; x++) {
      // Border walls
      if (x === 0 || y === 0 || x >= w - 1 || y >= h - 1) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Floor
      else if (y >= h - 6) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Corner towers
      else if ((x > 5 && x < 20 && y > h - 20 && y < h - 6) ||
               (x > w - 20 && x < w - 5 && y > h - 20 && y < h - 6)) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Tower tops
      else if ((x >= 5 && x <= 20 || x >= w - 20 && x <= w - 5) && y === h - 20) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Bridge between towers
      else if (y === h - 18 && x > 20 && x < w - 20) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Bridge supports
      else if (y > h - 20 && y < h - 6 && (x === 50 || x === w/2 || x === w - 50)) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Central keep
      else if (x > w/2 - 10 && x < w/2 + 10 && y > h - 16 && y < h - 6) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Keep walls
      else if ((x === w/2 - 10 || x === w/2 + 10) && y > h - 24 && y < h - 6) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else if (y === h - 24 && x >= w/2 - 10 && x <= w/2 + 10) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Side platforms with ramps
      else if (y === h - 12 && x > 30 && x < 45) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else if (y === h - 12 && x > w - 45 && x < w - 30) {
        map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Ramps to side platforms
      else if (y >= h - 18 && y <= h - 12 && x > 25 && x < 31) {
        const prog = (x - 25);
        if (y === h - 18 + prog) map[y][x] = CONSTANTS.TILE_SOLID;
      }
      else if (y >= h - 18 && y <= h - 12 && x > w - 31 && x < w - 25) {
        const prog = (w - 25 - x);
        if (y === h - 18 + prog) map[y][x] = CONSTANTS.TILE_SOLID;
      }
      // Water moat around keep
      else if (y === h - 7 && x > w/2 - 14 && x < w/2 + 14) {
        map[y][x] = CONSTANTS.TILE_WATER;
      }
      else {
        map[y][x] = CONSTANTS.TILE_EMPTY;
      }
    }
  }
  
  return map;
}

// Map definitions registry
export const MAP_REGISTRY = {
  default: {
    name: 'Classic Arena',
    description: 'The original Teeworlds-style arena with ramps and platforms',
    generator: createDefaultMap,
    items: createDefaultItems,
  },
  arena: {
    name: 'Open Arena',
    description: 'Wide open space with minimal cover — pure skill',
    generator: createArenaMap,
    items: () => {
      const w = CONSTANTS.WORLD_WIDTH;
      const h = CONSTANTS.WORLD_HEIGHT;
      return [
        { x: 10 * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.AMMO },
        { x: (w/2) * CONSTANTS.TILE_SIZE, y: (h - 15) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.HEALTH },
        { x: (w - 10) * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.AMMO },
        { x: 45 * CONSTANTS.TILE_SIZE, y: (h - 15) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_SHOTGUN },
        { x: (w/2 + 35) * CONSTANTS.TILE_SIZE, y: (h - 15) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_ROCKET },
        { x: (w/2 - 1) * CONSTANTS.TILE_SIZE, y: (h - 15) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_MINIGUN },
        { x: 80 * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_LASER },
      ];
    },
  },
  canyon: {
    name: 'Canyon Pass',
    description: 'Narrow passages with lava gaps and vertical gameplay',
    generator: createCanyonMap,
    items: () => {
      const w = CONSTANTS.WORLD_WIDTH;
      const h = CONSTANTS.WORLD_HEIGHT;
      return [
        { x: 15 * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.AMMO },
        { x: (w/2) * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.HEALTH },
        { x: (w - 15) * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.AMMO },
        { x: 35 * CONSTANTS.TILE_SIZE, y: (h - 15) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_SHOTGUN },
        { x: (w/2 + 40) * CONSTANTS.TILE_SIZE, y: (h - 19) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_ROCKET },
        { x: 40 * CONSTANTS.TILE_SIZE, y: (h - 25) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_MINIGUN },
        { x: (w - 40) * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_LASER },
      ];
    },
  },
  fortress: {
    name: 'Fortress Siege',
    description: 'Multi-level fortress with towers and a central keep',
    generator: createFortressMap,
    items: () => {
      const w = CONSTANTS.WORLD_WIDTH;
      const h = CONSTANTS.WORLD_HEIGHT;
      return [
        { x: 12 * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.AMMO },
        { x: (w/2) * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.HEALTH },
        { x: (w - 12) * CONSTANTS.TILE_SIZE, y: (h - 7) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.AMMO },
        { x: 35 * CONSTANTS.TILE_SIZE, y: (h - 19) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_SHOTGUN },
        { x: (w/2 + 5) * CONSTANTS.TILE_SIZE, y: (h - 25) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_ROCKET },
        { x: (w - 35) * CONSTANTS.TILE_SIZE, y: (h - 19) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_MINIGUN },
        { x: (w/2) * CONSTANTS.TILE_SIZE, y: (h - 19) * CONSTANTS.TILE_SIZE, type: ITEM_TYPES.WEAPON_LASER },
      ];
    },
  },
};

// Get a map by name
export function getMap(name) {
  return MAP_REGISTRY[name] || MAP_REGISTRY.default;
}

// List all available map keys
export function getAvailableMaps() {
  return Object.keys(MAP_REGISTRY).map(key => ({
    key,
    ...MAP_REGISTRY[key],
  }));
}
