// Game engine - handles physics, collision, game loop
import { CONSTANTS, createDefaultItems } from '../shared/constants.js';

const { TILE_EMPTY, TILE_SOLID, TILE_WATER, TILE_LAVA, PLAYER_RADIUS, TILE_AMMO, TILE_HEALTH } = CONSTANTS;

// DEBUG
export class GameEngine {
  constructor(map) {
    this.map = map;
    this.players = new Map(); // playerId -> Player
    this.projectiles = [];    // Array of active projectiles
    this.particles = [];      // Explosion/death particles
    this.spawnPoints = [];    // Predefined spawn locations
    this.items = [];          // Item pickups on the map
    this.time = 0;
    
    this._generateSpawns();
    this._loadItems();
  }
  
  _loadItems() {
    const items = createDefaultItems();
    for (const item of items) {
      this.items.push({
        id: Math.random().toString(36).substr(2, 9),
        x: item.x,
        y: item.y,
        type: item.type, // 'ammo' or 'health'
        respawnTimer: 0,
        active: true,
      });
    }
  }
  
  _respawnItem(itemId) {
    const item = this.items.find(i => i.id === itemId);
    if (item) {
      item.active = true;
      item.respawnTimer = 15; // Respawn after 15 seconds
    }
  }
  
  _generateSpawns() {
    const w = this.map[0].length;
    const h = this.map.length;
    
    // Ground level is at row (h - 6), so spawn on top of ground
    const groundY = (h - 7) * CONSTANTS.TILE_SIZE;
    
    // Generate spawn points on ground level, spread across the map
    const spawns = [
      { x: 10 * CONSTANTS.TILE_SIZE, y: groundY },
      { x: (w / 4) * CONSTANTS.TILE_SIZE, y: groundY },
      { x: (w / 2) * CONSTANTS.TILE_SIZE, y: groundY },
      { x: (3 * w / 4) * CONSTANTS.TILE_SIZE, y: groundY },
      { x: (w - 10) * CONSTANTS.TILE_SIZE, y: groundY },
    ];
    
    this.spawnPoints = spawns;
  }
  
  addPlayer(id, name, team = 1) {
    if (this.players.has(id)) return null;
    
    // Find a spawn point that isn't too crowded
    let spawn = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
    
    const player = new Player(id, name, team, spawn.x, spawn.y);
    this.players.set(id, player);
    return player;
  }
  
  removePlayer(id) {
    const player = this.players.get(id);
    if (player) {
      // Create death particles
      for (let i = 0; i < 30; i++) {
        this.particles.push(new Particle(
          player.x, player.y,
          (Math.random() - 0.5) * 400,
          (Math.random() - 0.5) * 400,
          1.0,
          '#ff6600'
        ));
      }
      this.players.delete(id);
    }
  }
  
  getProjectile(id) {
    return this.projectiles.find(p => p.id === id);
  }
  
  shoot(playerId, angle) {
    const player = this.players.get(playerId);
    if (!player || !player.canShoot()) return null;
    
    player.lastShot = this.time;
    
    // Spawn projectile further from player to avoid spawning inside walls
    let spawnDist = PLAYER_RADIUS * 2.5;
    let spawnX = player.x + Math.cos(angle) * spawnDist;
    let spawnY = player.y + Math.sin(angle) * spawnDist;
    
    // If spawn point is inside a solid tile, push it out along the angle
    for (let d = 0; d < PLAYER_RADIUS * 3; d += 4) {
      const tx = player.x + Math.cos(angle) * d;
      const ty = player.y + Math.sin(angle) * d;
      if (!this._checkCollision(tx, ty, 2)) {
        spawnX = tx;
        spawnY = ty;
        break;
      }
    }
    
    // Create projectile from safe spawn position
    const proj = new Projectile(spawnX, spawnY, angle, playerId);
    
    this.projectiles.push(proj);
    console.log("[DEBUG] Projectile created at (" + Math.round(proj.x) + "," + Math.round(proj.y) + ") angle=" + (angle * 180 / Math.PI).toFixed(1) + "°");
    return proj;
  }
  
  update(dt) {
    this.time += dt;
    
    // Update players
    for (const [id, player] of this.players) {
      this._updatePlayer(player, dt);
    }
    
    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      
      if (!this._updateProjectile(proj, dt)) {
        // Create explosion particles
        this._createExplosion(proj.x, proj.y);
        this.projectiles.splice(i, 1);
        
        // Check for hits on nearby players
        this._checkProjectileHit(proj);
      }
    }
    
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
    
