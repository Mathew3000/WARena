// Client-side WARena Game Engine

// Canvas roundRect polyfill for compatibility
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    if (typeof r === 'number') r = [r, r, r, r];
    const [tl, tr, br, bl] = r;
    this.moveTo(x + tl, y);
    this.lineTo(x + w - tr, y);
    this.quadraticCurveTo(x + w, y, x + w, y + tr);
    this.lineTo(x + w, y + h - br);
    this.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    this.lineTo(x + bl, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - bl);
    this.lineTo(x, y + tl);
    this.quadraticCurveTo(x, y, x + tl, y);
    this.closePath();
    return this;
  };
}

class GameClient {
  constructor() {
    // Canvas setup
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.minimapCanvas = document.getElementById('minimap-canvas');
    this.minimapCtx = this.minimapCanvas.getContext('2d');
    
    // Game state
    this.playerId = null;
    this.mapWidth = 0;
    this.mapHeight = 0;
    this.tileSize = 64;
    this.mapData = [];
    this.players = new Map();
    this.projectiles = [];
    this.particles = [];
    this.items = [];
    this.chatMessages = [];
    
    // Weapon definitions (mirrored from server)
    this.weaponDefs = {
      gun:          { name: 'Gun',          color: '#ffcc00', ammoKey: 'weapons.gun' },
      shotgun:      { name: 'Shotgun',      color: '#ff8844', ammoKey: 'weapons.shotgun' },
      rocket:       { name: 'Rocket Launcher', color: '#ff4444', ammoKey: 'weapons.rocket' },
      minigun:      { name: 'Minigun',      color: '#44ff88', ammoKey: 'weapons.minigun' },
      laser:        { name: 'Laser',        color: '#44aaff', ammoKey: 'weapons.laser' },
    };
    
    // Camera
    this.cameraX = 0;
    this.cameraY = 0;
    
    // Input state
    this.keys = {};
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this.grappleDown = false;
    this.chatMode = false;
    
    // Map editor state
    this.editMode = false;
    this.editTool = 'solid';     // 'solid', 'water', 'lava', 'erase'
    this.editPaletteOpen = true;  // Show palette by default when in edit mode
    
    // Network
    this.ws = null;
    this.lastServerTime = 0;
    this.reconnectTimer = null;
    
    // Login state
    this.loginName = '';
    this.loginColor = '#4a9eff';
    this.selectedTeam = 1;
    this.roundTime = 300; // Default round duration in seconds
    
    // Lobby state
    this.currentLobbyId = null;
    this.selectedLobbyMap = 'default';
    this.lobbyPhase = 'lobbies'; // 'lobbies' or 'identity'
    
    // Timing
    this.lastFrameTime = 0;
    this.frameCount = 0;
    
    // Colors (Teeworlds-inspired)
    this.colors = {
      sky_top: '#1a1a2e',
      sky_bottom: '#16213e',
      ground: '#4a7c59',
      ground_dark: '#3d6b4e',
      wall: '#8b7355',
      wall_light: '#a0896b',
      wall_shadow: '#6b5741',
      water: 'rgba(64, 164, 223, 0.5)',
      lava: 'rgba(255, 80, 0, 0.6)',
      projectile: '#ffcc00',
    };
    
    this.teamColors = {
      1: '#4a9eff',
      2: '#ff4a4a',
      3: '#4aff8b',
      4: '#ffff4a',
    };
    
    // Initialize
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.setupInput();
    
    // Pre-fill name input with random suggestion
    const nameInput = document.getElementById('player-name');
    if (nameInput) {
      nameInput.value = this.generateRandomName();
    }
    
    // Audio system — Web Audio API, created on first user interaction
    this.audioCtx = null;
    this._initAudio();
    
    // Sound state tracking
    this._lastWeaponFireTime = -999;
    this._lastAmmoCount = null;
    this._lastHealth = 100;
    this._wasGrounded = false;
    this._lastGrappleState = 'idle';
    this._lastProjectileCount = 0;
    
    // Background music system
    this.musicEnabled = true;
    this.musicNodes = [];
    this.musicInterval = null;
    
    this.connect();
  }
  
  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }
  
  setupInput() {
    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !this.chatMode) {
        e.preventDefault();
        this.startChat();
        return;
      }
      
      if (e.key === 'Escape' && this.chatMode) {
        this.endChat();
        return;
      }
      
      if (e.key === 'r' || e.key === 'R') {
        this.sendRespawn();
        return;
      }
      
      // Save map as JSON with Ctrl+S / Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.saveMapAsJSON();
        return;
      }
      
      // Weapon switching: keys 1-5
      const weaponKeys = ['gun', 'shotgun', 'rocket', 'minigun', 'laser'];
      if (e.key >= '1' && e.key <= '5') {
        const idx = parseInt(e.key) - 1;
        this.sendWeaponSwitch(weaponKeys[idx]);
        return;
      }
      
      // Toggle music with O key (replaced button)
      if (e.key === 'o' || e.key === 'O') {
        if (!this.chatMode) {
          this._toggleMusic();
          return;
        }
      }
      
      // Toggle map editor with E key
      if (e.key === 'e' || e.key === 'E') {
        if (!this.chatMode && this.playerId) {
          this.editMode = !this.editMode;
          this.editPaletteOpen = this.editMode;
        }
        return;
      }
      
      this.keys[e.key.toLowerCase()] = true;
    });
    
    document.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });
    
    // Mouse
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.chatMode) {
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
      }
    });
    
    // Initialize audio on first user interaction (browser requirement)
    const initAudioOnGesture = () => {
      this._resumeAudio();
      if (!this.audioCtx) {
        try {
          this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch(e) {}
      }
    };
    document.addEventListener('click', initAudioOnGesture, { once: true });
    document.addEventListener('keydown', initAudioOnGesture, { once: true });
    
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.chatMode) {
        if (e.button === 0) this.mouseDown = true;       // Left click = shoot
        if (e.button === 2) this.grappleDown = true;     // Right click = grapple
      }
    });
    
    this.canvas.addEventListener('mouseup', (e) => {
      if (!this.chatMode) {
        if (e.button === 0) this.mouseDown = false;
        if (e.button === 2) this.grappleDown = false;
      }
    });
    
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Mouse wheel for weapon switching
    this.canvas.addEventListener('wheel', (e) => {
      if (this.chatMode || !this.playerId) return;
      e.preventDefault();
      
      const unlockedWeapons = this.players.get(this.playerId)?.unlockedWeapons || ['gun'];
      const allWeaponKeys = ['gun', 'shotgun', 'rocket', 'minigun', 'laser'];
      const availableKeys = allWeaponKeys.filter(k => unlockedWeapons.includes(k));
      
      if (availableKeys.length <= 1) return;
      
      const currentIdx = availableKeys.indexOf(this.players.get(this.playerId)?.activeWeapon || 'gun');
      let newIdx;
      
      if (e.deltaY > 0) {
        // Scroll down — next weapon
        newIdx = (currentIdx + 1) % availableKeys.length;
      } else {
        // Scroll up — previous weapon
        newIdx = (currentIdx - 1 + availableKeys.length) % availableKeys.length;
      }
      
      this.sendWeaponSwitch(availableKeys[newIdx]);
    }, { passive: false });
    
    // Map editor tile placement click handler
    this.canvas.addEventListener('click', (e) => {
      if (!this.editMode || this.chatMode) return;
      
      // Check if palette button was clicked
      if (this._editPaletteButtons) {
        for (const btn of this._editPaletteButtons) {
          if (e.clientX >= btn.x && e.clientX <= btn.x + btn.w &&
              e.clientY >= btn.y && e.clientY <= btn.y + btn.h) {
            this.editTool = btn.id;
            return;
          }
        }
      }
      
      // Place/remove tile at mouse position
      const worldMouseX = e.clientX + this.cameraX;
      const worldMouseY = e.clientY + this.cameraY;
      const tileX = Math.floor(worldMouseX / this.tileSize);
      const tileY = Math.floor(worldMouseY / this.tileSize);
      
      if (tileY < 0 || tileY >= this.mapData.length || 
          tileX < 0 || tileX >= this.mapData[0].length) return;
      
      // Don't allow editing border tiles
      if (tileX === 0 || tileY === 0 || 
          tileX >= this.mapData[0].length - 1 || 
          tileY >= this.mapData.length - 1) return;
      
      let newTile = 0; // Empty
      
      switch (this.editTool) {
        case 'solid': newTile = 1; break;
        case 'water': newTile = 2; break;
        case 'lava': newTile = 3; break;
        case 'erase': newTile = 0; break;
      }
      
      // Only place if different from current tile
      const currentTile = this.mapData[tileY][tileX];
      if (currentTile !== newTile) {
        this.mapData[tileY][tileX] = newTile;
        
        // Send update to server
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'editTile',
            x: tileX,
            y: tileY,
            value: newTile,
          }));
        }
      }
    });
    
    // Chat input
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && chatInput.value.trim()) {
        this.sendChat(chatInput.value.trim());
        chatInput.value = '';
        this.endChat();
      } else if (e.key === 'Escape') {
        this.endChat();
      }
    });
    
    // Color wheel selection
    this.colorWheelCanvas = document.getElementById('color-wheel-canvas');
    this.colorWheelCtx = this.colorWheelCanvas?.getContext('2d');
    this.colorWheelDragging = false;
    this.selectedColorHex = '#4a9eff';  // Default blue
    
    if (this.colorWheelCtx) {
      this._drawColorWheel();
      this._updateColorPreview(this.selectedColorHex);
      
      const canvas = this.colorWheelCanvas;
      
      const getColorFromWheel = (clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (clientX - rect.left) * scaleX - canvas.width / 2;
        const y = (clientY - rect.top) * scaleY - canvas.height / 2;
        
        const dist = Math.sqrt(x * x + y * y);
        const maxR = canvas.width / 2 - 4;
        
        if (dist > maxR || dist < 10) return null; // Outside ring or too close to center
        
        const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        const sat = Math.min(1, dist / maxR);
        
        // Convert HSL to hex
        return this._hslToHex(hue, sat * 100, 50);
      };
      
      canvas.addEventListener('mousedown', (e) => {
        this.colorWheelDragging = true;
        const color = getColorFromWheel(e.clientX, e.clientY);
        if (color) {
          this.selectedColorHex = color;
          this._updateColorPreview(color);
        }
      });
      
      canvas.addEventListener('mousemove', (e) => {
        if (!this.colorWheelDragging) return;
        const color = getColorFromWheel(e.clientX, e.clientY);
        if (color) {
          this.selectedColorHex = color;
          this._updateColorPreview(color);
        }
      });
      
      window.addEventListener('mouseup', () => {
        this.colorWheelDragging = false;
      });
      
      // Touch support
      canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.colorWheelDragging = true;
        const touch = e.touches[0];
        const color = getColorFromWheel(touch.clientX, touch.clientY);
        if (color) {
          this.selectedColorHex = color;
          this._updateColorPreview(color);
        }
      }, { passive: false });
      
      canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!this.colorWheelDragging) return;
        const touch = e.touches[0];
        const color = getColorFromWheel(touch.clientX, touch.clientY);
        if (color) {
          this.selectedColorHex = color;
          this._updateColorPreview(color);
        }
      }, { passive: false });
      
      canvas.addEventListener('touchend', () => {
        this.colorWheelDragging = false;
      });
    }
    
    // Preset color buttons
    document.querySelectorAll('.color-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const hex = btn.dataset.hex;
        if (hex) {
          this.selectedColorHex = hex;
          this._updateColorPreview(hex);
        }
      });
    });

    // Lobby phase buttons
    const btnListLobbies = document.getElementById('btn-list-lobbies');
    if (btnListLobbies) {
      btnListLobbies.addEventListener('click', () => this.listLobbies());
    }

    const btnCreateLobby = document.getElementById('btn-create-lobby');
    if (btnCreateLobby) {
      btnCreateLobby.addEventListener('click', () => {
        const form = document.getElementById('create-lobby-form');
        form.style.display = form.style.display === '' ? 'block' : '';
      });
    }

    const btnConfirmCreate = document.getElementById('btn-confirm-create-lobby');
    if (btnConfirmCreate) {
      btnConfirmCreate.addEventListener('click', () => {
        const nameInput = document.getElementById('lobby-name-input');
        const name = nameInput?.value.trim() || '';
        this.createLobby(name, this.selectedLobbyMap);
      });
    }

    // Back to lobbies button
    const btnBack = document.getElementById('btn-back-to-lobbies');
    if (btnBack) {
      btnBack.addEventListener('click', () => this.showLobbyPhase());
    }

    // Join lobby button (identity phase)
    const joinBtn = document.getElementById('join-btn');
    if (joinBtn) {
      joinBtn.addEventListener('click', () => {
        this.sendLogin();
      });
    }

    // Enter key on name input triggers join
    const nameInput = document.getElementById('player-name');
    if (nameInput) {
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.sendLogin();
        }
      });
    }
  }
  
  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    console.log(`Connecting to ${wsUrl}...`);
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('Connected to server');
      // Show login screen if not already logged in, otherwise start game
      if (!this.playerId) {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('loading-screen').style.display = 'none';
      } else {
        document.getElementById('loading-screen').style.display = 'none';
        this.showUI();
      }
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };
    
    this.ws.onclose = () => {
      console.log('Disconnected from server');
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('loading-screen').style.display = 'flex';
      
      // Reconnect after 3 seconds
      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 3000);
      }
    };
    
    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }
  
  handleMessage(message) {
    switch (message.type) {
      case 'init':
        this.handleInit(message);
        break;
      case 'state':
        this.handleStateUpdate(message);
        break;
      case 'playerList':
        this.handlePlayerList(message);
        break;
      case 'chat':
        this.addChatMessage(message.text);
        break;
      case 'loginError':
        console.warn('Login error:', message.reason);
        alert(message.reason || 'Failed to join');
        break;
      case 'initConnect':
        // Server sent maps + lobbies on initial connect
        this.availableMaps = message.maps || [];
        if (this.availableMaps) this._renderLobbyMapSelector();
        this.handleLobbyList(message);
        break;
      case 'lobbyList':
        this.handleLobbyList(message);
        break;
      case 'lobbyInfo':
        this.handleLobbyInfo(message);
        break;
      case 'playerJoined':
        // Someone joined our lobby — update player list display
        if (message.player) {
          console.log(`[LOBBY] Player joined: ${message.player.name || message.player.playerId}`);
        }
        break;
      case 'lobbyDestroyed':
        alert(message.reason || 'Lobby was destroyed');
        this.currentLobbyId = null;
        this.showLobbyPhase();
        break;
      case 'roundEnd':
        this.handleRoundEnd(message);
        break;
      case 'mapSwitched':
        // Server re-added our player after map switch — respawn visually
        this._handleMapSwitched();
        break;
    }
  }

  // ─── Lobby methods ──────────────────────────────────────

  handleLobbyList(data) {
    const container = document.getElementById('lobby-list-container');
    if (!container) return;

    const lobbies = data.lobbies || [];

    if (lobbies.length === 0) {
      container.innerHTML = '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:20px;">No lobbies yet. Create one!</p>';
      return;
    }

    let html = '';
    for (const lobby of lobbies) {
      const statusClass = lobby.votingActive ? 'lobby-status-voting' :
                          lobby.roundActive ? 'lobby-status-playing' : 'lobby-status-waiting';
      const statusText = lobby.votingActive ? 'Voting' :
                         lobby.roundActive ? `${Math.ceil(lobby.roundTimer)}s` : 'Waiting';

      html += `
        <div class="lobby-item" data-lobby-id="${lobby.id}">
          <div class="lobby-item-header">
            <span class="lobby-item-name">${this.escapeHtml(lobby.name)}</span>
            <span class="lobby-item-id">${lobby.id}</span>
          </div>
          <div class="lobby-item-stats">
            <span>👥 ${lobby.playerCount} player${lobby.playerCount !== 1 ? 's' : ''}</span>
            <span>🗺️ ${this.escapeHtml(lobby.mapName)}</span>
            <span class="${statusClass}">${statusText}</span>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    // Add click handlers to join lobbies
    container.querySelectorAll('.lobby-item').forEach(el => {
      el.addEventListener('click', () => {
        const lobbyId = el.dataset.lobbyId;
        this.joinLobby(lobbyId);
      });
    });
  }

  handleLobbyInfo(data) {
    // We've joined a lobby — show identity phase
    this.currentLobbyId = data.id;
    document.getElementById('selected-lobby-info').textContent =
      `Joining: ${this.escapeHtml(data.name)} (${data.mapName})`;
    this.showIdentityPhase();
  }

  joinLobby(lobbyId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'joinLobby', lobbyId }));
    }
  }

  createLobby(name, mapKey) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'createLobby', name, mapKey }));
    }
  }

  listLobbies() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'listLobbies' }));
    }
  }

  showLobbyPhase() {
    this.lobbyPhase = 'lobbies';
    const lobbyPhase = document.getElementById('lobby-phase');
    const identityPhase = document.getElementById('identity-phase');
    if (lobbyPhase) lobbyPhase.style.display = '';
    if (identityPhase) identityPhase.style.display = 'none';
    this.listLobbies();
  }

  showIdentityPhase() {
    this.lobbyPhase = 'identity';
    const lobbyPhase = document.getElementById('lobby-phase');
    const identityPhase = document.getElementById('identity-phase');
    if (lobbyPhase) lobbyPhase.style.display = 'none';
    if (identityPhase) identityPhase.style.display = '';
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  
  // Round/voting state
  roundInfo = null;
  voteInfo = null;
  adminMapSelectOpen = false;
  _voteContainerDirty = true; // Force initial render
  
  handleAvailableMaps(data) {
    this.availableMaps = data.maps || [];
    this._renderMapSelector();
  }
  
  _renderMapSelector() {
    const container = document.getElementById('map-selector');
    if (!container || !this.availableMaps) return;
    
    container.innerHTML = '';
    
    for (const map of this.availableMaps) {
      const btn = document.createElement('div');
      btn.className = 'map-option' + (map.key === this.selectedMap ? ' selected' : '');
      btn.dataset.map = map.key;
      btn.innerHTML = `
        <div class="map-name">${map.name}</div>
        <div class="map-desc">${map.description}</div>
      `;
      btn.addEventListener('click', () => {
        this.selectedMap = map.key;
        container.querySelectorAll('.map-option').forEach(el => el.classList.remove('selected'));
        btn.classList.add('selected');
        
        // Send map selection to server
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'mapSelect', map: map.key }));
        }
      });
      container.appendChild(btn);
    }
  }

  _renderLobbyMapSelector() {
    const container = document.getElementById('lobby-map-selector');
    if (!container || !this.availableMaps) return;

    container.innerHTML = '';

    for (const map of this.availableMaps) {
      const btn = document.createElement('div');
      btn.className = 'lobby-map-btn' + (map.key === this.selectedLobbyMap ? ' selected' : '');
      btn.textContent = map.name;
      btn.addEventListener('click', () => {
        this.selectedLobbyMap = map.key;
        container.querySelectorAll('.lobby-map-btn').forEach(el => el.classList.remove('selected'));
        btn.classList.add('selected');
      });
      container.appendChild(btn);
    }
  }

  handleInit(data) {
    this.playerId = data.playerId;
    this.mapWidth = data.mapWidth;
    this.mapHeight = data.mapHeight;
    this.tileSize = data.tileSize;
    
    // Parse map data
    this.parseMapData(data.map);
    
    // Initialize players
    this.players.clear();
    for (const player of data.players) {
      this.players.set(player.id, player);
    }
    
    // Initialize items
    this.items = data.items || [];
    
    // Hide login screen and start game
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('loading-screen').style.display = 'none';
    this.showUI();
  }
  
  parseMapData(mapArray) {
    this.mapData = [];
    for (let y = 0; y < mapArray.length; y++) {
      const row = [];
      for (let x = 0; x < mapArray[y].length; x++) {
        const char = mapArray[y][x];
        if (char === '1') row.push(1); // Solid
        else if (char === '2') row.push(2); // Water
        else if (char === '3') row.push(3); // Lava
        else row.push(0); // Empty
      }
      this.mapData.push(row);
    }
  }
  
  handleStateUpdate(data) {
    // Update players
    this.players.clear();
    for (const player of data.players) {
      this.players.set(player.id, player);
    }
    
    // Update projectiles
    this.projectiles = data.projectiles || [];
    
    // Update particles
    this.particles = data.particles || [];
    
    // Update items
    this.items = data.items || [];
    
    // Update round/voting state
    this.roundInfo = data.round || null;
    this.voteInfo = data.voting || null;
    this.currentMapName = data.currentMap || 'default';
  }
  
  handlePlayerList(data) {
    this.players.clear();
    for (const player of data.players) {
      this.players.set(player.id, player);
    }
    this.updatePlayerListUI();
  }
  
  showUI() {
    document.getElementById('hud').style.display = 'flex';
    document.getElementById('minimap').style.display = 'block';
    document.getElementById('player-list').style.display = 'block';
    document.getElementById('chat-box').style.display = 'block';
    document.querySelector('.controls-hint').style.display = 'block';
    document.getElementById('weapon-hud').style.display = 'flex';

    // Event delegation for vote options (survives innerHTML rebuilds)
    const voteContainer = document.getElementById('vote-container');
    if (voteContainer) {
      voteContainer.addEventListener('click', (e) => {
        const option = e.target.closest('.vote-option');
        if (option && this.voteInfo?.active) {
          e.stopPropagation();
          e.preventDefault();
          const mapKey = option.dataset.map;
          if (mapKey) this.sendVote(mapKey);
        }
      });
    }
    
    // Start background music on first user interaction
    setTimeout(() => this._startMusic(), 500);
  }
  
  _updateWeaponHUD() {
    const self = this.players.get(this.playerId);
    if (!self) return;
    
    const hudEl = document.getElementById('weapon-hud');
    if (!hudEl) return;
    
    const unlockedWeapons = self.unlockedWeapons || ['gun'];
    const allWeaponKeys = ['gun', 'shotgun', 'rocket', 'minigun', 'laser'];
    const availableKeys = allWeaponKeys.filter(k => unlockedWeapons.includes(k));
    
    if (availableKeys.length === 0) return;
    
    let html = '';
    for (let i = 0; i < availableKeys.length; i++) {
      const key = availableKeys[i];
      const def = this.weaponDefs[key];
      if (!def) continue;
      
      const isActive = self.activeWeapon === key;
      const keyNum = i + 1; // Key binding number
      
      // Get ammo count for this specific weapon
      const currentAmmo = Math.floor(self.weapons?.[key] ?? 0);
      const maxAmmo = CONSTANTS.WEAPONS?.[key]?.maxAmmo || 0;
      
      html += `
        <div class="weapon-slot${isActive ? ' active' : ''}">
          <span class="key">[${keyNum}]</span>
          <span class="name" style="color: ${def.color}">${def.name}</span>
          <span class="ammo">${currentAmmo}/${maxAmmo}</span>
        </div>
      `;
    }
    
    hudEl.innerHTML = html;
  }
  
  startChat() {
    this.chatMode = true;
    document.getElementById('chat-input').focus();
  }
  
  endChat() {
    this.chatMode = false;
    document.getElementById('chat-input').blur();
  }
  
  sendInput() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    // Get own player's screen position for direction calculation
    const self = this.players.get(this.playerId);
    let worldMouseX, worldMouseY;
    
    if (self) {
      // Player's center on screen
      const playerScreenX = self.x - this.cameraX;
      const playerScreenY = self.y - this.cameraY;
      
      // Direction from player to mouse in screen space
      const dx = this.mouseX - playerScreenX;
      const dy = this.mouseY - playerScreenY;
      
      // Apply that direction in world space from player position
      worldMouseX = self.x + dx;
      worldMouseY = self.y + dy;
    } else {
      // Fallback if player not yet loaded
      worldMouseX = this.mouseX + this.cameraX;
      worldMouseY = this.mouseY + this.cameraY;
    }
    
    this.ws.send(JSON.stringify({
      type: 'input',
      left: this.keys['a'] || this.keys['arrowleft'],
      right: this.keys['d'] || this.keys['arrowright'],
      up: this.keys['w'] || this.keys['arrowup'] || this.keys[' '],
      shoot: this.mouseDown,
      grapple: this.grappleDown,
      mouseX: worldMouseX,
      mouseY: worldMouseY,
    }));
  }
  
  sendChat(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.ws.send(JSON.stringify({
      type: 'chat',
      text: text,
    }));
  }
  
  sendRespawn() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.ws.send(JSON.stringify({
      type: 'respawn',
    }));
  }
  
  sendWeaponSwitch(weaponKey) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    this.ws.send(JSON.stringify({
      type: 'weaponSwitch',
      weapon: weaponKey,
    }));
  }
  
  addChatMessage(text) {
    const container = document.getElementById('chat-messages');
    const msg = document.createElement('div');
    msg.className = 'chat-msg';
    msg.textContent = text;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
    
    // Remove old messages
    while (container.children.length > 20) {
      container.removeChild(container.firstChild);
    }
  }
  
  generateRandomName() {
    const ADJECTIVES = ['Swift', 'Brave', 'Dark', 'Wild', 'Crazy', 'Silent', 'Fierce', 'Rapid', 'Shadow', 'Thunder'];
    const NOUNS = ['Wolf', 'Eagle', 'Fox', 'Bear', 'Hawk', 'Tiger', 'Dragon', 'Phantom', 'Blade', 'Storm'];
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return `${adj}${noun}${Math.floor(Math.random() * 99)}`;
  }
  
  // ─── Color Wheel Helpers ──────────────────────────────────────────────
  
  _drawColorWheel() {
    const ctx = this.colorWheelCtx;
    if (!ctx) return;
    
    const w = this.colorWheelCanvas.width;
    const h = this.colorWheelCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 4;
    
    ctx.clearRect(0, 0, w, h);
    
    // Draw hue ring with saturation gradient
    for (let angle = 0; angle < 360; angle += 1) {
      const startAngle = ((angle - 2) * Math.PI / 180);
      const endAngle = ((angle + 2) * Math.PI / 180);
      
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxR, startAngle, endAngle);
      ctx.closePath();
      
      // Create radial gradient for saturation (white at center, hue at edge)
      const midR = maxR * 0.5;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      grad.addColorStop(0, `hsl(${angle}, 10%, 95%)`);
      grad.addColorStop(0.3, `hsl(${angle}, 60%, 70%)`);
      grad.addColorStop(1, `hsl(${angle}, 100%, 50%)`);
      
      ctx.fillStyle = grad;
      ctx.fill();
    }
    
    // Draw center circle (neutral)
    const centerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.25);
    centerGrad.addColorStop(0, '#ffffff');
    centerGrad.addColorStop(1, '#cccccc');
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = centerGrad;
    ctx.fill();
    
    // Selection indicator
    this._drawSelectionIndicator();
  }
  
  _drawSelectionIndicator() {
    const ctx = this.colorWheelCtx;
    if (!ctx) return;
    
    const w = this.colorWheelCanvas.width;
    const h = this.colorWheelCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 4;
    
    // Parse current color to get hue and saturation
    const { hue, sat } = this._hexToHsl(this.selectedColorHex);
    
    if (hue === undefined || sat < 5) return; // Neutral color, no indicator
    
    const angle = (hue * Math.PI / 180);
    const dist = (sat / 100) * maxR;
    const ix = cx + Math.cos(angle) * dist;
    const iy = cy + Math.sin(angle) * dist;
    
    // Draw selection ring
    ctx.beginPath();
    ctx.arc(ix, iy, 8, 0, Math.PI * 2);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ix, iy, 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  
  _updateColorPreview(hex) {
    const swatch = document.getElementById('color-preview-swatch');
    if (swatch) {
      swatch.style.background = hex;
    }
    this.selectedColorHex = hex;
    
    // Redraw wheel to update selection indicator
    if (this.colorWheelCtx) {
      this._drawColorWheel();
    }
  }
  
  _hexToHsl(hex) {
    // Parse hex color to HSL
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let hue = 0;
    let sat = 0;
    const lit = (max + min) / 2;
    
    if (max !== min) {
      const d = max - min;
      sat = d === 0 ? 0 : d / (1 - Math.abs(2 * lit - 1));
      
      switch (max) {
        case r: hue = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: hue = ((b - r) / d + 2) / 6; break;
        case b: hue = ((r - g) / d + 4) / 6; break;
      }
      hue *= 360;
    }
    
    return { hue: Math.round(hue), sat: Math.round(sat * 100) };
  }
  
  // HSL to hex color conversion for color wheel
  _hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    
    let r, g, b;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    
    const toHex = v => {
      const hex = Math.round((v + m) * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  
  saveMapAsJSON() {
    if (!this.mapData || this.mapData.length === 0) {
      console.warn('No map data to save');
      return;
    }
    
    const mapName = prompt('Enter a name for this map:', 'Custom Map') || 'Custom Map';
    
    const mapJSON = JSON.stringify({
      name: mapName,
      width: CONSTANTS.WORLD_WIDTH,
      height: CONSTANTS.WORLD_HEIGHT,
      data: this.mapData,
    }, null, 2);
    
    // Create download link
    const blob = new Blob([mapJSON], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${mapName.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('Map saved as JSON');
  }
  
  handleRoundEnd(data) {
    // Show round end message briefly
    const overlay = document.getElementById('round-end-overlay');
    if (overlay) {
      overlay.textContent = data.message || 'Round ended!';
      overlay.style.display = 'flex';
      setTimeout(() => { overlay.style.display = 'none'; }, 5000);
    }
  }
  
  _handleMapSwitched(data) {
    // Server re-added our player after map switch — update local state and respawn visually
    
    // Update players list from the message
    if (data.players) {
      this.players.clear();
      for (const player of data.players) {
        this.players.set(player.id, player);
      }
    }
    
    // Update map data if provided
    if (data.map && Array.isArray(data.map)) {
      this.parseMapData(data.map);
    }
    
    // Reset health tracking so hit sounds work correctly after respawn
    const self = this.players.get(this.playerId);
    if (self) {
      this._lastHealth = 100;
    }
    
    // Show brief notification
    const notif = document.getElementById('music-toggle-notif');
    if (notif) {
      notif.textContent = '🗺️ Map changed — Respawned!';
      notif.style.display = 'block';
      setTimeout(() => { notif.style.display = 'none'; }, 2000);
    }
  }
  
  sendVote(mapKey) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'vote', map: mapKey }));
  }
  
  sendAdminMapSelect(mapKey) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'adminMapSelect', map: mapKey }));
  }
  
  sendLogin() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const nameInput = document.getElementById('player-name');
    let name = nameInput ? nameInput.value.trim() : '';
    
    if (!name) {
      name = this.generateRandomName();
      if (nameInput) nameInput.value = name;
    }
    
    // Read round duration from input
    const timeInput = document.getElementById('round-time-input');
    this.roundTime = Math.max(30, Math.min(3600, parseInt(timeInput?.value) || 300));
    
    this.loginName = name;
    this.selectedTeam = this.selectedTeam || 1;
    
    // Send login credentials to server (lobby context)
    this.ws.send(JSON.stringify({
      type: 'login',
      name: name,
      team: this.selectedTeam,
      color: this.selectedColorHex,
      roundTime: this.roundTime,
    }));
  }
  
  updatePlayerListUI() {
    const container = document.getElementById('players-container');
    if (!container) return;
    container.innerHTML = '';
    
    let isAdminPanelOpen = false;
    
    for (const [id, player] of this.players) {
      const entry = document.createElement('div');
      entry.className = 'player-entry';
      
      const isSelf = id === this.playerId;
      const color = player.customColor || this.teamColors[player.team] || '#aaaaaa';
      const adminBadge = player.isAdmin ? ' 👑' : '';
      const scoreDisplay = player.score > 0 ? ` (${Math.floor(player.score)}pts)` : '';
      
      entry.innerHTML = `
        <span class="player-name">
          <span class="team-dot" style="background: ${color}"></span>
          ${isSelf ? '★ ' : ''}${player.name}${adminBadge}
        </span>
        <span class="player-health">${Math.ceil(player.health)} HP${scoreDisplay}</span>
      `;
      
      container.appendChild(entry);
      
      if (player.isAdmin) isAdminPanelOpen = true;
    }
    
    // Show/hide admin map selector
    const adminSelector = document.getElementById('admin-map-selector');
    if (adminSelector && isAdminPanelOpen) {
      this._renderAdminMapSelector();
    }
  }
  
  _renderAdminMapSelector() {
    const container = document.getElementById('admin-map-buttons');
    if (!container || !this.availableMaps) return;
    
    // Get current map from available maps (first one is typically current, or track it separately)
    const currentMapKey = this.currentMapName || 'default';
    
    container.innerHTML = '';
    
    for (const map of this.availableMaps) {
      const btn = document.createElement('button');
      btn.className = 'admin-map-btn' + (map.key === currentMapKey ? ' current' : '');
      btn.textContent = map.name;
      btn.addEventListener('click', () => {
        this.sendAdminMapSelect(map.key);
      });
      container.appendChild(btn);
    }
  }
  
  update(dt) {
    // Send input every frame
    this.sendInput();
    
    // Update sounds
    this._updateSounds();
    
    // Update camera to follow own player
    const self = this.players.get(this.playerId);
    if (self) {
      const targetX = self.x - this.canvas.width / 2;
      const targetY = self.y - this.canvas.height / 2;
      
      // Smooth camera movement
      this.cameraX += (targetX - this.cameraX) * 0.1;
      this.cameraY += (targetY - this.cameraY) * 0.1;
    }
    
    // Update HUD
    if (self) {
      document.getElementById('health-bar').style.width = `${Math.max(0, self.health)}%`;
      
      const healthBar = document.getElementById('health-bar');
      if (self.health > 60) {
        healthBar.style.background = 'linear-gradient(90deg, #4aff8b, #66ffaa)';
      } else if (self.health > 30) {
        healthBar.style.background = 'linear-gradient(90deg, #ffaa00, #ffcc33)';
      } else {
        healthBar.style.background = 'linear-gradient(90deg, #ff3333, #ff6666)';
      }
      
      // Weapon display
      const weaponKey = self.activeWeapon || 'gun';
      const weaponDef = this.weaponDefs[weaponKey];
      if (weaponDef) {
        document.getElementById('weapon-label').textContent = weaponDef.name;
        document.getElementById('weapon-label').style.color = weaponDef.color;
        
        // Get ammo count from weapons object (floor to integer) and use actual maxAmmo from WEAPONS constant
        const ammoCount = Math.floor(self.weapons?.[weaponKey] ?? 0);
        const maxAmmo = CONSTANTS.WEAPONS?.[weaponKey]?.maxAmmo || 40;
        
        document.getElementById('ammo-bar').style.width = `${Math.max(0, (ammoCount / maxAmmo) * 100)}%`;
        document.getElementById('ammo-bar').style.background = `linear-gradient(90deg, ${weaponDef.color}, ${weaponDef.color}88)`;
        document.getElementById('ammo-count').textContent = ammoCount;
        document.getElementById('ammo-count').style.color = weaponDef.color;
      }
      
      // Round timer display
      const roundTimerEl = document.getElementById('round-timer');
      if (this.roundInfo && this.roundInfo.active) {
        const mins = Math.floor(this.roundInfo.timeLeft / 60);
        const secs = this.roundInfo.timeLeft % 60;
        roundTimerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        roundTimerEl.style.display = 'block';
      } else {
        roundTimerEl.style.display = 'none';
      }
      
      // Voting UI
      this._updateVotingUI();
    }
    
    // Show/hide death screen
    const deathScreen = document.getElementById('death-screen');
    if (self && self.health <= 0) {
      deathScreen.classList.add('active');
    } else {
      deathScreen.classList.remove('active');
    }
    
    // Update player list UI every few frames
    this.frameCount++;
    if (this.frameCount % 10 === 0) {
      this.updatePlayerListUI();
      this._updateWeaponHUD();
    }
  }
  
  _updateVotingUI() {
    const voteContainer = document.getElementById('vote-container');
    if (!voteContainer) return;
    
    // Check if voting is active and content changed since last render
    const wasActive = this._voteContainerDirty || !voteContainer.style.display || voteContainer.style.display === 'none';
    const isActive = this.voteInfo && this.voteInfo.active;
    
    if (isActive) {
      // Build new HTML
      const timeLeft = Math.max(0, Math.ceil(this.voteInfo.timeLeft));
      let html = `
        <div class="vote-header">
          <h3>Vote for Next Map</h3>
          <span class="vote-timer">${timeLeft}s remaining</span>
        </div>
        <div class="vote-options">
      `;
      
      if (this.voteInfo.options && this.voteInfo.options.length > 0) {
        for (const mapKey of this.voteInfo.options) {
          const map = MAP_REGISTRY[mapKey];
          if (!map) continue;
          
          const voteCount = this.voteInfo.votes?.filter(v => v.map === mapKey).length || 0;
          
          html += `
            <div class="vote-option" data-map="${mapKey}" style="pointer-events:auto;">
              <span class="vote-name">${map.name}</span>
              <span class="vote-count">${voteCount} vote${voteCount !== 1 ? 's' : ''}</span>
            </div>
          `;
        }
      } else {
        html += '<p>No other maps available</p>';
      }
      
      html += '</div>';
      
      // Only update DOM if content changed or first render
      const needsUpdate = this._voteContainerDirty || voteContainer.innerHTML !== html;
      if (needsUpdate) {
        voteContainer.innerHTML = html;
        voteContainer.style.display = 'block';
        this._voteContainerDirty = false;
      } else {
        // Just update the timer text without rebuilding DOM
        const timerEl = voteContainer.querySelector('.vote-timer');
        if (timerEl) timerEl.textContent = `${timeLeft}s remaining`;
      }
    } else {
      if (voteContainer.style.display !== 'none') {
        voteContainer.style.display = 'none';
        this._voteContainerDirty = true;
      }
    }
  }
  
  render() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    
    // Clear with sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0, this.colors.sky_top);
    skyGrad.addColorStop(1, this.colors.sky_bottom);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);
    
    // Render game world
    this.renderWorld(ctx, W, H);
    
    // Render projectiles
    this.renderProjectiles(ctx);
    
    // Render grappling hook lines
    this.renderGrappleLines(ctx);
    
    // Render items (ammo/health pickups)
    this.renderItems(ctx);
    
    // Render particles
    this.renderParticles(ctx);
    
    // Render minimap
    this.renderMinimap();
    
    // Render map editor overlay
    if (this.editMode) {
      this.renderEditorOverlay(ctx, W, H);
    }
  }
  
  renderEditorOverlay(ctx, W, H) {
    const ts = this.tileSize;
    
    // Draw grid overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    
    const startTileX = Math.floor(this.cameraX / ts);
    const endTileX = Math.ceil((this.cameraX + W) / ts);
    const startTileY = Math.floor(this.cameraY / ts);
    const endTileY = Math.ceil((this.cameraY + H) / ts);
    
    for (let y = startTileY; y <= endTileY && y < this.mapData.length; y++) {
      for (let x = startTileX; x <= endTileX && x < this.mapData[0].length; x++) {
        if (y < 0 || x < 0) continue;
        
        const screenX = Math.floor(x * ts - this.cameraX);
        const screenY = Math.floor(y * ts - this.cameraY);
        
        ctx.strokeRect(screenX, screenY, ts, ts);
      }
    }
    
    // Highlight hovered tile
    const worldMouseX = this.mouseX + this.cameraX;
    const worldMouseY = this.mouseY + this.cameraY;
    const tileX = Math.floor(worldMouseX / ts);
    const tileY = Math.floor(worldMouseY / ts);
    
    if (tileY >= 0 && tileY < this.mapData.length && 
        tileX >= 0 && tileX < this.mapData[0].length) {
      const screenX = Math.floor(tileX * ts - this.cameraX);
      const screenY = Math.floor(tileY * ts - this.cameraY);
      
      ctx.strokeStyle = 'rgba(255, 255, 100, 0.8)';
      ctx.lineWidth = 3;
      ctx.strokeRect(screenX, screenY, ts, ts);
    }
    
    // Draw tile palette at bottom center
    this._drawTilePalette(ctx, W, H);
  }
  
  _drawTilePalette(ctx, W, H) {
    const paletteW = 320;
    const paletteH = 70;
    const paletteX = (W - paletteW) / 2;
    const paletteY = H - paletteH - 15;
    
    // Palette background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.beginPath();
    ctx.roundRect(paletteX, paletteY, paletteW, paletteH, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(paletteX, paletteY, paletteW, paletteH, 12);
    ctx.stroke();
    
    // Title
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MAP EDITOR — Click tiles to place | E to exit', W / 2, paletteY + 16);
    
    // Tile options
    const tools = [
      { id: 'solid', label: 'Wall', color: '#8b7355' },
      { id: 'water', label: 'Water', color: '#40a4df' },
      { id: 'lava', label: 'Lava', color: '#ff5000' },
      { id: 'erase', label: 'Erase', color: '#333' },
    ];
    
    const btnW = 60;
    const btnH = 32;
    const gap = 8;
    const startX = W / 2 - (tools.length * (btnW + gap) - gap) / 2;
    const btnY = paletteY + 24;
    
    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i];
      const bx = startX + i * (btnW + gap);
      
      const isSelected = this.editTool === tool.id;
      
      // Button background
      ctx.fillStyle = isSelected ? 'rgba(74, 158, 255, 0.3)' : 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.roundRect(bx, btnY, btnW, btnH, 6);
      ctx.fill();
      
      if (isSelected) {
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(bx, btnY, btnW, btnH, 6);
        ctx.stroke();
      }
      
      // Color swatch
      ctx.fillStyle = tool.color;
      ctx.beginPath();
      ctx.roundRect(bx + 4, btnY + 4, btnW - 8, btnH - 16, 3);
      ctx.fill();
      
      // Label
      ctx.fillStyle = 'white';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(tool.label, bx + btnW / 2, btnY + btnH - 4);
    }
    
    // Store button bounds for click detection
    this._editPaletteButtons = tools.map((tool, i) => ({
      ...tool,
      x: startX + i * (btnW + gap),
      y: btnY,
      w: btnW,
      h: btnH,
    }));
  }
  
  renderWorld(ctx, W, H) {
    const ts = this.tileSize;
    
    // Calculate visible tile range
    const startTileX = Math.floor(this.cameraX / ts);
    const endTileX = Math.ceil((this.cameraX + W) / ts);
    const startTileY = Math.floor(this.cameraY / ts);
    const endTileY = Math.ceil((this.cameraY + H) / ts);
    
    // Draw ground/terrain
    for (let y = startTileY; y <= endTileY && y < this.mapData.length; y++) {
      for (let x = startTileX; x <= endTileX && x < this.mapData[0].length; x++) {
        if (y < 0 || x < 0) continue;
        
        const tile = this.mapData[y][x];
        const screenX = Math.floor(x * ts - this.cameraX);
        const screenY = Math.floor(y * ts - this.cameraY);
        
        switch (tile) {
          case 1: // Solid wall/ground
            this.drawTile(ctx, screenX, screenY, 'wall');
            break;
          case 2: // Water
            ctx.fillStyle = this.colors.water;
            ctx.fillRect(screenX, screenY + Math.sin(Date.now() / 500 + x) * 3, ts, ts);
            break;
          case 3: // Lava
            ctx.fillStyle = this.colors.lava;
            const lavaOffset = Math.sin(Date.now() / 300 + x * 2) * 4;
            ctx.fillRect(screenX, screenY + lavaOffset, ts, ts - lavaOffset);
            break;
        }
      }
    }
    
    // Draw decorative elements on ground tiles
    for (let y = startTileY; y <= endTileY && y < this.mapData.length; y++) {
      for (let x = startTileX; x <= endTileX && x < this.mapData[0].length; x++) {
        if (y < 0 || x < 0) continue;
        
        const tile = this.mapData[y][x];
        if (tile === 1) {
          const screenX = Math.floor(x * ts - this.cameraX);
          const screenY = Math.floor(y * ts - this.cameraY);
          
          // Add some grass/detail on top of ground tiles
          if (y > 0 && this.mapData[y-1][x] === 0) {
            ctx.fillStyle = '#5a8c69';
            for (let i = 0; i < 3; i++) {
              const gx = screenX + Math.random() * ts;
              const gy = screenY - 2;
              ctx.fillRect(gx, gy, 2, 4);
            }
          }
        }
      }
    }
    
    // Draw players
    for (const [id, player] of this.players) {
      if (id === this.playerId) continue; // Skip self (drawn separately)
      
      const screenX = player.x - this.cameraX;
      const screenY = player.y - this.cameraY;
      
      this.drawPlayer(ctx, screenX, screenY, player);
    }
    
    // Draw self player with indicator
    const self = this.players.get(this.playerId);
    if (self) {
      const screenX = self.x - this.cameraX;
      const screenY = self.y - this.cameraY;
      
      // Crosshair line from player to mouse
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(this.mouseX, this.mouseY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      this.drawPlayer(ctx, screenX, screenY, self, true);
    }
  }
  
  drawTile(ctx, x, y, type) {
    const ts = this.tileSize;
    
    if (type === 'wall') {
      // Main wall body with shading
      ctx.fillStyle = '#8b7355';
      ctx.fillRect(x, y, ts, ts);
      
      // Top highlight
      ctx.fillStyle = '#a0896b';
      ctx.fillRect(x, y, ts, 4);
      
      // Left shadow
      ctx.fillStyle = '#6b5741';
      ctx.fillRect(x, y, 3, ts);
      
      // Bottom shadow  
      ctx.fillStyle = '#5a4832';
      ctx.fillRect(x, y + ts - 3, ts, 3);
      
      // Right highlight
      ctx.fillStyle = '#967d5f';
      ctx.fillRect(x + ts - 2, y, 2, ts);
      
      // Brick pattern
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.lineWidth = 1;
      
      // Horizontal lines
      for (let ly = y + 16; ly < y + ts; ly += 16) {
        ctx.beginPath();
        ctx.moveTo(x, ly);
        ctx.lineTo(x + ts, ly);
        ctx.stroke();
      }
      
      // Vertical lines (staggered)
      for (let row = 0; row < 4; row++) {
        const offset = row % 2 === 0 ? 0 : ts / 2;
        for (let lx = x + offset; lx < x + ts; lx += ts / 2) {
          ctx.beginPath();
          ctx.moveTo(lx, y + row * 16);
          ctx.lineTo(lx, y + (row + 1) * 16);
          ctx.stroke();
        }
      }
    }
  }
  
  drawPlayer(ctx, x, y, player, isSelf = false) {
    const radius = 18;
    // Use custom color if set, otherwise fall back to team color
    const color = player.customColor || this.teamColors[player.team] || '#aaaaaa';
    
    // Shadow under player
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + radius - 2, radius * 0.8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Body (circle)
    const bodyGrad = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, radius);
    bodyGrad.addColorStop(0, this.lightenColor(color, 40));
    bodyGrad.addColorStop(1, color);
    
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Border
    ctx.strokeStyle = this.darkenColor(color, 40);
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Tiny feet — larger ovals below the body with shading like the player
    const footY = y + radius + 1;
    const footSpread = 10;
    
    // Left foot (oval with gradient)
    const leftFootX = x - footSpread;
    const footGradL = ctx.createRadialGradient(leftFootX - 1, footY - 1.5, 0.5, leftFootX, footY, 8);
    footGradL.addColorStop(0, this.lightenColor(color, 20));
    footGradL.addColorStop(1, this.darkenColor(color, 40));
    ctx.fillStyle = footGradL;
    ctx.beginPath();
    ctx.ellipse(leftFootX, footY, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Right foot (oval with gradient)
    const rightFootX = x + footSpread;
    const footGradR = ctx.createRadialGradient(rightFootX - 1, footY - 1.5, 0.5, rightFootX, footY, 8);
    footGradR.addColorStop(0, this.lightenColor(color, 20));
    footGradR.addColorStop(1, this.darkenColor(color, 40));
    ctx.fillStyle = footGradR;
    ctx.beginPath();
    ctx.ellipse(rightFootX, footY, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Eye — simple white circle with black dot, positioned above center
    const eyeAngle = player.facingAngle || 0;
    const eyeDist = radius * 0.35;
    const eyeX = x + Math.cos(eyeAngle) * eyeDist;
    const eyeY = y + Math.sin(eyeAngle) * eyeDist - 4;
    
    // White circle (sclera) — round, not oval
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    
    // Black dot (pupil) — offset toward aiming direction
    const pupilOffsetX = Math.cos(eyeAngle) * 2;
    const pupilOffsetY = Math.sin(eyeAngle) * 2;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(eyeX + pupilOffsetX, eyeY + pupilOffsetY, 2.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Weapon indicator (detailed, per-weapon-type)
    this.drawPlayerWeapon(ctx, x, y, player.facingAngle || 0, radius, player.activeWeapon);
    
    // Player name tag
    ctx.fillStyle = 'white';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, x, y - radius - 8);
    
    // Health bar under name
    const barWidth = 36;
    const barHeight = 4;
    const healthPct = player.health / 100;
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x - barWidth/2, y - radius - 4, barWidth, barHeight);
    
    if (healthPct > 0.6) {
      ctx.fillStyle = '#4aff8b';
    } else if (healthPct > 0.3) {
      ctx.fillStyle = '#ffaa00';
    } else {
      ctx.fillStyle = '#ff3333';
    }
    
    ctx.fillRect(x - barWidth/2, y - radius - 4, barWidth * healthPct, barHeight);
    
    // Self indicator (star)
    if (isSelf) {
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  
  // ─── Player Weapon Display ──────────────────────────────────────────────
  
  drawPlayerWeapon(ctx, px, py, angle, radius, weaponKey) {
    const weaponLen = radius + 16;
    const wx = px + Math.cos(angle) * weaponLen;
    const wy = py + Math.sin(angle) * weaponLen;
    
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    
    // Draw weapon-specific icon at player's facing direction
    switch (weaponKey) {
      case 'gun':          this.drawMiniGun(ctx, radius + 4); break;
      case 'shotgun':      this.drawMiniShotgun(ctx, radius + 4); break;
      case 'rocket':       this.drawMiniRocket(ctx, radius + 4); break;
      case 'minigun':      this.drawMiniMinigun(ctx, radius + 4); break;
      case 'laser':        this.drawMiniLaser(ctx, radius + 4); break;
      default:             this.drawMiniGun(ctx, radius + 4); break;
    }
    
    ctx.restore();
  }
  
  drawMiniGun(ctx, offset) {
    // Simple pistol shape
    ctx.fillStyle = '#555';
    ctx.fillRect(offset, -2.5, 10, 5);
    ctx.fillStyle = '#444';
    ctx.fillRect(offset - 3, -1.5, 5, 4);
    // Muzzle
    ctx.fillStyle = '#888';
    ctx.fillRect(offset + 9, -3, 3, 6);
  }
  
  drawMiniShotgun(ctx, offset) {
    // Thicker barrel
    ctx.fillStyle = '#6b4226';
    ctx.fillRect(offset, -3.5, 14, 7);
    ctx.fillStyle = '#888';
    ctx.fillRect(offset + 3, -2, 9, 4);
    // Stock hint
    ctx.fillStyle = '#6b4226';
    ctx.fillRect(offset - 5, -3, 6, 6);
    // Muzzle
    ctx.fillStyle = '#999';
    ctx.fillRect(offset + 13, -4, 3, 8);
  }
  
  drawMiniRocket(ctx, offset) {
    // Tube body
    ctx.fillStyle = '#556b2f';
    ctx.beginPath();
    ctx.roundRect(offset - 2, -5, 16, 10, 2);
    ctx.fill();
    // Nose cone (red)
    ctx.fillStyle = '#cc2222';
    ctx.beginPath();
    ctx.moveTo(offset + 14, -4);
    ctx.lineTo(offset + 20, 0);
    ctx.lineTo(offset + 14, 4);
    ctx.closePath();
    ctx.fill();
    // Fins
    ctx.fillStyle = '#8b0000';
    ctx.beginPath();
    ctx.moveTo(offset - 2, -5);
    ctx.lineTo(offset + 2, -9);
    ctx.lineTo(offset + 4, -5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(offset - 2, 5);
    ctx.lineTo(offset + 2, 9);
    ctx.lineTo(offset + 4, 5);
    ctx.closePath();
    ctx.fill();
  }
  
  drawMiniMinigun(ctx, offset) {
    // Motor housing
    ctx.fillStyle = '#4a7c59';
    ctx.fillRect(offset - 6, -5, 8, 10);
    // Barrel cluster (3 circles for rotating barrels)
    ctx.fillStyle = '#666';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(offset + 2, i * 3.5, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Main barrel
    ctx.fillStyle = '#888';
    ctx.fillRect(offset + 4, -2, 10, 4);
    // Flash hider
    ctx.fillStyle = '#777';
    ctx.fillRect(offset + 13, -3.5, 4, 7);
  }
  
  drawMiniLaser(ctx, offset) {
    // Body
    ctx.fillStyle = '#2a5f8f';
    ctx.beginPath();
    ctx.roundRect(offset - 2, -5, 14, 10, 1.5);
    ctx.fill();
    // Barrel
    ctx.fillStyle = '#4488cc';
    ctx.fillRect(offset + 10, -2.5, 6, 5);
    // Lens (glowing)
    const lensPulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(68, 170, 255, ${lensPulse})`;
    ctx.beginPath();
    ctx.arc(offset + 17, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Energy cell (red)
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(offset - 6, -3, 5, 6);
  }
  
  renderProjectiles(ctx) {
    for (const proj of this.projectiles) {
      const screenX = proj.x - this.cameraX;
      const screenY = proj.y - this.cameraY;
      
      // Skip if off-screen
      if (screenX < -50 || screenX > this.canvas.width + 50 || 
          screenY < -50 || screenY > this.canvas.height + 50) continue;
      
      const color = proj.color || '#ffcc00';
      const trailColor = proj.trailColor || 'rgba(255, 204, 0, 0.3)';
      const size = proj.size || 4;
      const weaponType = proj.weaponType || 'gun';
      
      // Draw weapon-specific projectile
      switch (weaponType) {
        case 'rocket': this.drawRocketProjectile(ctx, screenX, screenY, proj); break;
        case 'shotgun': this.drawShotgunPellet(ctx, screenX, screenY, proj); break;
        case 'laser': this.drawLaserBeam(ctx, screenX, screenY, proj); break;
        case 'minigun': this.drawMinigunTracer(ctx, screenX, screenY, proj); break;
        default: this.drawGunProjectile(ctx, screenX, screenY, proj); break;
      }
    }
  }
  
  drawGunProjectile(ctx, x, y, proj) {
    const color = proj.color || '#ffcc00';
    const trailColor = proj.trailColor || 'rgba(255, 204, 0, 0.3)';
    const size = proj.size || 4;
    
    // Trail (bullet path)
    ctx.strokeStyle = trailColor;
    ctx.lineWidth = Math.max(1, size * 0.6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - proj.vx * 0.015, y - proj.vy * 0.015);
    ctx.stroke();
    
    // Glow
    const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, size * 2.5);
    glowGrad.addColorStop(0, color + '88');
    glowGrad.addColorStop(1, color + '00');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Bullet core (small sphere)
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    
    // Bright center highlight
    ctx.fillStyle = '#ffffff88';
    ctx.beginPath();
    ctx.arc(x - size * 0.2, y - size * 0.2, size * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  
  drawRocketProjectile(ctx, x, y, proj) {
    const color = proj.color || '#ff4444';
    const trailColor = proj.trailColor || 'rgba(255, 68, 68, 0.4)';
    const size = proj.size || 6;
    
    // Calculate angle from velocity
    const angle = Math.atan2(proj.vy, proj.vx);
    
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    
    // Smoke trail (behind rocket)
    for (let i = 1; i <= 5; i++) {
      const tx = -i * size * 1.2;
      const alpha = (1 - i / 6) * 0.3;
      const smokeSize = size * (0.8 + i * 0.3);
      ctx.fillStyle = `rgba(150, 150, 150, ${alpha})`;
      ctx.beginPath();
      ctx.arc(tx, Math.sin(i * 0.8) * 2, smokeSize, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Rocket body (cylindrical shape)
    const bodyLen = size * 2;
    const bodyRad = size * 0.5;
    
    // Fins (back)
    ctx.fillStyle = '#cc3333';
    // Top fin
    ctx.beginPath();
    ctx.moveTo(-bodyLen * 0.4, -bodyRad);
    ctx.lineTo(-bodyLen * 0.6, -bodyRad * 2);
    ctx.lineTo(-bodyLen * 0.1, -bodyRad);
    ctx.closePath();
    ctx.fill();
    
    // Bottom fin
    ctx.beginPath();
    ctx.moveTo(-bodyLen * 0.4, bodyRad);
    ctx.lineTo(-bodyLen * 0.6, bodyRad * 2);
    ctx.lineTo(-bodyLen * 0.1, bodyRad);
    ctx.closePath();
    ctx.fill();
    
    // Main body
    const bodyGrad = ctx.createLinearGradient(0, -bodyRad, 0, bodyRad);
    bodyGrad.addColorStop(0, '#882222');
    bodyGrad.addColorStop(0.5, color);
    bodyGrad.addColorStop(1, '#882222');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.roundRect(-bodyLen * 0.4, -bodyRad, bodyLen * 0.9, bodyRad * 2, bodyRad);
    ctx.fill();
    
    // Nose cone (pointed)
    ctx.fillStyle = '#ff6644';
    ctx.beginPath();
    ctx.moveTo(bodyLen * 0.5, 0);
    ctx.lineTo(bodyLen * 0.3, -bodyRad);
    ctx.lineTo(bodyLen * 0.3, bodyRad);
    ctx.closePath();
    ctx.fill();
    
    // Thruster glow (back)
    const thrustPulse = Math.sin(Date.now() / 50) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(255, ${Math.floor(160 * thrustPulse)}, 0, ${thrustPulse})`;
    ctx.beginPath();
    ctx.arc(-bodyLen * 0.5, 0, size * 0.4 * thrustPulse, 0, Math.PI * 2);
    ctx.fill();
    
    // Engine exhaust particles
    for (let i = 0; i < 3; i++) {
      const ex = -bodyLen * 0.5 - Math.random() * size * 2;
      const ey = (Math.random() - 0.5) * size;
      ctx.fillStyle = `rgba(255, ${100 + Math.floor(Math.random() * 100)}, 0, ${0.3 + Math.random() * 0.4})`;
      ctx.beginPath();
      ctx.arc(ex, ey, size * (0.1 + Math.random() * 0.2), 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  }
  
  drawShotgunPellet(ctx, x, y, proj) {
    const color = proj.color || '#ff8844';
    const trailColor = proj.trailColor || 'rgba(255, 136, 68, 0.3)';
    const size = proj.size || 3;
    
    // Short, thick trail (shotgun pellets are heavy)
    ctx.strokeStyle = trailColor;
    ctx.lineWidth = Math.max(1, size * 0.5);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - proj.vx * 0.008, y - proj.vy * 0.008);
    ctx.stroke();
    
    // Small glow
    const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, size * 2);
    glowGrad.addColorStop(0, color + '66');
    glowGrad.addColorStop(1, color + '00');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(x, y, size * 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Pellet (small sphere — like a buckshot)
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    
    // Metallic highlight
    ctx.fillStyle = '#ffffff44';
    ctx.beginPath();
    ctx.arc(x - size * 0.15, y - size * 0.15, size * 0.35, 0, Math.PI * 2);
    ctx.fill();
    
    // Shell fragment trail (tiny sparks)
    for (let i = 0; i < 2; i++) {
      const sx = x - proj.vx * 0.01 * (i + 1) + (Math.random() - 0.5) * size;
      const sy = y - proj.vy * 0.01 * (i + 1) + (Math.random() - 0.5) * size;
      ctx.fillStyle = `rgba(255, 200, 100, ${0.3 - i * 0.15})`;
      ctx.beginPath();
      ctx.arc(sx, sy, size * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  drawLaserBeam(ctx, x, y, proj) {
    const color = proj.color || '#44aaff';
    const trailColor = proj.trailColor || 'rgba(68, 170, 255, 0.6)';
    const size = proj.size || 2;
    
    // Laser beam line (instant hit — long bright streak)
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - proj.vx * 0.04, y - proj.vy * 0.04);
    ctx.stroke();
    
    // Inner bright core
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = size;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - proj.vx * 0.03, y - proj.vy * 0.03);
    ctx.stroke();
    
    // Glow pulse at tip
    const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, size * 6);
    glowGrad.addColorStop(0, color + 'aa');
    glowGrad.addColorStop(0.5, color + '33');
    glowGrad.addColorStop(1, color + '00');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(x, y, size * 6, 0, Math.PI * 2);
    ctx.fill();
    
    // Spark particles at tip
    const time = Date.now() / 100;
    for (let i = 0; i < 4; i++) {
      const sparkAngle = (i / 4) * Math.PI * 2 + time;
      const sparkDist = size * (1 + Math.sin(time + i) * 0.5);
      ctx.fillStyle = `rgba(200, 230, 255, ${0.5 - i * 0.1})`;
      ctx.beginPath();
      ctx.arc(x + Math.cos(sparkAngle) * sparkDist, y + Math.sin(sparkAngle) * sparkDist, size * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.shadowBlur = 0;
  }
  
  drawMinigunTracer(ctx, x, y, proj) {
    const color = proj.color || '#44ff88';
    const trailColor = proj.trailColor || 'rgba(68, 255, 136, 0.2)';
    const size = proj.size || 3;
    
    // Long thin tracer trail (minigun rounds leave bright trails)
    ctx.strokeStyle = trailColor;
    ctx.lineWidth = Math.max(1, size * 0.4);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - proj.vx * 0.025, y - proj.vy * 0.025);
    ctx.stroke();
    
    // Tracer glow (green)
    const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, size * 3);
    glowGrad.addColorStop(0, color + '66');
    glowGrad.addColorStop(1, color + '00');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(x, y, size * 3, 0, Math.PI * 2);
    ctx.fill();
    
    // Tracer bullet (small, fast)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, size * 0.7, 0, Math.PI * 2);
    ctx.fill();
    
    // Green outer ring
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.stroke();
    
    // Sparks along trail (minigun rounds spark)
    for (let i = 0; i < 3; i++) {
      const t = (i + 1) / 4;
      const sx = x - proj.vx * 0.025 * t + (Math.random() - 0.5) * size * 2;
      const sy = y - proj.vy * 0.025 * t + (Math.random() - 0.5) * size * 2;
      ctx.fillStyle = `rgba(68, 255, 136, ${0.4 - i * 0.12})`;
      ctx.beginPath();
      ctx.arc(sx, sy, size * (0.15 + Math.random() * 0.15), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  renderGrappleLines(ctx) {
    for (const [id, player] of this.players) {
      if (!player.grappleActive || !player.grappleState || player.grappleState === 'idle') continue;
      
      const screenX = player.x - this.cameraX;
      const screenY = player.y - this.cameraY;
      const hookScreenX = player.grappleX - this.cameraX;
      const hookScreenY = player.grappleY - this.cameraY;
      
      // Skip if both points are far off-screen
      const margin = 100;
      const minX = Math.min(screenX, hookScreenX);
      const maxX = Math.max(screenX, hookScreenX);
      const minY = Math.min(screenY, hookScreenY);
      const maxY = Math.max(screenY, hookScreenY);
      if (maxX < -margin || minX > this.canvas.width + margin || 
          maxY < -margin || minY > this.canvas.height + margin) continue;
      
      // Calculate rope start point at player edge in facing direction
      const angle = player.facingAngle || 0;
      const ropeStartX = screenX + Math.cos(angle) * 20;
      const ropeStartY = screenY + Math.sin(angle) * 20;
      
      // Calculate total distance to anchor
      const totalDist = Math.sqrt(
        (player.grappleX - player.x) ** 2 + (player.grappleY - player.y) ** 2
      );
      
      // Determine how much rope to draw based on state and length
      let drawLength;
      if (player.grappleState === 'extending') {
        // Draw only the extended portion
        drawLength = player.grappleLength || 0;
      } else if (player.grappleState === 'retracting') {
        // Draw retracting rope
        drawLength = player.grappleLength || 0;
      } else {
        // Pulling state — full rope
        drawLength = totalDist;
      }
      
      // Clamp draw length
      drawLength = Math.min(drawLength, totalDist);
      
      // Calculate end point of visible rope
      const ratio = drawLength / totalDist;
      const endX = screenX + (hookScreenX - screenX) * ratio;
      const endY = screenY + (hookScreenY - screenY) * ratio;
      
      // Draw grapple rope (thick, visible line)
      ctx.strokeStyle = '#aaaaaa';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ropeStartX, ropeStartY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      
      // Draw inner rope detail (thinner lighter line)
      ctx.strokeStyle = '#dddddd';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ropeStartX, ropeStartY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      
      // Draw grapple anchor point (bright circle with glow)
      const time = Date.now();
      const pulse = 1 + Math.sin(time / 150) * 0.2;
      
      // Glow effect
      const glowGrad = ctx.createRadialGradient(hookScreenX, hookScreenY, 0, hookScreenX, hookScreenY, 16 * pulse);
      glowGrad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
      glowGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(hookScreenX, hookScreenY, 16 * pulse, 0, Math.PI * 2);
      ctx.fill();
      
      // Anchor point (white circle)
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(hookScreenX, hookScreenY, 5 * pulse, 0, Math.PI * 2);
      ctx.fill();
      
      // Inner dot
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.arc(hookScreenX, hookScreenY, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  renderItems(ctx) {
    const time = Date.now();
    
    for (const item of this.items) {
      const screenX = item.x - this.cameraX;
      const screenY = item.y - this.cameraY;
      
      // Skip if off-screen
      if (screenX < -50 || screenX > this.canvas.width + 50 || 
          screenY < -50 || screenY > this.canvas.height + 50) continue;
      
      // Pulsing animation
      const pulse = 1 + Math.sin(time / 200) * 0.15;
      const size = 14 * pulse;
      
      if (item.type === 'ammo') {
        // Ammo pickup - yellow box with bullet icon
        ctx.save();
        ctx.translate(screenX, screenY);
        
        // Glow effect
        const glowGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, size + 8);
        glowGrad.addColorStop(0, 'rgba(255, 204, 0, 0.4)');
        glowGrad.addColorStop(1, 'rgba(255, 204, 0, 0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(0, 0, size + 8, 0, Math.PI * 2);
        ctx.fill();
        
        // Box body
        ctx.fillStyle = '#ffcc00';
        ctx.fillRect(-size/2, -size/2, size, size);
        ctx.strokeStyle = '#aa8800';
        ctx.lineWidth = 2;
        ctx.strokeRect(-size/2, -size/2, size, size);
        
        // Bullet icon (simple lines)
        ctx.fillStyle = '#664400';
        ctx.fillRect(-2, -size/2 + 3, 4, size - 6);
        ctx.beginPath();
        ctx.arc(0, -size/2 + 3, 3, Math.PI, 0);
        ctx.fill();
        
        // Label
        ctx.fillStyle = 'white';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('AMMO', 0, size/2 + 14);
        
        ctx.restore();
      } else if (item.type === 'health') {
        // Health pickup - green cross with glow
        ctx.save();
        ctx.translate(screenX, screenY);
        
        // Glow effect
        const glowGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, size + 8);
        glowGrad.addColorStop(0, 'rgba(74, 255, 139, 0.4)');
        glowGrad.addColorStop(1, 'rgba(74, 255, 139, 0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(0, 0, size + 8, 0, Math.PI * 2);
        ctx.fill();
        
        // Cross body
        ctx.fillStyle = '#4aff8b';
        const crossW = size / 3;
        // Horizontal bar
        ctx.fillRect(-size/2, -crossW/2, size, crossW);
        // Vertical bar
        ctx.fillRect(-crossW/2, -size/2, crossW, size);
        
        // Border
        ctx.strokeStyle = '#00aa44';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-size/2, -size/2, size, size);
        
        // Label
        ctx.fillStyle = 'white';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('HP', 0, size/2 + 14);
        
        ctx.restore();
      } else if (item.type.startsWith('weapon_')) {
        // Weapon pickup - unique sprite per weapon type
        const weaponKey = item.type;
        const weaponName = weaponKey.replace('weapon_', '');
        this.drawWeaponPickup(ctx, screenX, screenY, weaponName, time);
      }
    }
  }
  
  renderParticles(ctx) {
    const time = Date.now();
    
    for (const p of this.particles) {
      const screenX = p.x - this.cameraX;
      const screenY = p.y - this.cameraY;
      
      // Skip if off-screen or dead
      if (screenX < -50 || screenX > this.canvas.width + 50 || 
          screenY < -50 || screenY > this.canvas.height + 50) continue;
      
      const alpha = Math.max(0, p.life);
      
      // Skip fully dead particles to avoid NaN/negative radius issues
      if (alpha <= 0.01) continue;
      
      // Detect explosion particles by color
      const isExplosion = ['#ff6600', '#ff9900', '#ffcc00', '#ffff66'].includes(p.color);
      const isSpark = p.color === '#ffffff' || p.color.startsWith('#fff');
      
      if (isExplosion) {
        // Fire/explosion particle — large glowing orb
        // Clamp size to avoid negative radius in createRadialGradient
        const size = Math.max(0.5, 8 * alpha + Math.sin(time / 50 + p.x) * 2);
        
        // Outer glow
        const glowGrad = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, size * 2);
        glowGrad.addColorStop(0, p.color + Math.floor(alpha * 80).toString(16).padStart(2, '0'));
        glowGrad.addColorStop(0.5, p.color + Math.floor(alpha * 30).toString(16).padStart(2, '0'));
        glowGrad.addColorStop(1, p.color + '00');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(screenX, screenY, size * 2, 0, Math.PI * 2);
        ctx.fill();
        
        // Core (bright center)
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(screenX, screenY, size * 0.3, 0, Math.PI * 2);
        ctx.fill();
        
        // Main fire color
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha * 0.8;
        ctx.beginPath();
        ctx.arc(screenX, screenY, size, 0, Math.PI * 2);
        ctx.fill();
      } else if (isSpark) {
        // Spark — bright streak
        const size = 2 * alpha;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        
        // Draw as a small line in direction of velocity
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > 0) {
          const nx = p.vx / speed;
          const ny = p.vy / speed;
          ctx.fillRect(
            screenX - nx * size * 2,
            screenY - ny * size * 2,
            size * 4,
            size
          );
        } else {
          ctx.beginPath();
          ctx.arc(screenX, screenY, size, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Generic particle — small dot
        const size = 3 * alpha;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(screenX - size/2, screenY - size/2, size, size);
      }
    }
    
    ctx.globalAlpha = 1;
  }
  
  // ─── Weapon Pickup Sprites ──────────────────────────────────────────────
  
  drawWeaponPickup(ctx, x, y, weaponName, time) {
    const pulse = 1 + Math.sin(time / 200) * 0.1;
    const baseSize = 28 * pulse;
    
    // Ambient glow ring
    ctx.save();
    ctx.translate(x, y);
    
    const wDef = this.weaponDefs[weaponName];
    const color = wDef?.color || '#ff44ff';
    const label = wDef?.name || 'Weapon';
    
    // Outer glow
    const glowGrad = ctx.createRadialGradient(0, 0, baseSize * 0.3, 0, 0, baseSize + 16);
    glowGrad.addColorStop(0, color + '55');
    glowGrad.addColorStop(0.6, color + '22');
    glowGrad.addColorStop(1, color + '00');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(0, 0, baseSize + 16, 0, Math.PI * 2);
    ctx.fill();
    
    // Rotating outer ring (spinning diamond frame)
    const rotAngle = time / 800;
    ctx.save();
    ctx.rotate(rotAngle);
    this.drawWeaponFrame(ctx, baseSize + 4, color);
    ctx.restore();
    
    // Draw weapon-specific icon in center
    switch (weaponName) {
      case 'gun':          this.drawGunSprite(ctx, 0, 0, baseSize * 0.55, time); break;
      case 'shotgun':      this.drawShotgunSprite(ctx, 0, 0, baseSize * 0.55, time); break;
      case 'rocket':       this.drawRocketSprite(ctx, 0, 0, baseSize * 0.55, time); break;
      case 'minigun':      this.drawMinigunSprite(ctx, 0, 0, baseSize * 0.55, time); break;
      case 'laser':        this.drawLaserSprite(ctx, 0, 0, baseSize * 0.55, time); break;
    }
    
    // Label below
    ctx.fillStyle = '#ffffffcc';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    const shortName = label.length > 12 ? label.substring(0, 11) + '…' : label;
    ctx.fillText(shortName.toUpperCase(), 0, baseSize + 18);
    
    // Key hint
    const weaponKeys = ['gun', 'shotgun', 'rocket', 'minigun', 'laser'];
    const idx = weaponKeys.indexOf(weaponName);
    if (idx >= 0) {
      ctx.fillStyle = '#ffffff66';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(`[${idx + 1}]`, 0, -baseSize - 8);
    }
    
    ctx.restore();
  }
  
  drawWeaponFrame(ctx, size, color) {
    // Spinning diamond frame
    const s = size * 0.7;
    ctx.strokeStyle = color + 'aa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(-s, 0);
    ctx.closePath();
    ctx.stroke();
    
    // Corner dots
    const dotSize = 2;
    ctx.fillStyle = color;
    [[0,-s],[s,0],[0,s],[-s,0]].forEach(([cx,cy]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, dotSize, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  
  // ─── Gun Sprite (pistol) ────────────────────────────────────────────────
  
  drawGunSprite(ctx, x, y, s, time) {
    ctx.save();
    ctx.translate(x, y);
    
    // Barrel
    ctx.fillStyle = '#555';
    ctx.fillRect(s * 0.1, -s * 0.12, s * 0.7, s * 0.24);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(s * 0.1, -s * 0.12, s * 0.7, s * 0.24);
    
    // Barrel tip (muzzle)
    ctx.fillStyle = '#888';
    ctx.fillRect(s * 0.75, -s * 0.16, s * 0.15, s * 0.32);
    
    // Body / grip
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, -s * 0.12);
    ctx.lineTo(s * 0.1, -s * 0.12);
    ctx.lineTo(s * 0.05, s * 0.35);
    ctx.lineTo(-s * 0.2, s * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Trigger guard
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s * 0, s * 0.08, s * 0.12, 0, Math.PI);
    ctx.stroke();
    
    // Sight dot (red)
    ctx.fillStyle = '#ff3333';
    ctx.beginPath();
    ctx.arc(s * 0.85, -s * 0.16, s * 0.04, 0, Math.PI * 2);
    ctx.fill();
    
    // Muzzle flash (when "firing" — pulse every second)
    const flash = Math.sin(time / 80) > 0.7 ? 1 : 0;
    if (flash) {
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.arc(s * 0.95, 0, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s * 0.95, 0, s * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  }
  
  // ─── Shotgun Sprite (pump-action) ────────────────────────────────────────
  
  drawShotgunSprite(ctx, x, y, s, time) {
    ctx.save();
    ctx.translate(x, y);
    
    // Main barrel (thicker)
    ctx.fillStyle = '#6b4226';
    ctx.fillRect(s * 0.05, -s * 0.18, s * 0.75, s * 0.36);
    ctx.strokeStyle = '#4a2e18';
    ctx.lineWidth = 1;
    ctx.strokeRect(s * 0.05, -s * 0.18, s * 0.75, s * 0.36);
    
    // Inner barrel (metal tube)
    ctx.fillStyle = '#888';
    ctx.fillRect(s * 0.2, -s * 0.1, s * 0.55, s * 0.2);
    
    // Pump handle (sliding fore-end)
    const pumpOffset = Math.sin(time / 300) * s * 0.08;
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(s * 0.1 + pumpOffset, -s * 0.14, s * 0.25, s * 0.28);
    ctx.strokeStyle = '#5a3a20';
    ctx.lineWidth = 1;
    ctx.strokeRect(s * 0.1 + pumpOffset, -s * 0.14, s * 0.25, s * 0.28);
    
    // Stock / grip
    ctx.fillStyle = '#6b4226';
    ctx.beginPath();
    ctx.moveTo(-s * 0.15, -s * 0.18);
    ctx.lineTo(s * 0.05, -s * 0.18);
    ctx.lineTo(s * 0.0, s * 0.4);
    ctx.lineTo(-s * 0.25, s * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#4a2e18';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Barrel tip / choke
    ctx.fillStyle = '#999';
    ctx.fillRect(s * 0.75, -s * 0.2, s * 0.12, s * 0.4);
    
    // Shell ejection port hint
    ctx.fillStyle = '#aa8833';
    ctx.fillRect(s * 0.3, -s * 0.22, s * 0.15, s * 0.06);
    
    ctx.restore();
  }
  
  // ─── Rocket Launcher Sprite (tube with fins) ─────────────────────────────
  
  drawRocketSprite(ctx, x, y, s, time) {
    ctx.save();
    ctx.translate(x, y);
    
    // Main tube body
    ctx.fillStyle = '#556b2f';
    ctx.beginPath();
    ctx.roundRect(-s * 0.15, -s * 0.35, s * 0.9, s * 0.7, s * 0.08);
    ctx.fill();
    ctx.strokeStyle = '#3a4a20';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Nose cone (red)
    ctx.fillStyle = '#cc2222';
    ctx.beginPath();
    ctx.moveTo(s * 0.75, -s * 0.3);
    ctx.lineTo(s * 1.0, 0);
    ctx.lineTo(s * 0.75, s * 0.3);
    ctx.closePath();
    ctx.fill();
    
    // Fins at back
    const finColor = '#8b0000';
    // Top fin
    ctx.fillStyle = finColor;
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, -s * 0.35);
    ctx.lineTo(s * 0.05, -s * 0.6);
    ctx.lineTo(s * 0.2, -s * 0.35);
    ctx.closePath();
    ctx.fill();
    
    // Bottom fin
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, s * 0.35);
    ctx.lineTo(s * 0.05, s * 0.6);
    ctx.lineTo(s * 0.2, s * 0.35);
    ctx.closePath();
    ctx.fill();
    
    // Barrel ring / sight mount
    ctx.fillStyle = '#444';
    ctx.fillRect(s * 0.5, -s * 0.38, s * 0.12, s * 0.76);
    
    // Sight
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s * 0.56, -s * 0.45);
    ctx.lineTo(s * 0.56, -s * 0.38);
    ctx.stroke();
    
    // Warning stripe on tube
    ctx.fillStyle = '#ffcc00';
    for (let i = 0; i < 3; i++) {
      const sx = s * 0.1 + i * s * 0.2;
      ctx.fillRect(sx, -s * 0.35, s * 0.08, s * 0.7);
    }
    
    // Thruster glow at back (pulsing)
    const thrustPulse = Math.sin(time / 60) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(255, ${Math.floor(140 * thrustPulse)}, 0, ${thrustPulse})`;
    ctx.beginPath();
    ctx.arc(-s * 0.2, 0, s * 0.15 * thrustPulse, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }
  
  // ─── Minigun Sprite (rotating barrels) ──────────────────────────────────
  
  drawMinigunSprite(ctx, x, y, s, time) {
    ctx.save();
    ctx.translate(x, y);
    
    const barrelRot = time / 100; // spinning effect
    
    // Motor housing (back block)
    ctx.fillStyle = '#4a7c59';
    ctx.beginPath();
    ctx.roundRect(-s * 0.35, -s * 0.28, s * 0.35, s * 0.56, s * 0.06);
    ctx.fill();
    ctx.strokeStyle = '#2d5a3e';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Barrel cluster (6 barrels rotating)
    const barrelCount = 6;
    for (let i = 0; i < barrelCount; i++) {
      const angle = barrelRot + (i * Math.PI * 2 / barrelCount);
      const bx = s * 0.15 + Math.cos(angle) * s * 0.12;
      const by = Math.sin(angle) * s * 0.18;
      
      ctx.fillStyle = '#666';
      ctx.beginPath();
      ctx.arc(bx, by, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    
    // Main barrel (center)
    ctx.fillStyle = '#888';
    ctx.fillRect(s * 0.1, -s * 0.12, s * 0.65, s * 0.24);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(s * 0.1, -s * 0.12, s * 0.65, s * 0.24);
    
    // Barrel tip / flash hider
    ctx.fillStyle = '#777';
    ctx.fillRect(s * 0.7, -s * 0.18, s * 0.18, s * 0.36);
    // Flash hider slots
    ctx.fillStyle = '#333';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(s * 0.75 + i * s * 0.04, -s * 0.18, s * 0.02, s * 0.36);
    }
    
    // Ammo feed tray on top
    ctx.fillStyle = '#5a9c69';
    ctx.fillRect(-s * 0.1, -s * 0.42, s * 0.5, s * 0.1);
    ctx.strokeStyle = '#3d7a4e';
    ctx.lineWidth = 1;
    ctx.strokeRect(-s * 0.1, -s * 0.42, s * 0.5, s * 0.1);
    
    // Grip / handle
    ctx.fillStyle = '#3d6b4e';
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, s * 0.28);
    ctx.lineTo(s * 0.05, s * 0.28);
    ctx.lineTo(s * 0.0, s * 0.5);
    ctx.lineTo(-s * 0.15, s * 0.45);
    ctx.closePath();
    ctx.fill();
    
    // Muzzle flash (rapid-fire effect — multiple small flashes)
    const flashPhase = Math.sin(time / 30);
    if (flashPhase > 0.5) {
      const flashIntensity = (flashPhase - 0.5) * 2;
      ctx.fillStyle = `rgba(68, 255, 136, ${flashIntensity * 0.6})`;
      ctx.beginPath();
      ctx.arc(s * 0.95, 0, s * 0.25 * flashIntensity, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
  }
  
  // ─── Laser Sprite (beam emitter) ────────────────────────────────────────
  
  drawLaserSprite(ctx, x, y, s, time) {
    ctx.save();
    ctx.translate(x, y);
    
    // Main body / housing
    ctx.fillStyle = '#2a5f8f';
    ctx.beginPath();
    ctx.roundRect(-s * 0.1, -s * 0.35, s * 0.75, s * 0.7, s * s * 0.04);
    ctx.fill();
    ctx.strokeStyle = '#1a3f5f';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Barrel (sleek tube)
    ctx.fillStyle = '#4488cc';
    ctx.fillRect(s * 0.6, -s * 0.12, s * 0.35, s * 0.24);
    ctx.strokeStyle = '#2a6aaa';
    ctx.lineWidth = 1;
    ctx.strokeRect(s * 0.6, -s * 0.12, s * 0.35, s * 0.24);
    
    // Lens / emitter tip (glowing)
    const lensPulse = Math.sin(time / 150) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(68, 170, 255, ${lensPulse})`;
    ctx.beginPath();
    ctx.arc(s * 1.0, 0, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
    
    // Lens glow ring
    const lensGlow = ctx.createRadialGradient(s * 1.0, 0, 0, s * 1.0, 0, s * 0.3);
    lensGlow.addColorStop(0, `rgba(68, 170, 255, ${lensPulse * 0.4})`);
    lensGlow.addColorStop(1, 'rgba(68, 170, 255, 0)');
    ctx.fillStyle = lensGlow;
    ctx.beginPath();
    ctx.arc(s * 1.0, 0, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
    
    // Energy cell / power pack on back
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(-s * 0.25, -s * 0.18, s * 0.18, s * 0.36);
    ctx.strokeStyle = '#aa2222';
    ctx.lineWidth = 1;
    ctx.strokeRect(-s * 0.25, -s * 0.18, s * 0.18, s * 0.36);
    
    // Energy cell indicator stripes
    ctx.fillStyle = '#ffcc00';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(-s * 0.22, -s * 0.14 + i * s * 0.09, s * 0.12, s * 0.03);
    }
    
    // Sight / scope on top
    ctx.fillStyle = '#333';
    ctx.fillRect(s * 0.15, -s * 0.42, s * 0.3, s * 0.08);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.strokeRect(s * 0.15, -s * 0.42, s * 0.3, s * 0.08);
    
    // Laser beam (emitted when "active" — pulsing)
    const beamPhase = Math.sin(time / 100);
    if (beamPhase > 0) {
      ctx.strokeStyle = `rgba(68, 170, 255, ${beamPhase * 0.8})`;
      ctx.lineWidth = s * 0.06;
      ctx.shadowColor = '#44aaff';
      ctx.shadowBlur = s * 0.3;
      ctx.beginPath();
      ctx.moveTo(s * 1.05, 0);
      ctx.lineTo(s * 1.05 + s * beamPhase * 0.8, 0);
      ctx.stroke();
      
      // Inner bright core of beam
      ctx.strokeStyle = `rgba(200, 230, 255, ${beamPhase * 0.9})`;
      ctx.lineWidth = s * 0.02;
      ctx.beginPath();
      ctx.moveTo(s * 1.05, 0);
      ctx.lineTo(s * 1.05 + s * beamPhase * 0.6, 0);
      ctx.stroke();
      
      ctx.shadowBlur = 0;
    }
    
    // Grip
    ctx.fillStyle = '#2a5f8f';
    ctx.beginPath();
    ctx.moveTo(-s * 0.05, s * 0.35);
    ctx.lineTo(s * 0.15, s * 0.35);
    ctx.lineTo(s * 0.1, s * 0.52);
    ctx.lineTo(-s * 0.05, s * 0.48);
    ctx.closePath();
    ctx.fill();
    
    ctx.restore();
  }
  
  renderMinimap() {
    const ctx = this.minimapCtx;
    const W = 180;
    const H = 135;
    
    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);
    
    if (!this.mapData.length) return;
    
    const mapW = this.mapWidth * this.tileSize;
    const mapH = this.mapHeight * this.tileSize;
    const scaleX = W / mapW;
    const scaleY = H / mapH;
    const scale = Math.min(scaleX, scaleY);
    
    // Draw map tiles (simplified)
    for (let y = 0; y < this.mapData.length; y += 2) {
      for (let x = 0; x < this.mapData[0].length; x += 2) {
        const tile = this.mapData[y][x];
        
        if (tile === 1) {
          ctx.fillStyle = '#8b7355';
        } else if (tile === 2) {
          ctx.fillStyle = 'rgba(64, 164, 223, 0.5)';
        } else if (tile === 3) {
          ctx.fillStyle = 'rgba(255, 80, 0, 0.5)';
        } else {
          continue;
        }
        
        ctx.fillRect(x * this.tileSize * scale, y * this.tileSize * scale, 
                     this.tileSize * 2 * scale + 1, this.tileSize * 2 * scale + 1);
      }
    }
    
    // Draw players on minimap
    for (const [id, player] of this.players) {
      const px = player.x * scale;
      const py = player.y * scale;
      
      ctx.fillStyle = id === this.playerId ? 'white' : 
                      this.teamColors[player.team] || '#aaaaaa';
      ctx.beginPath();
      ctx.arc(px, py, id === this.playerId ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Draw items on minimap (small dots)
    for (const item of this.items) {
      const ix = item.x * scale;
      const iy = item.y * scale;
      
      if (item.type === 'ammo') {
        ctx.fillStyle = '#ffcc00';
      } else if (item.type === 'health') {
        ctx.fillStyle = '#4aff8b';
      } else if (item.type.startsWith('weapon_')) {
        const weaponName = item.type.replace('weapon_', '');
        const wDef = this.weaponDefs[weaponName];
        ctx.fillStyle = wDef?.color || '#ff44ff';
      } else {
        continue;
      }
      ctx.beginPath();
      ctx.arc(ix, iy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Draw camera view rectangle
    const camX = this.cameraX * scale;
    const camY = this.cameraY * scale;
    const camW = this.canvas.width * scale;
    const camH = this.canvas.height * scale;
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(camX, camY, camW, camH);
  }
  
  lightenColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, (num >> 16) + amount);
    const g = Math.min(255, ((num >> 8) & 0x00FF) + amount);
    const b = Math.min(255, (num & 0x0000FF) + amount);
    return `rgb(${r}, ${g}, ${b})`;
  }
  
  darkenColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, (num >> 16) - amount);
    const g = Math.max(0, ((num >> 8) & 0x00FF) - amount);
    const b = Math.max(0, (num & 0x0000FF) - amount);
    return `rgb(${r}, ${g}, ${b})`;
  }
  
  // ─── Audio System ──────────────────────────────────────────────────────
  
  _initAudio() {
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) {
      // Web Audio not supported
    }
  }
  
  _resumeAudio() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }
  
  // Generate a short noise buffer for impacts/explosions
  _createNoiseBuffer(duration) {
    if (!this.audioCtx) return null;
    const sampleRate = this.audioCtx.sampleRate;
    const length = sampleRate * duration;
    const buffer = this.audioCtx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }
    return buffer;
  }
  
  // Shooting sound — punchy transient with descending tone
  _playShoot(weaponKey) {
    this._resumeAudio();
    if (!this.audioCtx) return;
    
    const now = this.audioCtx.currentTime;
    const masterGain = this.audioCtx.createGain();
    masterGain.connect(this.audioCtx.destination);
    
    switch (weaponKey) {
      case 'rocket': {
        // Rocket: deeper boom
        masterGain.gain.setValueAtTime(0.25, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        
        const osc = this.audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.25);
        const oscGain = this.audioCtx.createGain();
        oscGain.gain.value = 0.6;
        osc.connect(oscGain).connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.3);
        
        // Noise burst
        const noise = this.audioCtx.createBufferSource();
        noise.buffer = this._createNoiseBuffer(0.15);
        const nGain = this.audioCtx.createGain();
        nGain.gain.setValueAtTime(0.4, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        noise.connect(nGain).connect(masterGain);
        noise.start(now);
        noise.stop(now + 0.15);
        break;
      }
      case 'shotgun': {
        // Shotgun: loud crack with lots of noise
        masterGain.gain.setValueAtTime(0.3, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        
        const osc = this.audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.15);
        const oscGain = this.audioCtx.createGain();
        oscGain.gain.value = 0.7;
        osc.connect(oscGain).connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.2);
        
        const noise = this.audioCtx.createBufferSource();
        noise.buffer = this._createNoiseBuffer(0.2);
        const nGain = this.audioCtx.createGain();
        nGain.gain.setValueAtTime(0.6, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        noise.connect(nGain).connect(masterGain);
        noise.start(now);
        noise.stop(now + 0.2);
        break;
      }
      case 'minigun': {
        // Minigun: rapid mechanical click
        masterGain.gain.setValueAtTime(0.15, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        
        const osc = this.audioCtx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.05);
        const oscGain = this.audioCtx.createGain();
        oscGain.gain.value = 0.4;
        osc.connect(oscGain).connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.08);
        
        const noise = this.audioCtx.createBufferSource();
        noise.buffer = this._createNoiseBuffer(0.06);
        const nGain = this.audioCtx.createGain();
        nGain.gain.setValueAtTime(0.3, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        noise.connect(nGain).connect(masterGain);
        noise.start(now);
        noise.stop(now + 0.06);
        break;
      }
      case 'laser': {
        // Laser: high-pitched pew
        masterGain.gain.setValueAtTime(0.15, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        
        const osc = this.audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1800, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
        const oscGain = this.audioCtx.createGain();
        oscGain.gain.value = 0.5;
        osc.connect(oscGain).connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.12);
        
        // Subtle harmonic
        const osc2 = this.audioCtx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(3600, now);
        osc2.frequency.exponentialRampToValueAtTime(1200, now + 0.08);
        const osc2Gain = this.audioCtx.createGain();
        osc2Gain.gain.value = 0.15;
        osc2.connect(osc2Gain).connect(masterGain);
        osc2.start(now);
        osc2.stop(now + 0.08);
        break;
      }
      default: {
        // Regular gun: standard pistol shot
        masterGain.gain.setValueAtTime(0.2, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        
        const osc = this.audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(250, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
        const oscGain = this.audioCtx.createGain();
        oscGain.gain.value = 0.5;
        osc.connect(oscGain).connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.15);
        
        // Noise burst for the "bang"
        const noise = this.audioCtx.createBufferSource();
        noise.buffer = this._createNoiseBuffer(0.1);
        const nGain = this.audioCtx.createGain();
        nGain.gain.setValueAtTime(0.4, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        noise.connect(nGain).connect(masterGain);
        noise.start(now);
        noise.stop(now + 0.1);
        break;
      }
    }
  }
  
  // Bullet collision / wall impact — short metallic ping
  _playBulletHit() {
    this._resumeAudio();
    if (!this.audioCtx) return;
    
    const now = this.audioCtx.currentTime;
    const masterGain = this.audioCtx.createGain();
    masterGain.connect(this.audioCtx.destination);
    masterGain.gain.setValueAtTime(0.1, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    
    // Metallic ring
    const osc = this.audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2000 + Math.random() * 1000, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.04);
    const oscGain = this.audioCtx.createGain();
    oscGain.gain.value = 0.3;
    osc.connect(oscGain).connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.06);
    
    // Short noise click
    const noise = this.audioCtx.createBufferSource();
    noise.buffer = this._createNoiseBuffer(0.03);
    const nGain = this.audioCtx.createGain();
    nGain.gain.setValueAtTime(0.2, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    noise.connect(nGain).connect(masterGain);
    noise.start(now);
    noise.stop(now + 0.03);
  }
  
  // Player hit — thud with impact feel
  _playPlayerHit() {
    this._resumeAudio();
    if (!this.audioCtx) return;
    
    const now = this.audioCtx.currentTime;
    const masterGain = this.audioCtx.createGain();
    masterGain.connect(this.audioCtx.destination);
    masterGain.gain.setValueAtTime(0.2, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    
    // Low thud
    const osc = this.audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.08);
    const oscGain = this.audioCtx.createGain();
    oscGain.gain.value = 0.7;
    osc.connect(oscGain).connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
    
    // Impact noise
    const noise = this.audioCtx.createBufferSource();
    noise.buffer = this._createNoiseBuffer(0.06);
    const nGain = this.audioCtx.createGain();
    nGain.gain.setValueAtTime(0.3, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    noise.connect(nGain).connect(masterGain);
    noise.start(now);
    noise.stop(now + 0.06);
  }
  
  // Jump sound — short upward swoosh
  _playJump() {
    this._resumeAudio();
    if (!this.audioCtx) return;
    
    const now = this.audioCtx.currentTime;
    const masterGain = this.audioCtx.createGain();
    masterGain.connect(this.audioCtx.destination);
    masterGain.gain.setValueAtTime(0.1, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    
    // Rising tone
    const osc = this.audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(500, now + 0.08);
    const oscGain = this.audioCtx.createGain();
    oscGain.gain.value = 0.3;
    osc.connect(oscGain).connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
    
    // Air noise
    const noise = this.audioCtx.createBufferSource();
    noise.buffer = this._createNoiseBuffer(0.08);
    const nGain = this.audioCtx.createGain();
    nGain.gain.setValueAtTime(0.15, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    // Bandpass filter for "whoosh" feel
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    filter.Q.value = 0.5;
    noise.connect(filter).connect(nGain).connect(masterGain);
    noise.start(now);
    noise.stop(now + 0.08);
  }
  
  // Grappling hook sounds — fire, extend, pull, retract
  _playGrappleFire() {
    this._resumeAudio();
    if (!this.audioCtx) return;
    
    const now = this.audioCtx.currentTime;
    const masterGain = this.audioCtx.createGain();
    masterGain.connect(this.audioCtx.destination);
    masterGain.gain.setValueAtTime(0.12, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    
    // Whoosh up
    const osc = this.audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.12);
    const oscGain = this.audioCtx.createGain();
    oscGain.gain.value = 0.4;
    osc.connect(oscGain).connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
    
    // Wind noise
    const noise = this.audioCtx.createBufferSource();
    noise.buffer = this._createNoiseBuffer(0.12);
    const nGain = this.audioCtx.createGain();
    nGain.gain.setValueAtTime(0.2, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    noise.connect(nGain).connect(masterGain);
    noise.start(now);
    noise.stop(now + 0.12);
  }
  
  _playGrapplePull() {
    this._resumeAudio();
    if (!this.audioCtx) return;
    
    const now = this.audioCtx.currentTime;
    const masterGain = this.audioCtx.createGain();
    masterGain.connect(this.audioCtx.destination);
    masterGain.gain.setValueAtTime(0.15, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    
    // Mechanical hum
    const osc = this.audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(80, now);
    const oscGain = this.audioCtx.createGain();
    oscGain.gain.value = 0.25;
    osc.connect(oscGain).connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
    
    // Ratcheting noise
    const noise = this.audioCtx.createBufferSource();
    noise.buffer = this._createNoiseBuffer(0.18);
    const nGain = this.audioCtx.createGain();
    nGain.gain.setValueAtTime(0.15, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    noise.connect(nGain).connect(masterGain);
    noise.start(now);
    noise.stop(now + 0.18);
  }
  
  _playGrappleRetract() {
    this._resumeAudio();
    if (!this.audioCtx) return;
    
    const now = this.audioCtx.currentTime;
    const masterGain = this.audioCtx.createGain();
    masterGain.connect(this.audioCtx.destination);
    masterGain.gain.setValueAtTime(0.1, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    
    // Descending mechanical sound
    const osc = this.audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.1);
    const oscGain = this.audioCtx.createGain();
    oscGain.gain.value = 0.2;
    osc.connect(oscGain).connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }
  
  // ─── Sound State Tracking (called from update) ──────────────────────
  
  _updateSounds() {
    const self = this.players.get(this.playerId);
    if (!self) return;
    
    const now = performance.now() / 1000;
    
    // Shooting sound — trigger only when ammo actually decreases (real shot fired)
    const weaponKey = self.activeWeapon || 'gun';
    const currentAmmo = Math.floor(self.weapons?.[weaponKey] ?? -1);
    if (currentAmmo >= 0 && this._lastAmmoCount !== null && currentAmmo < this._lastAmmoCount) {
      // Ammo decreased — a shot just fired
      this._playShoot(weaponKey);
      this._lastWeaponFireTime = now;
    }
    this._lastAmmoCount = currentAmmo;
    
    // Player hit sound — detect health drop
    const currentHealth = self.health;
    if (this._lastHealth > currentHealth && currentHealth >= 0) {
      if (currentHealth <= 0) {
        // Death — deeper thud
        this._playPlayerHit();
      } else if (this._lastHealth - currentHealth > 15) {
        // Big hit
        this._playPlayerHit();
      } else {
        // Small hit — quieter
        this._resumeAudio();
        if (!this.audioCtx) return;
        const now = this.audioCtx.currentTime;
        const masterGain = this.audioCtx.createGain();
        masterGain.connect(this.audioCtx.destination);
        masterGain.gain.setValueAtTime(0.1, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        const osc = this.audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.04);
        const oscGain = this.audioCtx.createGain();
        oscGain.gain.value = 0.3;
        osc.connect(oscGain).connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.06);
      }
    }
    this._lastHealth = currentHealth;
    
    // Jump sound — detect grounded → airborne transition
    const wasGrounded = self.grounded === true;
    if (wasGrounded && !this._wasGrounded) {
      // Just became airborne while moving up
      if (self.vy < -50) {
        this._playJump();
      }
    }
    this._wasGrounded = wasGrounded;
    
    // Grappling hook sounds — detect state changes
    const grappleState = self.grappleState || 'idle';
    if (grappleState !== this._lastGrappleState) {
      switch (grappleState) {
        case 'extending':
          this._playGrappleFire();
          break;
        case 'pulling':
          this._playGrapplePull();
          break;
        case 'retracting':
          this._playGrappleRetract();
          break;
      }
      this._lastGrappleState = grappleState;
    }
    
    // Bullet collision sound — detect projectile count decrease (projectile hit wall)
    if (this.projectiles.length < this._lastProjectileCount) {
      this._playBulletHit();
    }
    this._lastProjectileCount = this.projectiles.length;
  }
  
  // ─── Background Music (Techno/Electronic) ──────────────────────────────
  
  _startMusic() {
    if (!this.audioCtx || !this.musicEnabled) return;
    if (this.musicInterval) return; // Already running

    this._resumeAudio();

    const ctx = this.audioCtx;
    const bpm = 118; // Synthwave tempo — slower, more atmospheric
    const beatDuration = 60 / bpm;
    const stepDuration = beatDuration * 0.5; // 16th notes

    // Master gain (quiet background)
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.07;
    masterGain.connect(ctx.destination);

    // Reverb send for atmospheric depth
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.15;
    const convolver = ctx.createConvolver();
    const reverbLength = ctx.sampleRate * 2;
    const impulse = ctx.createBuffer(2, reverbLength, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < reverbLength; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / reverbLength, 2.5);
      }
    }
    convolver.buffer = impulse;
    convolver.connect(reverbGain);
    reverbGain.connect(masterGain);

    // Delay send for arpeggio
    const delayGain = ctx.createGain();
    delayGain.gain.value = 0.25;
    const delayNode = ctx.createDelay(1.0);
    delayNode.delayTime.value = beatDuration * 0.75; // dotted eighth delay
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 3000;
    delayNode.connect(delayFilter);
    delayFilter.connect(delayGain);
    delayGain.connect(masterGain);

    // ── Synthwave bass: A minor / E minor progression (chorus via dual detuned saws) ──
    const bassNotes = [
      110.00, 110.00, 0, 0, 130.81, 130.81, 0, 0, // A2 bar 1
      98.00, 98.00, 0, 0, 110.00, 110.00, 0, 0,   // G2 bar 2
      110.00, 110.00, 0, 0, 87.31, 87.31, 0, 0,   // A2 / F2 bar 3
      98.00, 98.00, 0, 0, 110.00, 110.00, 0, 0,   // G2 → A2 bar 4 (resolution)
      110.00, 110.00, 0, 0, 130.81, 130.81, 0, 0, // A2 bar 5
      98.00, 98.00, 0, 0, 73.42, 73.42, 0, 0,     // G2 / D2 bar 6
      110.00, 110.00, 0, 0, 87.31, 87.31, 0, 0,   // A2 / F2 bar 7
      98.00, 98.00, 0, 0, 110.00, 110.00, 0, 0,   // G2 → A2 bar 8 (resolution)
    ];

    const kickPattern = [
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, // bar 1: four-on-floor
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, // bar 2: steady
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, // bar 3: four-on-floor
      1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, // bar 4: fill ending
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, // bar 5: four-on-floor
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, // bar 6: steady
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, // bar 7: four-on-floor
      1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, // bar 8: fill ending
    ];

    const snarePattern = [
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, // bar 1: beats 2,4
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, // bar 2
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, // bar 3
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, // bar 4
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, // bar 5
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, // bar 6
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, // bar 7
      0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, // bar 8
    ];

    const hihatPattern = [
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, // bar 1: off-beats only
      0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, // bar 2: sparse ending
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, // bar 3
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, // bar 4: open hat fill
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, // bar 5
      0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, // bar 6: sparse ending
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, // bar 7
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, // bar 8: open hat fill
    ];

    // Synthwave arpeggio: A minor / E minor with dramatic movement
    const arpNotes = [
      220.00, 329.63, 440.00, 329.63, 220.00, 440.00, 329.63, 220.00, // A minor
      261.63, 392.00, 523.25, 392.00, 261.63, 523.25, 392.00, 261.63, // C major
      220.00, 329.63, 440.00, 329.63, 220.00, 440.00, 329.63, 220.00, // A minor
      196.00, 293.66, 392.00, 293.66, 196.00, 392.00, 293.66, 196.00, // G major
      220.00, 329.63, 440.00, 329.63, 220.00, 440.00, 329.63, 220.00, // A minor
      261.63, 392.00, 523.25, 392.00, 261.63, 523.25, 392.00, 261.63, // C major
      220.00, 329.63, 440.00, 329.63, 220.00, 440.00, 329.63, 220.00, // A minor
      196.00, 293.66, 392.00, 293.66, 196.00, 392.00, 293.66, 196.00, // G major
    ];

    let step = 0;

    const playStep = () => {
      if (!this.musicEnabled) return;

      const now = ctx.currentTime;
      const beatIndex = Math.floor(step / 2) % 32;
      const isOffBeat = step % 2 === 1;

      // ── Kick: gated reverb style (sharp attack, medium decay through noise gate) ──
      if (kickPattern[beatIndex]) {
        const kickOsc = ctx.createOscillator();
        const kickGain = ctx.createGain();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(180, now);
        kickOsc.frequency.exponentialRampToValueAtTime(40, now + 0.08);
        kickGain.gain.setValueAtTime(1.0, now);
        kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        kickOsc.connect(kickGain).connect(masterGain);
        kickOsc.start(now);
        kickOsc.stop(now + 0.25);

        // Gated reverb tail
        const revKick = ctx.createBufferSource();
        const revLen = ctx.sampleRate * 0.3;
        const revBuf = ctx.createBuffer(1, revLen, ctx.sampleRate);
        const revData = revBuf.getChannelData(0);
        for (let i = 0; i < revLen; i++) {
          revData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / revLen, 3);
        }
        revKick.buffer = revBuf;
        const revGate = ctx.createGain();
        revGate.gain.setValueAtTime(0.5, now);
        revGate.gain.exponentialRampToValueAtTime(0.001, now + 0.2); // noise gate closes
        revKick.connect(revGate).connect(masterGain);
        revKick.start(now);
        revKick.stop(now + 0.2);
      }

      // ── Snare: bright noise burst on beats 2 and 4 ──
      if (snarePattern[beatIndex]) {
        const snareLen = ctx.sampleRate * 0.15;
        const snareBuf = ctx.createBuffer(1, snareLen, ctx.sampleRate);
        const snareData = snareBuf.getChannelData(0);
        for (let i = 0; i < snareLen; i++) {
          snareData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / snareLen, 2);
        }
        const snareSrc = ctx.createBufferSource();
        snareSrc.buffer = snareBuf;

        // Tone body for punch
        const snareTone = ctx.createOscillator();
        const toneGain = ctx.createGain();
        snareTone.type = 'triangle';
        snareTone.frequency.value = 180;
        toneGain.gain.setValueAtTime(0.4, now);
        toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        snareTone.connect(toneGain).connect(masterGain);
        snareTone.start(now);
        snareTone.stop(now + 0.06);

        // Noise through bandpass
        const snareFilter = ctx.createBiquadFilter();
        snareFilter.type = 'bandpass';
        snareFilter.frequency.value = 4000;
        snareFilter.Q.value = 1.5;
        const snareGain = ctx.createGain();
        snareGain.gain.setValueAtTime(0.6, now);
        snareGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        snareSrc.connect(snareFilter).connect(snareGain).connect(masterGain);
        snareSrc.start(now);
        snareSrc.stop(now + 0.12);

        // Send to reverb for that big gated sound
        snareSrc.connect(convolver);
      }

      // ── Hi-hat: tight closed hats on off-beats, open hats sparingly ──
      if (hihatPattern[beatIndex]) {
        const hatLen = ctx.sampleRate * 0.04;
        const hatBuf = ctx.createBuffer(1, hatLen, ctx.sampleRate);
        const hatData = hatBuf.getChannelData(0);
        for (let i = 0; i < hatLen; i++) {
          hatData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / hatLen, 6);
        }
        const hatSrc = ctx.createBufferSource();
        hatSrc.buffer = hatBuf;

        const hatFilter = ctx.createBiquadFilter();
        hatFilter.type = 'highpass';
        hatFilter.frequency.value = 9000;

        const isFillBeat = beatIndex >= 28 && beatIndex <= 31; // fill bars
        const isOpen = isOffBeat && isFillBeat;

        if (isOpen) {
          const hatGain = ctx.createGain();
          hatGain.gain.setValueAtTime(0.15, now);
          hatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
          hatSrc.connect(hatFilter).connect(hatGain).connect(masterGain);
          hatSrc.start(now);
          hatSrc.stop(now + 0.15);
        } else {
          const hatGain = ctx.createGain();
          hatGain.gain.setValueAtTime(0.08, now);
          hatGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
          hatSrc.connect(hatFilter).connect(hatGain).connect(masterGain);
          hatSrc.start(now);
          hatSrc.stop(now + 0.03);
        }
      }

      // ── Bass: dual detuned saws (chorus effect) with lowpass filter ──
      if (!isOffBeat && bassNotes[beatIndex] > 0) {
        const freq = bassNotes[beatIndex];
        const chorusDetune = 8; // cents

        // Detune left
        const bassOsc1 = ctx.createOscillator();
        bassOsc1.type = 'sawtooth';
        bassOsc1.frequency.value = freq;
        bassOsc1.detune.value = -chorusDetune;
        const bassGain1 = ctx.createGain();
        bassGain1.gain.setValueAtTime(0.35, now);
        bassGain1.gain.exponentialRampToValueAtTime(0.001, now + beatDuration * 0.7);

        // Detune right
        const bassOsc2 = ctx.createOscillator();
        bassOsc2.type = 'sawtooth';
        bassOsc2.frequency.value = freq;
        bassOsc2.detune.value = chorusDetune;
        const bassGain2 = ctx.createGain();
        bassGain2.gain.setValueAtTime(0.35, now);
        bassGain2.gain.exponentialRampToValueAtTime(0.001, now + beatDuration * 0.7);

        // Mono sum through lowpass
        const bassSum = ctx.createGain();
        bassSum.gain.value = 0.5;
        const bassFilter = ctx.createBiquadFilter();
        bassFilter.type = 'lowpass';
        bassFilter.frequency.value = 250;
        bassFilter.Q.value = 2;

        bassOsc1.connect(bassGain1).connect(bassSum);
        bassOsc2.connect(bassGain2).connect(bassSum);
        bassSum.connect(bassFilter).connect(masterGain);

        bassOsc1.start(now);
        bassOsc1.stop(now + beatDuration);
        bassOsc2.start(now);
        bassOsc2.stop(now + beatDuration);
      }

      // ── Lead arpeggio: supersaw with delay and reverb (classic synthwave) ──
      const arpFreq = arpNotes[step % arpNotes.length];
      if (arpFreq > 0) {
        // Dual detuned saws for supersaw thickness
        for (let d = -12; d <= 12; d += 24) {
          const arpOsc = ctx.createOscillator();
          arpOsc.type = 'sawtooth';
          arpOsc.frequency.value = arpFreq;
          arpOsc.detune.value = d;

          const arpFilter = ctx.createBiquadFilter();
          arpFilter.type = 'lowpass';
          arpFilter.frequency.value = 4000;
          arpFilter.Q.value = 1;

          const arpGain = ctx.createGain();
          arpGain.gain.setValueAtTime(0.04, now);
          arpGain.gain.exponentialRampToValueAtTime(0.001, now + stepDuration * 0.6);

          arpOsc.connect(arpFilter).connect(arpGain);
          arpGain.connect(masterGain); // dry
          arpGain.connect(delayNode);  // delay send
          arpGain.connect(convolver);  // reverb send

          arpOsc.start(now);
          arpOsc.stop(now + stepDuration);
        }
      }

      step++;
    };

    // Play initial steps immediately
    for (let i = 0; i < 4; i++) playStep();

    // Schedule subsequent steps
    this.musicInterval = setInterval(() => {
      if (this.musicEnabled) playStep();
    }, stepDuration * 1000);

    this.musicNodes.push(masterGain, reverbGain, delayGain);
  }
  
  _stopMusic() {
    if (this.musicInterval) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
  }
  
  _toggleMusic() {
    this.musicEnabled = !this.musicEnabled;
    
    if (this.musicEnabled) {
      this._startMusic();
    } else {
      this._stopMusic();
    }
    
    // Show brief notification
    const notif = document.getElementById('music-toggle-notif');
    if (notif) {
      notif.textContent = this.musicEnabled ? '🎵 Music ON' : '🔇 Music OFF';
      notif.style.display = 'block';
      setTimeout(() => { notif.style.display = 'none'; }, 1500);
    }
  }
  
  gameLoop() {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05); // Cap delta
    this.lastFrameTime = now;
    
    this.update(dt);
    this.render();
    
    requestAnimationFrame(() => this.gameLoop());
  }
  
  start() {
    this.lastFrameTime = performance.now();
    this.gameLoop();
  }
}

// Start the game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const game = new GameClient();
  game.start();
});
