// Game engine - handles physics, collision, game loop
import { CONSTANTS, createDefaultItems, ITEM_TYPES, MAP_REGISTRY } from '../shared/constants.js';

const { TILE_EMPTY, TILE_SOLID, TILE_WATER, TILE_LAVA, PLAYER_RADIUS, TILE_AMMO, TILE_HEALTH, WEAPONS } = CONSTANTS;

// Reference to current map name (set in server/index.js)
let currentMapName = 'default';

export class GameEngine {
  constructor(map) {
    // Normalize map: ensure every cell is a number and rows are consistent length
    const w = CONSTANTS.WORLD_WIDTH;
    const h = CONSTANTS.WORLD_HEIGHT;
    this.map = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) {
        const val = map[y] && map[y][x] != null ? parseInt(map[y][x], 10) : TILE_EMPTY;
        row.push(isNaN(val) ? TILE_EMPTY : val);
      }
      this.map.push(row);
    }
    this.players = new Map(); // playerId -> Player
    this.projectiles = [];    // Array of active projectiles
    this.particles = [];      // Explosion/death particles
    this.spawnPoints = [];    // Predefined spawn locations
    this.items = [];          // Item pickups on the map
    this.time = 0;
    
    // Round timer (seconds remaining, 0 = round ended)
    this.roundTimer = 300;     // 5 minutes per round
    this.roundDuration = 300;  // Original configured duration for display
    this.roundActive = true;
    
    // Map voting system
    this.votingActive = false;
    this.voteTimeLeft = 0;
    this.votes = new Map();    // playerId -> votedMapKey
    
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
    
    // First player becomes admin
    const isFirstPlayer = this.players.size === 0;
    
    // Find a spawn point that isn't too crowded
    let spawn = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
    
    const player = new Player(id, name, team, spawn.x, spawn.y);
    if (isFirstPlayer) {
      player.isAdmin = true;
    }
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
    if (!player) return null;
    
    // canShoot was already checked in _updatePlayer before calling shoot()
    const weapon = player.getWeapon();
    player.lastShot = this.time;
    
    // Deduct ammo from the active weapon
    player.weapons[player.activeWeapon] = (player.weapons[player.activeWeapon] || 0) - 1;
    
    // Handle instant hit weapons (laser/railgun)
    if (weapon.instantHit) {
      this._shootInstantHit(player, angle, weapon);
      return null;
    }
    
    // Handle multi-pellet weapons (shotgun)
    const pelletCount = weapon.pellets || 1;
    for (let i = 0; i < pelletCount; i++) {
      let pelletAngle = angle;
      if (weapon.spread > 0) {
        // Spread pellets evenly across the spread cone, plus slight random offset
        const spreadCenter = (i / (pelletCount - 1 || 1)) * 2 - 1; // -1 to 1
        pelletAngle += weapon.spread * spreadCenter + (Math.random() - 0.5) * weapon.spread * 0.3;
      }
      
      let spawnDist = PLAYER_RADIUS * 2.5;
      let spawnX = player.x + Math.cos(pelletAngle) * spawnDist;
      let spawnY = player.y + Math.sin(pelletAngle) * spawnDist;
      
      // If spawn point is inside a solid tile, push it out along the angle
      for (let d = 0; d < PLAYER_RADIUS * 3; d += 4) {
        const tx = player.x + Math.cos(pelletAngle) * d;
        const ty = player.y + Math.sin(pelletAngle) * d;
        if (!this._checkCollision(tx, ty, 2)) {
          spawnX = tx;
          spawnY = ty;
          break;
        }
      }
      
      const proj = new Projectile(spawnX, spawnY, pelletAngle, playerId, weapon);
      this.projectiles.push(proj);
    }
    
    return null;
  }
  
  _shootInstantHit(player, angle, weapon) {
    // Laser: instant hitscan - find first solid tile hit and deal damage along the path
    const maxDist = 2000; // Max range for laser
    const step = 8;
    
    for (let d = 0; d < maxDist; d += step) {
      const checkX = player.x + Math.cos(angle) * d;
      const checkY = player.y + Math.sin(angle) * d;
      
      // Check map collision
      const tileX = Math.floor(checkX / CONSTANTS.TILE_SIZE);
      const tileY = Math.floor(checkY / CONSTANTS.TILE_SIZE);
      
      if (tileY < 0 || tileY >= this.map.length || 
          tileX < 0 || tileX >= this.map[0].length ||
          this.map[tileY][tileX] !== TILE_EMPTY) {
        // Hit a wall - create impact particles at hit point
        this._createExplosion(checkX, checkY, weapon.color);
        return;
      }
      
      // Check player hits
      for (const [id, target] of this.players) {
        if (target.id === player.id) continue;
        
        const dx = target.x - checkX;
        const dy = target.y - checkY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < PLAYER_RADIUS + 5) {
          // Hit! Deal damage and create impact effect
          const prevHealth = target.health;
          target.health -= weapon.damage;
          this._createExplosion(checkX, checkY, weapon.color);
          
          // Award kill points to shooter
          if (prevHealth > 0 && target.health <= 0) {
            player.score += 20;
          }
          
          // Small knockback
          const kbAngle = Math.atan2(dy, dx);
          target.vx += Math.cos(kbAngle) * 200;
          target.vy += Math.sin(kbAngle) * 200;
          return;
        }
      }
    }
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

    // Ground deadzone: when grounded with near-zero downward velocity, clamp vy to 0
    // This prevents vibration from tiny gravity drifts causing repeated collision/snap cycles
    // Use >= 0 to also catch vy === 0 (after snap), otherwise next frame no collision → grounded = false → repeat loop
    if (player.grounded && player.vy >= 0 && player.vy < 50) {
      player.vy = 0;
    }

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
        // Snap to top of ground tile — find the exact surface position above this tile
        const ts = CONSTANTS.TILE_SIZE;
        const bottomY = newY + PLAYER_RADIUS;
        const groundTileRow = Math.floor(bottomY / ts);
        if (groundTileRow >= 0 && groundTileRow < this.map.length) {
          // Snap flush with ground surface (no offset) — deadzone below prevents vibration
          player.y = groundTileRow * ts - PLAYER_RADIUS;
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
        let particleColor = '#ffcc00';
        
        if (item.type === 'ammo') {
          // Add ammo to current weapon's pool
          const weaponKey = player.activeWeapon;
          const maxAmmo = WEAPONS[weaponKey]?.maxAmmo || 40;
          player.weapons[weaponKey] = Math.min(maxAmmo, (player.weapons[weaponKey] || 0) + CONSTANTS.WEAPON_PICKUP_AMOUNT);
        } else if (item.type === 'health') {
          player.health = Math.min(CONSTANTS.PLAYER_MAX_HEALTH,
                                   player.health + 30);
          particleColor = '#4aff8b';
        } else if (item.type.startsWith('weapon_')) {
          // Weapon pickup: equip weapon and give ammo
          const weaponKey = item.type; // e.g., 'weapon_shotgun'
          const weaponName = weaponKey.replace('weapon_', ''); // e.g., 'shotgun'
          
          if (WEAPONS[weaponName]) {
            player.unlockedWeapons.add(weaponName);
            player.switchTo(weaponName);
            player.weapons[weaponName] = WEAPONS[weaponName].maxAmmo;
            particleColor = '#ff44ff';
          }
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
            particleColor
          ));
        }
      }
    }
    
    // Clamp health
    player.health = Math.max(0, Math.min(CONSTANTS.PLAYER_MAX_HEALTH, player.health));
    
    // Gun ammo slowly regenerates (1/sec) so player is never unarmed forever
    const gunMax = CONSTANTS.WEAPONS.gun.maxAmmo;
    if (player.activeWeapon === 'gun') {
      const currentGunAmmo = player.weapons.gun || 0;
      if (currentGunAmmo < gunMax) {
        player.weapons.gun = Math.min(gunMax, currentGunAmmo + 1.0 * dt);
      }
    } else if (player.unlockedWeapons.has('gun')) {
      // Also regen gun ammo even when using another weapon
      const currentGunAmmo = player.weapons.gun || 0;
      if (currentGunAmmo < gunMax) {
        player.weapons.gun = Math.min(gunMax, currentGunAmmo + 1.0 * dt);
      }
    }
    
    // Score: 1 point per second alive
    player.score += dt;
    
    if (!player.input) return;
    
    // Update facing angle (from mouse position)
    const dx = player.input.mouseX - player.x;
    const dy = player.input.mouseY - player.y; // same direction in world space (Y increases downward)
    player.facingAngle = Math.atan2(dy, dx);
    
    // Shooting (left click)
    if (player.input.shoot && player.canShoot(this.time)) {
      this.shoot(player.id, player.facingAngle);
      player.ammo--;
    }
    
    // Grappling hook (right click) - gradual extension then pull
    const GRAPPLE_EXTEND_SPEED = 700;   // rope extends at this speed (px/s)
    const GRAPPLE_MAX_RANGE = 800;      // max rope length
    
    if (player.input.grapple && player.grappleState === 'idle') {
      // Fire grapple: cast ray to find anchor point
      const step = 4;
      let anchorX, anchorY;
      let hitSomething = false;
      
      for (let d = 30; d < GRAPPLE_MAX_RANGE; d += step) {
        const checkX = player.x + Math.cos(player.facingAngle) * d;
        const checkY = player.y + Math.sin(player.facingAngle) * d;
        
        if (this._checkCollision(checkX, checkY, 2)) {
          anchorX = player.x + Math.cos(player.facingAngle) * (d - step);
          anchorY = player.y + Math.sin(player.facingAngle) * (d - step);
          hitSomething = true;
          break;
        }
      }
      
      if (hitSomething) {
        const distToAnchor = Math.sqrt(
          (anchorX - player.x) ** 2 + (anchorY - player.y) ** 2
        );
        
        player.grappleActive = true;
        player.grappleX = anchorX;
        player.grappleY = anchorY;
        player.grappleLength = 0;
        player.grappleMaxLen = distToAnchor;
        player.grappleState = 'extending';
      }
      // If nothing hit, rope just fires into empty space — stay idle
    } else if (player.grappleActive && player.input.grapple) {
      // Rope is active and player still holding right click
      
      if (player.grappleState === 'extending') {
        // Extend rope toward anchor at fixed speed
        player.grappleLength += GRAPPLE_EXTEND_SPEED * dt;
        
        if (player.grappleLength >= player.grappleMaxLen) {
          // Rope reached the anchor — start pulling
          player.grappleState = 'pulling';
        } else if (player.grappleLength >= GRAPPLE_MAX_RANGE) {
          // Max range reached, check if we're close enough to pull
          const distToAnchor = Math.sqrt(
            (player.grappleX - player.x) ** 2 + (player.grappleY - player.y) ** 2
          );
          if (distToAnchor <= GRAPPLE_MAX_RANGE) {
            player.grappleState = 'pulling';
          } else {
            // Too far, start retracting
            player.grappleState = 'retracting';
          }
        }
      }
      
      if (player.grappleState === 'pulling') {
        // Pull player toward grapple anchor point - Teeworlds style strong pull
        const gdx = player.grappleX - player.x;
        const gdy = player.grappleY - player.y;
        const dist = Math.sqrt(gdx * gdx + gdy * gdy);
        
        if (dist > 15) {
          // Strong direct pull toward anchor
          const pullSpeed = 800;
          
          player.vx += (gdx / dist) * pullSpeed * dt * 4;
          player.vy += (gdy / dist) * pullSpeed * dt * 4;
          
          // Reduced gravity for upward swinging
          player.vy += CONSTANTS.PLAYER_GRAVITY * dt * 0.3;
          
          // Cap velocity for big swings
          const maxSpeed = 900;
          const currentSpeed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
          if (currentSpeed > maxSpeed) {
            player.vx = (player.vx / currentSpeed) * maxSpeed;
            player.vy = (player.vy / currentSpeed) * maxSpeed;
          }
        } else {
          // Reached anchor point — stop pulling but stay anchored
          player.vx *= 0.2;
          player.vy *= 0.2;
        }
      }
      
      if (player.grappleState === 'retracting') {
        // Retract rope back to player
        player.grappleLength -= GRAPPLE_EXTEND_SPEED * dt * 2;
        
        if (player.grappleLength <= 0) {
          player.grappleActive = false;
          player.grappleLength = 0;
          player.grappleState = 'idle';
        }
      }
    } else {
      // Release grapple when not holding right click — retract then idle
      if (player.grappleActive && player.grappleState !== 'idle') {
        player.grappleState = 'retracting';
      }
      
      if (!player.input.grapple) {
        if (player.grappleState === 'retracting' || !player.grappleActive) {
          player.grappleActive = false;
          player.grappleLength = 0;
          player.grappleState = 'idle';
        }
      }
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
        
        if (this.map[ty][tx] !== TILE_EMPTY) {
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
    // Apply weapon-specific gravity to projectile
    if (proj.gravity > 0) {
      proj.vy += proj.gravity * dt;
    }
    
    // Move
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    
    // Check map collision
    const tileX = Math.floor(proj.x / CONSTANTS.TILE_SIZE);
    const tileY = Math.floor(proj.y / CONSTANTS.TILE_SIZE);
    
    if (tileY < 0 || tileY >= this.map.length || 
        tileX < 0 || tileX >= this.map[0].length ||
        this.map[tileY][tileX] !== TILE_EMPTY) {
      // Explosive weapons create explosion on impact; non-explosive create small splatter
      if (proj.explosive && proj.explosionRadius > 0) {
        this._createExplosion(proj.x, proj.y, '#ff4444');
      } else if (proj.weapon?.name === 'Rocket Launcher') {
        // Rocket launcher impact — medium splash even before full explosion
        this._createSplatter(proj.x, proj.y, '#ff6600', 12);
      } else {
        // Small splatter for bullets/shotgun/minigun/laser (not rockets)
        this._createSplatter(proj.x, proj.y, proj.color || '#ffcc00', 5);
      }
      return false; // Hit something
    }
    
    return true; // Still alive
  }
  
  _checkProjectileHit(proj) {
    const weapon = proj.weapon;
    
    // Handle explosive weapons with AoE damage
    if (weapon.explosive && weapon.explosionRadius > 0) {
      for (const [id, player] of this.players) {
        if (player.id === proj.ownerId) continue;
        
        const dx = player.x - proj.x;
        const dy = player.y - proj.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < weapon.explosionRadius + PLAYER_RADIUS) {
          // Damage based on distance from explosion center
          const damage = Math.max(0, weapon.damage * (1 - dist / (weapon.explosionRadius + PLAYER_RADIUS)));
          const prevHealth = player.health;
          player.health -= damage;
          
          // Award kill points to shooter
          if (prevHealth > 0 && player.health <= 0) {
            const killer = this.players.get(proj.ownerId);
            if (killer) killer.score += 20;
          }
          
          // Knockback proportional to explosion force
          const angle = Math.atan2(dy, dx);
          const knockbackForce = 600 * (1 - dist / (weapon.explosionRadius + PLAYER_RADIUS));
          player.vx += Math.cos(angle) * knockbackForce;
          player.vy += Math.sin(angle) * knockbackForce;
          
          if (player.health <= 0) {
            this.removePlayer(id);
          }
        }
      }
      return;
    }
    
    // Non-explosive: check direct hit on players
    for (const [id, player] of this.players) {
      if (player.id === proj.ownerId) continue;
      
      const dx = player.x - proj.x;
      const dy = player.y - proj.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < PLAYER_RADIUS + 8) {
        // Direct hit - deal weapon damage
        const prevHealth = player.health;
        player.health -= weapon.damage;
        
        // Award kill points to shooter
        if (prevHealth > 0 && player.health <= 0) {
          const killer = this.players.get(proj.ownerId);
          if (killer) killer.score += 20;
        }
        
        // Small knockback
        const angle = Math.atan2(dy, dx);
        const knockbackForce = 150;
        player.vx += Math.cos(angle) * knockbackForce;
        player.vy += Math.sin(angle) * knockbackForce;
        
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
  
  _createSplatter(x, y, color, count) {
    // Small splatter for non-explosive weapon impacts — reduced size
    const actualCount = Math.max(3, count + Math.floor(Math.random() * 4));
    
    for (let i = 0; i < actualCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 80; // Much slower than explosions
      
      this.particles.push(new Particle(
        x, y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        0.15 + Math.random() * 0.2, // Short life
        color || '#ffcc00'
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
        activeWeapon: player.activeWeapon,
        weapons: Object.fromEntries(Object.entries(player.weapons).map(([k,v]) => [k, Math.floor(v)])),
        unlockedWeapons: [...player.unlockedWeapons],
        facingAngle: player.facingAngle,
        score: player.score,
        grappleActive: player.grappleActive,
        grappleX: player.grappleX || 0,
        grappleY: player.grappleY || 0,
        grappleLength: player.grappleLength || 0,
        grappleState: player.grappleState || 'idle',
        customColor: player.customColor,
        isAdmin: player.isAdmin || false,
      });
    }
    
    return states;
  }
  
  getGameState() {
    // Round timer info
    const roundInfo = {
      active: this.roundActive,
      timeLeft: Math.max(0, Math.ceil(this.roundTimer)),
      total: this.roundDuration, // Original configured duration for display
    };
    
    // Voting info
    let voteInfo = null;
    if (this.votingActive) {
      const votesArray = [];
      for (const [playerId, mapKey] of this.votes) {
        votesArray.push({ playerId, map: mapKey });
      }
      voteInfo = {
        active: true,
        timeLeft: Math.max(0, Math.ceil(this.voteTimeLeft)),
        total: 30, // 30 seconds to vote
        votes: votesArray,
        options: Object.keys(MAP_REGISTRY).filter(k => k !== currentMapName),
      };
    } else {
      voteInfo = { active: false };
    }
    
    return { round: roundInfo, voting: voteInfo };
  }
  
  // Vote handling
  castVote(playerId, mapKey) {
    if (!this.votingActive) return false;
    if (!MAP_REGISTRY[mapKey]) return false;
    
    this.votes.set(playerId, mapKey);
    return true;
  }
  
  resolveVotes() {
    // Count votes per map
    const voteCounts = new Map();
    for (const [_, mapKey] of this.votes) {
      voteCounts.set(mapKey, (voteCounts.get(mapKey) || 0) + 1);
    }
    
    // If no votes cast, pick randomly from available maps
    if (voteCounts.size === 0) {
      const available = Object.keys(MAP_REGISTRY).filter(k => k !== currentMapName);
      if (available.length > 0) {
        return available[Math.floor(Math.random() * available.length)];
      }
      this.votingActive = false;
      this.votes.clear();
      return null;
    }
    
    // Find the highest vote count
    let bestCount = -1;
    for (const [, count] of voteCounts) {
      if (count > bestCount) bestCount = count;
    }
    
    // Collect all maps tied at the top
    const tiedMaps = [];
    for (const [mapKey, count] of voteCounts) {
      if (count === bestCount) tiedMaps.push(mapKey);
    }
    
    // If tie, pick randomly among tied maps; otherwise use the winner
    const winner = tiedMaps.length > 1 
      ? tiedMaps[Math.floor(Math.random() * tiedMaps.length)]
      : tiedMaps[0];
    
    this.votingActive = false;
    this.votes.clear();
    
    return winner;
  }
  
  startVoting() {
    this.roundActive = false;
    this.votingActive = true;
    this.voteTimeLeft = 30;
    this.votes.clear();
  }
  
  endRound(newMapKey) {
    if (newMapKey && MAP_REGISTRY[newMapKey]) {
      currentMapName = newMapKey;
    }
    // Reset round timer for next round, keep configured duration
    this.roundTimer = this.roundDuration;
    this.roundActive = true;
    this.votingActive = false;
    this.voteTimeLeft = 0;
    this.votes.clear();
  }
  
  getProjectiles() {
    return this.projectiles.map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      ownerId: p.ownerId,
      weaponType: p.weapon?.name?.toLowerCase() || 'gun',
      color: p.weapon?.color || '#ffcc00',
      trailColor: p.weapon?.trailColor || 'rgba(255, 204, 0, 0.3)',
      size: p.weapon?.size || 4,
    }));
  }
  
  getParticles() {
    return this.particles.map(p => ({
      x: p.x,
      y: p.y,
      vx: p.vx || 0,
      vy: p.vy || 0,
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
    this.facingAngle = 0;
    this.score = 0;
    this.grounded = false;
    this.lastShot = -999;
    
    // Admin flag — first player to join becomes admin
    this.isAdmin = false;
    
    // Custom color (overrides team color if set)
    this.customColor = null;
    
    // Weapon system
    this.activeWeapon = 'gun';  // Currently equipped weapon key
    this.weapons = {            // Ammo per weapon type
      gun: CONSTANTS.WEAPONS.gun.maxAmmo,
      shotgun: 0,
      rocket: 0,
      minigun: 0,
      laser: 0,
    };
    this.unlockedWeapons = new Set(['gun']); // Weapons that have been picked up
    
    // Grappling hook state
    this.grappleActive = false;
    this.grappleX = 0;
    this.grappleY = 0;
    this.grappleLength = 0;           // current rope length
    this.grappleMaxLen = 0;           // max rope length (distance to anchor)
    this.grappleState = 'idle';       // idle, firing, extending, pulling, retracting
    
    // Input buffer (set by client)
    this.input = null;
  }
  
  getWeapon() {
    return CONSTANTS.WEAPONS[this.activeWeapon] || CONSTANTS.WEAPONS.gun;
  }
  
  canShoot(gameTime) {
    const weapon = this.getWeapon();
    return gameTime - this.lastShot >= weapon.fireRate && (this.weapons[this.activeWeapon] || 0) >= 1;
  }
  
  switchTo(weaponKey) {
    if (CONSTANTS.WEAPONS[weaponKey] && this.unlockedWeapons.has(weaponKey)) {
      this.activeWeapon = weaponKey;
      return true;
    }
    return false;
  }
}

class Projectile {
  constructor(x, y, angle, ownerId, weapon) {
    this.id = Math.random().toString(36).substr(2, 9);
    this.x = x;
    this.y = y;
    this.ownerId = ownerId;
    this.spawnTime = Date.now() / 1000;
    
    // Weapon-specific settings
    this.weapon = weapon || CONSTANTS.WEAPONS.gun;
    this.vx = Math.cos(angle) * this.weapon.speed;
    this.vy = this.weapon.gravity > 0 ? Math.sin(angle) * this.weapon.speed : 0;
    this.gravity = this.weapon.gravity || 0;
    this.explosive = this.weapon.explosive || false;
    this.explosionRadius = this.weapon.explosionRadius || 0;
    this.damage = this.weapon.damage || 18;
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