    // Clean up old projectiles that are off-map or too old
    const maxProjLife = 5; // seconds
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.time - this.projectiles[i].spawnTime > maxProjLife) {
        this._createExplosion(this.projectiles[i].x, this.projectiles[i].y);
        this.projectiles.splice(i, 1);
      }
    }
    
    // Respawn items that have been picked up
    for (const item of this.items) {
      if (!item.active && item.respawnTimer > 0) {
        item.respawnTimer -= dt;
        if (item.respawnTimer <= 0) {
          item.active = true;
        }
      }
    }
  }
  
  _updatePlayer(player, dt) {
    // Apply input
    const input = player.input;
    
    if (input) {
      // Horizontal movement
      let moveX = 0;
      if (input.left) moveX -= 1;
      if (input.right) moveX += 1;
      
      // Apply acceleration
      if (moveX !== 0) {
        player.vx += moveX * CONSTANTS.PLAYER_ACCEL * dt;
        
        // Clamp to max speed
        const maxSpeed = CONSTANTS.PLAYER_SPEED;
        if (player.vx > maxSpeed) player.vx = maxSpeed;
        if (player.vx < -maxSpeed) player.vx = -maxSpeed;
      } else {
        // Apply friction when no input
        player.vx *= Math.pow(CONSTANTS.PLAYER_FRICTION, dt * 60);
        if (Math.abs(player.vx) < 1) player.vx = 0;
      }
      
      // Jumping
      if (input.up && player.grounded) {
        player.vy = CONSTANTS.PLAYER_JUMP_FORCE;
        player.grounded = false;
      }
    }
    
    // Apply gravity
    player.vy += CONSTANTS.PLAYER_GRAVITY * dt;
    
    // Terminal velocity
    if (player.vy > 800) player.vy = 800;
    
    // Move X with collision
    const newX = player.x + player.vx * dt;
    if (!this._checkCollision(newX, player.y, PLAYER_RADIUS)) {
      player.x = newX;
    } else {
      player.vx = 0;
    }
    
    // Move Y with collision
    const newY = player.y + player.vy * dt;
    if (!this._checkCollision(player.x, newY, PLAYER_RADIUS)) {
      player.y = newY;
      player.grounded = false;
    } else {
      if (player.vy > 0) {
        player.grounded = true;
        // Snap to top of ground tile - find the exact surface position
        const ts = CONSTANTS.TILE_SIZE;
        const bottomY = newY + PLAYER_RADIUS;
        const groundTileRow = Math.floor(bottomY / ts);
        if (groundTileRow >= 0 && groundTileRow < this.map.length) {
          const tileTop = groundTileRow * ts - PLAYER_RADIUS;
          player.y = tileTop;
        } else {
          player.y = newY - PLAYER_RADIUS;
        }
      }
      player.vy = 0;
    }
    
    // Keep in bounds
    const worldW = CONSTANTS.WORLD_WIDTH * CONSTANTS.TILE_SIZE;
    const worldH = CONSTANTS.WORLD_HEIGHT * CONSTANTS.TILE_SIZE;
    player.x = Math.max(PLAYER_RADIUS, Math.min(worldW - PLAYER_RADIUS, player.x));
    player.y = Math.max(PLAYER_RADIUS, Math.min(worldH - PLAYER_RADIUS, player.y));
    
    // Check for water/lava tiles
    const tileX = Math.floor(player.x / CONSTANTS.TILE_SIZE);
    const tileY = Math.floor(player.y / CONSTANTS.TILE_SIZE);
    
    if (tileY >= 0 && tileY < this.map.length && tileX >= 0 && tileX < this.map[0].length) {
      const tile = this.map[tileY][tileX];
      
      if (tile === TILE_WATER) {
        // Slow movement in water
        player.vx *= 0.9;
        player.vy *= 0.9;
        
        // Can jump out of water but slower
        if (player.input && player.input.up) {
          player.vy = CONSTANTS.PLAYER_JUMP_FORCE * 0.5;
        }
      } else if (tile === TILE_LAVA) {
        // Take damage in lava
        player.health -= 30 * dt;
      }
    }
    
    // Apply friction on ground
    if (player.grounded && !input?.left && !input?.right) {
      player.vx *= Math.pow(0.9, dt * 60);
    }
    
    // Check item pickups
    for (const item of this.items) {
      if (!item.active) continue;
      
      const dx = player.x - item.x;
      const dy = player.y - item.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      // Pickup radius: slightly larger than player radius
      if (dist < PLAYER_RADIUS + 16) {
        if (item.type === 'ammo') {
          player.ammo = Math.min(CONSTANTS.WEAPON_MAX_AMMO, 
                                 player.ammo + CONSTANTS.WEAPON_PICKUP_AMOUNT);
        } else if (item.type === 'health') {
          player.health = Math.min(CONSTANTS.PLAYER_MAX_HEALTH,
                                   player.health + 30);
        }
        
        // Deactivate item and set respawn timer
        item.active = false;
        item.respawnTimer = 15; // Respawn after 15 seconds
        
        // Pickup particles
        for (let i = 0; i < 8; i++) {
          this.particles.push(new Particle(
            item.x, item.y,
            (Math.random() - 0.5) * 200,
            (Math.random() - 0.5) * 200,
            0.5,
            item.type === 'ammo' ? '#ffcc00' : '#4aff8b'
          ));
        }
      }
    }
    
    // Clamp health
    player.health = Math.max(0, Math.min(CONSTANTS.PLAYER_MAX_HEALTH, player.health));
    
    if (!player.input) return;
    
    // Update facing angle (from mouse position)
    const dx = player.input.mouseX - player.x;
    const dy = -(player.input.mouseY - player.y); // flip Y for screen coords
    player.facingAngle = Math.atan2(dy, dx);
    
    // Shooting (left click)
    if (player.input.shoot && player.canShoot(this.time)) {
      this.shoot(player.id, player.facingAngle);
      player.ammo--;
    }
    
    // Grappling hook (right click)
    if (player.input.grapple) {
      if (!player.grappleActive) {
        // Fire grapple - trace along ray to find valid anchor point
        const maxRange = 500;
        const step = 16;
        let hitX = player.x + Math.cos(player.facingAngle) * maxRange;
        let hitY = player.y + Math.sin(player.facingAngle) * maxRange;
        
        // Trace along the ray to find first non-collision point
        for (let d = 0; d < maxRange; d += step) {
          const tx = player.x + Math.cos(player.facingAngle) * d;
          const ty = player.y + Math.sin(player.facingAngle) * d;
          
          if (!this._checkCollision(tx, ty, 4)) {
            hitX = tx;
            hitY = ty;
            break; // Found a valid point
          }
        }
        
        player.grappleActive = true;
        player.grappleX = hitX;
        player.grappleY = hitY;
      } else {
        // Pull player toward grapple point
        const gdx = player.grappleX - player.x;
        const gdy = player.grappleY - player.y;
        const dist = Math.sqrt(gdx * gdx + gdy * gdy);
        
        if (dist > 20) {
          const pullStrength = 600; // grapple pull speed
          player.vx += (gdx / dist) * pullStrength * dt;
          player.vy += (gdy / dist) * pullStrength * dt;
          
          // Cap grapple velocity
          const maxGrappleSpeed = 500;
          const currentSpeed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
          if (currentSpeed > maxGrappleSpeed) {
            player.vx = (player.vx / currentSpeed) * maxGrappleSpeed;
            player.vy = (player.vy / currentSpeed) * maxGrappleSpeed;
          }
        } else {
          // Reached grapple point, detach
          player.grappleActive = false;
        }
      }
    } else {
      // Release grapple when not holding right click
      player.grappleActive = false;
    }
  }
  
  _checkCollision(x, y, radius) {
    // Check all tiles that the circle might overlap
    const minX = Math.floor((x - radius) / CONSTANTS.TILE_SIZE);
    const maxX = Math.floor((x + radius) / CONSTANTS.TILE_SIZE);
    const minY = Math.floor((y - radius) / CONSTANTS.TILE_SIZE);
    const maxY = Math.floor((y + radius) / CONSTANTS.TILE_SIZE);
    
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (ty < 0 || ty >= this.map.length || tx < 0 || tx >= this.map[0].length) {
          return true; // Out of bounds = solid
        }
        
        if (this.map[ty][tx] === TILE_SOLID) {
          // Check circle-rectangle collision for this tile
          const tileLeft = tx * CONSTANTS.TILE_SIZE;
          const tileRight = (tx + 1) * CONSTANTS.TILE_SIZE;
          const tileTop = ty * CONSTANTS.TILE_SIZE;
          const tileBottom = (ty + 1) * CONSTANTS.TILE_SIZE;
          
          if (this._circleRectCollision(x, y, radius, tileLeft, tileTop, tileRight, tileBottom)) {
            return true;
          }
        }
      }
    }
    
    return false;
  }
  
  _circleRectCollision(cx, cy, cr, rx1, ry1, rx2, ry2) {
    const closestX = Math.max(rx1, Math.min(cx, rx2));
    const closestY = Math.max(ry1, Math.min(cy, ry2));
    
    const dx = cx - closestX;
    const dy = cy - closestY;
    
    return (dx * dx + dy * dy) < (cr * cr);
  }
  
  _updateProjectile(proj, dt) {
    // Apply gravity to projectile
    proj.vy += CONSTANTS.WEAPON_NADE_GRAVITY * dt;
    
    // Move
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    
    console.log("[DEBUG] Proj moving to (" + Math.round(proj.x) + "," + Math.round(proj.y) + ") tile=(" + Math.floor(proj.x/64) + "," + Math.floor(proj.y/64) + ")");
    const tileX = Math.floor(proj.x / CONSTANTS.TILE_SIZE);
    const tileY = Math.floor(proj.y / CONSTANTS.TILE_SIZE);
    
    if (tileY < 0 || tileY >= this.map.length || 
        tileX < 0 || tileX >= this.map[0].length ||
        this.map[tileY][tileX] === TILE_SOLID) {
      return false; // Hit something
    }
    
    return true; // Still alive
  }
  
  _checkProjectileHit(proj) {
    const explosionRadius = CONSTANTS.TILE_SIZE * 2.5;
    
    for (const [id, player] of this.players) {
      if (player.id === proj.ownerId) continue; // Don't hit shooter
      
      const dx = player.x - proj.x;
      const dy = player.y - proj.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < explosionRadius + PLAYER_RADIUS) {
        // Damage based on distance from center
        const damage = Math.max(0, 100 * (1 - dist / (explosionRadius + PLAYER_RADIUS)));
        player.health -= damage;
        
        // Knockback
        const angle = Math.atan2(dy, dx);
        const knockbackForce = 500 * (1 - dist / (explosionRadius + PLAYER_RADIUS));
        player.vx += Math.cos(angle) * knockbackForce;
        player.vy += Math.sin(angle) * knockbackForce;
        
        // Check if killed
        if (player.health <= 0) {
          this.removePlayer(id);
        }
      }
    }
  }
  
  _createExplosion(x, y) {
    const count = 20 + Math.floor(Math.random() * 15);
    
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = 100 + Math.random() * 300;
      
      this.particles.push(new Particle(
        x, y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        0.5 + Math.random() * 0.8,
        ['#ff6600', '#ff9900', '#ffcc00', '#ffff66'][Math.floor(Math.random() * 4)]
      ));
    }
  }
  
  getPlayerStates() {
    const states = [];
    
    for (const player of this.players.values()) {
      states.push({
        id: player.id,
        name: player.name,
        team: player.team,
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        health: Math.max(0, player.health),
        ammo: player.ammo,
        facingAngle: player.facingAngle,
        score: player.score,
        grappleActive: player.grappleActive,
        grappleX: player.grappleX || 0,
        grappleY: player.grappleY || 0,
      });
    }
    
    return states;
  }
  
  getProjectiles() {
    return this.projectiles.map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      ownerId: p.ownerId,
    }));
  }
  
  getParticles() {
    return this.particles.map(p => ({
      x: p.x,
      y: p.y,
      life: p.life,
      color: p.color,
    }));
  }
  
  getItems() {
    return this.items.filter(i => i.active).map(item => ({
      id: item.id,
      x: item.x,
      y: item.y,
      type: item.type, // 'ammo' or 'health'
    }));
  }
}

class Player {
  constructor(id, name, team, x, y) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.health = CONSTANTS.PLAYER_MAX_HEALTH;
    this.ammo = CONSTANTS.WEAPON_MAX_AMMO;
    this.facingAngle = 0;
    this.score = 0;
    this.grounded = false;
    this.lastShot = -999;
    
    // Grappling hook state
    this.grappleActive = false;
    this.grappleX = 0;
    this.grappleY = 0;
    
    // Input buffer (set by client)
    this.input = null;
  }
  
  canShoot(gameTime) {
    return gameTime - this.lastShot >= CONSTANTS.WEAPON_FIRE_RATE && this.ammo > 0;
  }
}

class Projectile {
  constructor(x, y, angle, ownerId) {
    this.id = Math.random().toString(36).substr(2, 9);
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * CONSTANTS.WEAPON_NADE_SPEED;
    this.vy = Math.sin(angle) * CONSTANTS.WEAPON_NADE_SPEED;
    this.ownerId = ownerId;
    this.spawnTime = Date.now() / 1000;
  }
}

class Particle {
  constructor(x, y, vx, vy, life, color) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.color = color;
  }
}
