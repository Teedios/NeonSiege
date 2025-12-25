(() => {
  // ============================================================
  // Neon Siege — 1-for-1 port of TowerWar_Ball2.py (Pythonista)
  // ============================================================

  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });

  let W = 0, H = 0;
  
  const WORLD_W = 830;
  const WORLD_H = 820;   // pick the ratio you want; can tweak

  let view = { scale: 1, ox: 0, oy: 0 };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function absdist(a, b) { return Math.abs(a - b); }
  
  function updateView() {
    // Fit by HEIGHT first (so the battle fills vertically like you want)
    const sH = (H / WORLD_H);

    // Then if screen is too narrow, shrink to also fit width.
    const sW = (W / WORLD_W);

    const s = Math.min(sH, sW);   // never exceed what fits

    view.scale = s;

    // Center world in the available screen space
    const worldPxW = WORLD_W * s;
    const worldPxH = WORLD_H * s;

    view.ox = (W - worldPxW) * 0.5;
    view.oy = (H - worldPxH) * 0.5;
  }

  // ---------- Pythonista-style y-up transform ----------
  function beginFrame() {
    ctx.setTransform(view.scale, 0, 0, -view.scale, view.ox, H - view.oy);
  }
  function endFrame() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------- Drawing helpers ----------
  function fill(r, g, b, a = 1) {
    ctx.fillStyle = `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${a})`;
  }
  function stroke(r, g, b, a = 1) {
    ctx.strokeStyle = `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${a})`;
  }
  function stroke_weight(w) { ctx.lineWidth = w; }
  function no_stroke() { ctx.strokeStyle = "rgba(0,0,0,0)"; }
  function rect(x, y, w, h) { ctx.fillRect(x, y, w, h); }
  function rectScreen(x, y, w, h) {
    endFrame();
    ctx.fillRect(x, H - y - h, w, h); // convert y-up to canvas y-down
    beginFrame();
  }

  function strokeRectScreen(x, y, w, h) {
    endFrame();
    ctx.strokeRect(x, H - y - h, w, h);
    beginFrame();
  }
  function ellipse(x, y, w, h) {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Text: draw upright (because we are in y-up world)
  function text(str, font_size, x, y) {
    endFrame();
    ctx.font = `${font_size}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // convert y-up to canvas y-down
    ctx.fillText(str, x, H - y);
    beginFrame();
  }

  // ---------------- Visual FX ----------------
  class Particle {
    constructor(x, y, vx, vy, life, size, col) {
      this.x = x; this.y = y;
      this.vx = vx; this.vy = vy;
      this.life = life;
      this.size = size;
      this.col = col; // [r,g,b]
      this.alive = true;
    }
    update(dt) {
      this.life -= dt;
      if (this.life <= 0) { this.alive = false; return; }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy -= 90 * dt;
    }
  }

  // ---------------- Castles ----------------
  class Castle {
    constructor(team, x) {
      this.team = team;
      this.x = x;
      this.w = 95;
      this.h = 260;
      this.hp = 450;
      this.max_hp = 450;

      // tower weapon config (set in Game.set_weapon)
      this.weapon_name = "Ballista";
      this.cooldown = 0.9;
      this.timer = 0.0;
      this.proj_speed = 440;
      this.proj_radius = 7;
      this.proj_damage = 16; // flat dmg
    }

    base_y(ground_y) { return ground_y + 30; }

    rect_bounds(ground_y) {
      const by = this.base_y(ground_y);
      const left = this.x - this.w / 2;
      const right = this.x + this.w / 2;
      const bottom = by;
      const top = by + this.h;
      return [left, right, bottom, top];
    }

    tower_muzzle(ground_y) {
      const by = this.base_y(ground_y);
      return [this.x, by + this.h * 0.78];
    }
  }

  // ---------------- Troops ----------------
  class BallUnit {
    // Striker (small), Brute (medium), Tank (large)
    // Troop-vs-troop damage remains impact-based.
    constructor(team, x, y, kind) {
      this.team = team;
      this.x = x;
      this.y = y;
      this.kind = kind;
      this.alive = true;

      if (kind === "striker") {
        this.radius = 10;
        this.max_hp = 26;
        this.base_speed = 125;
        this.hit_damage = 8;
        this.hit_cd = 0.20;
        this.bounce_speed = 120;
        this.bounce_time = 0.18;
        this.cost = 16;
      } else if (kind === "brute") {
        this.radius = 14;
        this.max_hp = 56;
        this.base_speed = 88;
        this.hit_damage = 13;
        this.hit_cd = 0.33;
        this.bounce_speed = 98;
        this.bounce_time = 0.16;
        this.cost = 22;
      } else { // tank
        this.radius = 20;
        this.max_hp = 130;
        this.base_speed = 54;
        this.hit_damage = 27;
        this.hit_cd = 0.55;
        this.bounce_speed = 62;
        this.bounce_time = 0.12;
        this.cost = 36;
      }

      this.hp = this.max_hp;
      this.vx = (team === 0) ? this.base_speed : -this.base_speed;

      this.rebound_timer = 0.0;
      this.hit_timer = 0.0;
      this.flash = 0.0;
    }

    mass() { return this.radius * this.radius; }

    take_damage(dmg) {
      this.hp -= dmg;
      this.flash = 0.08;
      if (this.hp <= 0) this.alive = false;
    }
  }

  // ---------------- Tower projectiles ----------------
  class TowerBall {
    // Tower shots:
    // - flat damage on hit (NO velocity scaling)
    // - no knockback (just disappears on hit)
    constructor(team, x, y, vx, vy, radius, flat_damage) {
      this.team = team;
      this.x = x; this.y = y;
      this.vx = vx; this.vy = vy;
      this.radius = radius;
      this.flat_damage = flat_damage;
      this.alive = true;
    }

    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.x < -120 || this.x > WORLD_W + 120 || this.y < -120 || this.y > WORLD_H + 120) {
        this.alive = false;
      }
    }
  }

  // ---------------- Game ----------------
  const Game = {
    // dynamic (set in setup)
    ground_y: 0,
    lane_y: 0,

    player_castle: null,
    enemy_castle: null,

    units: [],
    tower_balls: [],

    // economy
    energy: 40.0,
    max_energy: 120.0,
    energy_rate: 10.0,

    // UI buttons
    btn_h: 80,
    btn_margin: 10,
    buttons: [
      ["STRIKE\n16", "striker"],
      ["BRUTE\n22", "brute"],
      ["TANK\n36", "tank"]
    ],

    // enemy AI
    ai_timer: 0.0,

    // neon visuals
    particles: [],
    max_particles: 220,
    shake: 0.0,
    shake_mag: 0.0,

    // Impact tuning (ONLY troop-vs-troop + troop-vs-castle)
    base_chip: 2.0,
    impact_k: 0.035,
    impact_p: 1.35,
    castle_impact_cap: 85.0,
    castle_mult: 0.85,

    // Formation constraint (prevents swapping)
    formation_pad: 0.25,

    // start screen / loadout
    state: "loadout", // loadout -> play -> win/lose
    weapon_choices: ["Crossbow", "Ballista", "Catapult"],
    pick_weapon: null,
    _loadout_boxes: [],

    setup() {
      this.ground_y = WORLD_H * 0.22;
      this.lane_y = this.ground_y + 34;

      this.player_castle = new Castle(0, 48);
      this.enemy_castle  = new Castle(1, WORLD_W - 48);

      this.units = [];
      this.tower_balls = [];

      this.energy = 40.0;
      this.max_energy = 120.0;
      this.energy_rate = 10.0;

      this.ai_timer = 0.0;

      this.particles = [];
      this.shake = 0.0;
      this.shake_mag = 0.0;

      this.state = "loadout";
      this.weapon_choices = ["Crossbow", "Ballista", "Catapult"];
      this.pick_weapon = null;
      this._loadout_boxes = [];

      // Enemy tower weapon fixed
      this.set_weapon(this.enemy_castle, "Ballista");
    },

    set_weapon(castle, name) {
      castle.weapon_name = name;

      // FLAT damage goals (based on troop HP):
      // Striker HP 26, Brute HP 56, Tank HP 130
      // Crossbow: 1-shot Striker, 2-shot Brute -> 30
      // Ballista: 1-shot Brute, 3-shot Tank -> 56
      // Catapult: almost 1-shot Tank -> 126 (leaves 4)
      if (name === "Crossbow") {
        castle.cooldown = 0.42;
        castle.proj_speed = 620;
        castle.proj_radius = 5;
        castle.proj_damage = 30;
      } else if (name === "Ballista") {
        castle.cooldown = 0.92;
        castle.proj_speed = 470;
        castle.proj_radius = 7;
        castle.proj_damage = 56;
      } else { // Catapult
        castle.cooldown = 1.90;
        castle.proj_speed = 330;
        castle.proj_radius = 10;
        castle.proj_damage = 126;
      }
      castle.timer = 0.0;
    },

    add_hit_fx(x, y, strength = 1.0, col = [1, 1, 1]) {
      const n = Math.floor(6 + 10 * strength);
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * (Math.PI * 2);
        const spd = (70 + Math.random() * (220 - 70)) * strength;
        const vx = Math.cos(ang) * spd;
        const vy = Math.sin(ang) * spd;
        this.particles.push(
          new Particle(
            x, y, vx, vy,
            0.14 + Math.random() * (0.30 - 0.14),
            2 + Math.random() * (4 - 2),
            col
          )
        );
      }
      if (this.particles.length > this.max_particles) {
        this.particles = this.particles.slice(this.particles.length - this.max_particles);
      }
      this.shake = Math.max(this.shake, 0.06 * strength);
      this.shake_mag = Math.max(this.shake_mag, 6 * strength);
    },

    world_offset() {
      if (this.shake <= 0) return [0, 0];
      const ox = (Math.random() * 2 - 1) * this.shake_mag;
      const oy = (Math.random() * 2 - 1) * this.shake_mag;
      return [ox, oy];
    },

    glow_circle(x, y, r, col, a = 1.0) {
      fill(col[0], col[1], col[2], 0.10 * a);
      ellipse(x - r * 2.1, y - r * 2.1, r * 4.2, r * 4.2);
      fill(col[0], col[1], col[2], 0.18 * a);
      ellipse(x - r * 1.5, y - r * 1.5, r * 3.0, r * 3.0);
      fill(col[0], col[1], col[2], 0.95 * a);
      ellipse(x - r, y - r, r * 2, r * 2);
    },

    unit_color(team, kind) {
      if (team === 0) {
        if (kind === "striker") return [0.30, 1.00, 0.85];
        if (kind === "brute")   return [0.55, 0.85, 1.00];
        if (kind === "tank")    return [0.65, 0.70, 1.00];
      } else {
        if (kind === "striker") return [1.00, 0.35, 0.55];
        if (kind === "brute")   return [1.00, 0.55, 0.45];
        if (kind === "tank")    return [1.00, 0.70, 0.35];
      }
      return [1, 1, 1];
    },

    spawn_unit(team, kind) {
      const y = this.lane_y;
      let x;
      if (team === 0) x = this.player_castle.x + this.player_castle.w * 0.70;
      else x = this.enemy_castle.x - this.enemy_castle.w * 0.70;
      this.units.push(new BallUnit(team, x, y, kind));
    },

    // impact damage (troops only)
    impact_damage(hit_damage, rel_speed) {
      const momentum = this.impact_k * Math.pow(Math.max(0.0, rel_speed), this.impact_p);
      return this.base_chip + hit_damage * 0.55 + momentum;
    },
    impact_damage_castle(hit_damage, rel_speed) {
      const rel = Math.min(rel_speed, this.castle_impact_cap);
      const momentum = this.impact_k * Math.pow(rel, this.impact_p);
      return (this.base_chip + hit_damage * 0.55 + momentum) * this.castle_mult;
    },

    enforce_team_order() {
      const pad = this.formation_pad;

      const t0 = this.units.filter(u => u.alive && u.team === 0).sort((a, b) => a.x - b.x);
      for (let i = 1; i < t0.length; i++) {
        const prev = t0[i - 1];
        const cur = t0[i];
        const min_sep = (prev.radius + cur.radius) * (1.0 + pad);
        if (cur.x < prev.x + min_sep) cur.x = prev.x + min_sep;
      }

      const t1 = this.units.filter(u => u.alive && u.team === 1).sort((a, b) => b.x - a.x);
      for (let i = 1; i < t1.length; i++) {
        const prev = t1[i - 1];
        const cur = t1[i];
        const min_sep = (prev.radius + cur.radius) * (1.0 + pad);
        if (cur.x > prev.x - min_sep) cur.x = prev.x - min_sep;
      }
    },

    resolve_unit_collisions() {
      this.units.sort((a, b) => a.x - b.x);
      for (let i = 0; i < this.units.length - 1; i++) {
        const a = this.units[i];
        const b = this.units[i + 1];
        if (!a.alive || !b.alive) continue;
        if (a.team === b.team) continue;

        const gap = Math.abs(b.x - a.x);
        if (gap <= (a.radius + b.radius)) {
          if (a.hit_timer <= 0 && b.hit_timer <= 0) {
            const rel = Math.abs(a.vx - b.vx);

            const msum = a.mass() + b.mass();
            const a_share = a.mass() / msum;
            const b_share = b.mass() / msum;

            const dmg_to_b = this.impact_damage(a.hit_damage, rel) * a_share;
            const dmg_to_a = this.impact_damage(b.hit_damage, rel) * b_share;

            b.take_damage(dmg_to_b);
            a.take_damage(dmg_to_a);

            const midx = (a.x + b.x) * 0.5;
            this.add_hit_fx(midx, this.lane_y, 0.9, [0.95, 0.95, 1.0]);

            a.rebound_timer = a.bounce_time;
            b.rebound_timer = b.bounce_time;
            a.hit_timer = a.hit_cd;
            b.hit_timer = b.hit_cd;

            a.vx = -Math.abs(a.bounce_speed);
            b.vx =  Math.abs(b.bounce_speed);
          }

          const overlap = (a.radius + b.radius) - gap;
          if (overlap > 0) {
            a.x -= overlap * 0.5;
            b.x += overlap * 0.5;
          }
        }
      }
    },

    resolve_castle_collisions() {
      // Troops still use impact vs castle
      for (const u of this.units) {
        if (!u.alive || u.hit_timer > 0) continue;

        const enemy = (u.team === 0) ? this.enemy_castle : this.player_castle;
        const [left, right, bottom, top] = enemy.rect_bounds(this.ground_y);

        if (u.team === 0) {
          if (u.x + u.radius >= left && bottom <= u.y && u.y <= top) {
            const rel = Math.abs(u.vx);
            enemy.hp -= this.impact_damage_castle(u.hit_damage, rel);
            this.add_hit_fx(left, u.y, 1.2, [1.0, 0.85, 0.35]);
            u.rebound_timer = u.bounce_time;
            u.hit_timer = u.hit_cd;
            u.vx = -Math.abs(u.bounce_speed);
            u.x = left - u.radius - 1;
          }
        } else {
          if (u.x - u.radius <= right && bottom <= u.y && u.y <= top) {
            const rel = Math.abs(u.vx);
            enemy.hp -= this.impact_damage_castle(u.hit_damage, rel);
            this.add_hit_fx(right, u.y, 1.2, [1.0, 0.85, 0.35]);
            u.rebound_timer = u.bounce_time;
            u.hit_timer = u.hit_cd;
            u.vx = Math.abs(u.bounce_speed);
            u.x = right + u.radius + 1;
          }
        }
      }
    },

    // tower firing
    fire_tower(castle) {
      const enemies = this.units.filter(u => u.alive && u.team !== castle.team);
      if (!enemies.length) return;

      const [cx, cy] = castle.tower_muzzle(this.ground_y);
      let best = enemies[0];
      let bestD = Math.abs(best.x - cx);
      for (let i = 1; i < enemies.length; i++) {
        const d = Math.abs(enemies[i].x - cx);
        if (d < bestD) { bestD = d; best = enemies[i]; }
      }

      const dx = best.x - cx;
      const dy = best.y - cy;
      const d = Math.max(1.0, Math.hypot(dx, dy));
      const vx = (dx / d) * castle.proj_speed;
      const vy = (dy / d) * castle.proj_speed;

      this.tower_balls.push(new TowerBall(
        castle.team, cx, cy, vx, vy,
        castle.proj_radius, castle.proj_damage
      ));
    },

    update_towers(dt) {
      for (const c of [this.player_castle, this.enemy_castle]) {
        c.timer = Math.max(0.0, c.timer - dt);
        if (c.timer <= 0.0) {
          c.timer = c.cooldown;
          this.fire_tower(c);
        }
      }
    },

    update_tower_balls(dt) {
      // FLAT damage on hit, no knockback, no impact math.
      for (const p of this.tower_balls) {
        if (!p.alive) continue;
        p.update(dt);

        // hit enemy units
        for (const u of this.units) {
          if (!u.alive || u.team === p.team) continue;
          if (absdist(u.x, p.x) <= (u.radius + p.radius) && Math.abs(u.y - p.y) <= (u.radius + p.radius)) {
            u.take_damage(p.flat_damage);
            this.add_hit_fx(p.x, p.y, 0.85, [1.0, 0.95, 0.6]);
            p.alive = false;
            break;
          }
        }

        if (!p.alive) continue;

        // hit castle (flat damage too)
        const enemy = (p.team === 0) ? this.enemy_castle : this.player_castle;
        const [left, right, bottom, top] = enemy.rect_bounds(this.ground_y);

        const in_x = (left - p.radius) <= p.x && p.x <= (right + p.radius);
        const in_y = (bottom - p.radius) <= p.y && p.y <= (top + p.radius);
        if (in_x && in_y) {
          enemy.hp -= p.flat_damage;
          this.add_hit_fx(p.x, p.y, 1.0, [1.0, 0.85, 0.35]);
          p.alive = false;
        }
      }

      this.tower_balls = this.tower_balls.filter(p => p.alive);
    },

    // state transitions
    start_match() {
      this.set_weapon(this.player_castle, this.pick_weapon || "Ballista");

      this.units = [];
      this.tower_balls = [];
      this.particles = [];
      this.ai_timer = 0.0;

      this.energy = 40.0;
      this.player_castle.hp = this.player_castle.max_hp;
      this.enemy_castle.hp = this.enemy_castle.max_hp;
      this.player_castle.timer = 0.0;
      this.enemy_castle.timer = 0.0;

      this.state = "play";
    },

    // update
    update(dt) {
      if (this.state !== "play") return;

      if (this.shake > 0) {
        this.shake -= dt;
        if (this.shake <= 0) this.shake_mag = 0.0;
      }

      for (const pt of this.particles) pt.update(dt);
      this.particles = this.particles.filter(pt => pt.alive);

      this.energy = clamp(this.energy + this.energy_rate * dt, 0, this.max_energy);

      // enemy AI spawns
      this.ai_timer += dt;
      if (this.ai_timer >= 2.0) {
        this.ai_timer = 0.0;
        const alive_enemy = this.units.filter(u => u.alive && u.team === 1);
        if (alive_enemy.length < 5) {
          const r = Math.random();
          if (r < 0.45) this.spawn_unit(1, "striker");
          else if (r < 0.82) this.spawn_unit(1, "brute");
          else this.spawn_unit(1, "tank");
        }
      }

      // troops move
      for (const u of this.units) {
        if (!u.alive) continue;

        u.flash = Math.max(0.0, u.flash - dt);
        u.hit_timer = Math.max(0.0, u.hit_timer - dt);

        if (u.rebound_timer > 0) u.rebound_timer -= dt;
        else u.vx = (u.team === 0) ? u.base_speed : -u.base_speed;

        u.x += u.vx * dt;
      }

      this.enforce_team_order();
      this.resolve_unit_collisions();
      this.resolve_castle_collisions();
      this.enforce_team_order();

      this.update_towers(dt);
      this.update_tower_balls(dt);

      this.units = this.units.filter(u => u.alive);

      if (this.enemy_castle.hp <= 0) this.state = "win";
      else if (this.player_castle.hp <= 0) this.state = "lose";
    },

    // ---------- Input ----------
    touch_began(xW, yW, xS, yS) {
      if (this.state === "loadout") {
        const x = xS, y = yS;   // ✅ screen-space hit testing

        for (const box of this._loadout_boxes) {
          const [bx, by, bw, bh, name] = box;
          if (bx <= x && x <= bx + bw && by <= y && y <= by + bh) {
            this.pick_weapon = name;
            return;
          }
        }

        if (this.pick_weapon != null) {
          if ((W * 0.18 <= x && x <= W * 0.82) && (H * 0.10 - 26 <= y && y <= H * 0.10 + 26)) {
            this.start_match();
          }
        }
        return;
      }

      // ---- gameplay uses world coords ----
      const x = xW, y = yW;

      if (this.state === "win" || this.state === "lose") {
        this.setup();
        return;
      }

      if (y <= this.btn_h + 10) {
        const bw = (WORLD_W - this.btn_margin * 2) / this.buttons.length;
        let idx = Math.floor((x - this.btn_margin) / bw);
        idx = clamp(idx, 0, this.buttons.length - 1);
        const kind = this.buttons[idx][1];
        const tmp = new BallUnit(0, 0, 0, kind);
        if (this.energy >= tmp.cost) {
          this.energy -= tmp.cost;
          this.spawn_unit(0, kind);
        }
      }
    },

    // ---------- Drawing ----------
    draw() {
      if (this.state === "loadout") {
        this.draw_loadout();
        return;
      }

      const [ox, oy] = this.world_offset();
      this.draw_background(ox, oy);

      this.draw_castle(this.player_castle, ox, oy);
      this.draw_castle(this.enemy_castle, ox, oy);

      for (const p of this.tower_balls) {
        const col = (p.team === 0) ? [0.95, 0.95, 1.00] : [1.00, 0.80, 0.25];
        this.glow_circle(p.x + ox, p.y + oy, p.radius, col, 0.95);
      }

      for (const u of this.units) {
        const col = this.unit_color(u.team, u.kind);

        fill(col[0], col[1], col[2], 0.10);
        ellipse(u.x - u.radius * 1.4 + ox, this.lane_y - 10 + oy, u.radius * 2.8, 10);

        this.glow_circle(u.x + ox, u.y + oy, u.radius, col, 1.0);

        if (u.flash > 0) {
          const a = 0.9 * (u.flash / 0.08);
          stroke(1, 1, 1, a);
          stroke_weight(2);
          // ring
          ctx.beginPath();
          ctx.ellipse(u.x + ox, u.y + oy, u.radius * 1.25, u.radius * 1.25, 0, 0, Math.PI * 2);
          ctx.stroke();
          no_stroke();
        }

        // hp bar
        const hp_w = (u.kind !== "tank") ? 44 : 54;
        const hp_h = 7;
        const frac = Math.max(0.0, u.hp / u.max_hp);

        fill(0.05, 0.05, 0.06, 0.85);
        rect(u.x - hp_w / 2 + ox, u.y + u.radius + 6 + oy, hp_w, hp_h);

        fill(col[0], col[1], col[2], 0.85);
        rect(u.x - hp_w / 2 + ox, u.y + u.radius + 6 + oy, hp_w * frac, hp_h);
      }

      for (const pt of this.particles) {
        fill(pt.col[0], pt.col[1], pt.col[2], 0.7);
        ellipse(pt.x - pt.size + ox, pt.y - pt.size + oy, pt.size * 2, pt.size * 2);
      }

      this.draw_hud();
      this.draw_buttons();

      if (this.state === "win" || this.state === "lose") {
        fill(0, 0, 0, 0.55);
        rect(0, 0, W, H);
        const title = (this.state === "win") ? "VICTORY" : "DEFEAT";
        if (this.state === "win") fill(0.25, 0.95, 0.85, 0.85);
        else fill(1.0, 0.25, 0.45, 0.85);
        text(title, 64, W / 2, H * 0.62);
        fill(1, 1, 1, 0.75);
        text("Tap to restart", 26, W / 2, H * 0.53);
      }
    },

    draw_background(ox, oy) {
      fill(0.03, 0.04, 0.06, 1);
      rect(0, 0, WORLD_W, WORLD_H);
      //for (let i = 0; i < 12; i++) {
        //const t = i / 11;
        //fill(0.03 + 0.03 * t, 0.04 + 0.04 * t, 0.06 + 0.08 * t, 1);
        //rect(0, H * t, W, H / 12 + 2);
      //}

      //fill(0, 0, 0, 0.10);
      //for (let y = 0; y < H; y += 12) rect(0, y, W, 2);

      fill(0.04, 0.05, 0.07, 1);
      rect(0 + ox, 0 + oy, WORLD_W, this.ground_y + 42);

      const lane_y = this.lane_y - 18;
      fill(0.0, 0.0, 0.0, 0.25);
      rect(0 + ox, lane_y - 10 + oy, W, 34);

      stroke(0.25, 0.95, 0.85, 0.35);
      stroke_weight(2);
      line(0 + ox, lane_y + oy, WORLD_W + ox, lane_y + oy);
      no_stroke();

      //stroke(0.25, 0.95, 0.85, 0.12);
      //stroke_weight(1);
      //const step = Math.max(42, (W / 8) | 0);
      //for (let x = 0; x <= W; x += step) {
        //line(x + ox, lane_y - 10 + oy, x + ox, lane_y + 24 + oy);
      //}
      //no_stroke();
    },

    draw_castle(c, ox, oy) {
      const glow = (c.team === 0) ? [0.25, 0.95, 0.85] : [1.0, 0.35, 0.55];
      const by = c.base_y(this.ground_y);

      fill(glow[0], glow[1], glow[2], 0.10);
      rect(c.x - c.w / 2 - 8 + ox, by - 8 + oy, c.w + 16, c.h + 34);

      fill(0.02, 0.03, 0.05, 0.92);
      rect(c.x - c.w / 2 + ox, by + oy, c.w, c.h);

      fill(0.04, 0.06, 0.10, 0.95);
      rect(c.x - c.w / 2 + ox, by + c.h + oy, c.w, 18);

      const [mx, my] = c.tower_muzzle(this.ground_y);
      this.glow_circle(mx + ox, my + oy, 6, glow, 0.65);

      // --- Castle HP bar (WORLD space, scales with tower) ---
      const frac = Math.max(0.0, c.hp / c.max_hp);

      // bar size relative to tower width (so it scales naturally)
      const bar_w = c.w * 1.9;     // tweak: 1.7–2.2
      const bar_h = 10;            // world units
      const bar_y = (by - 26);     // world y under tower base/top area

      // center bar on the tower
      const bar_x = c.x;

      fill(0.02, 0.02, 0.03, 0.85);
      rect(bar_x - bar_w / 2 + ox, bar_y + oy, bar_w, bar_h);

      fill(glow[0], glow[1], glow[2], 0.75);
      rect(bar_x - bar_w / 2 + ox, bar_y + oy, bar_w * frac, bar_h);

      //fill(1, 1, 1, 0.65);
      //text(c.team === 0 ? "YOU" : "ENEMY", 36, x, y + 22);

      //fill(1, 1, 1, 0.45);
      //text(c.weapon_name, 14, x, y - 16);
    },

    draw_hud() {
      const frac = this.energy / this.max_energy;
      const bar_w = W * 0.64;
      const bar_h = 16;
      const x = W / 2;
      const y = this.btn_h + 32;

      fill(0.02, 0.02, 0.03, 0.85);
      rectScreen(x - bar_w / 2, y, bar_w, bar_h);

      fill(0.25, 0.95, 0.85, 0.22);
      rectScreen(x - bar_w / 2 - 6, y - 6, bar_w + 12, bar_h + 12);

      fill(0.25, 0.95, 0.85, 0.75);
      rectScreen(x - bar_w / 2, y, bar_w * frac, bar_h);

      fill(1, 1, 1, 0.70);
      text(`Energy: ${Math.floor(this.energy)}/${Math.floor(this.max_energy)}`, 32, x, y + 40);
    },

    draw_buttons() {
      const bw = (W - this.btn_margin * 2) / this.buttons.length;
      for (let i = 0; i < this.buttons.length; i++) {
        const [label, kind] = this.buttons[i];
        const x0 = this.btn_margin + i * bw;
        const y0 = 8;

        const tmp = new BallUnit(0, 0, 0, kind);
        const affordable = this.energy >= tmp.cost;
        const glow = affordable ? [0.25, 0.95, 0.85] : [0.35, 0.40, 0.45];

        fill(glow[0], glow[1], glow[2], affordable ? 0.12 : 0.06);
        rectScreen(x0 + 4, y0 - 2, bw - 8, this.btn_h + 6);

        fill(0.02, 0.03, 0.05, 0.92);
        rectScreen(x0 + 6, y0, bw - 12, this.btn_h);

        fill(glow[0], glow[1], glow[2], affordable ? 0.90 : 0.35);
        text(label, 36, x0 + bw / 2, y0 + this.btn_h / 2 + 6);
      }
    },

    // loadout
    draw_loadout() {
      this.draw_background(0, 0);

      fill(1, 1, 1, 0.85);
      text("NEON SIEGE", 108, W / 2, H * 0.82);
      fill(1, 1, 1, 0.60);
      text("Pick Your Tower Weapon", 24, W / 2, H * 0.73);

      const bw = W * 0.78;
      const bh = 108;
      const x0 = (W - bw) / 2;
      const start_y = H * 0.60;
      const gap = 18;

      this._loadout_boxes = [];

      for (let i = 0; i < this.weapon_choices.length; i++) {
        const name = this.weapon_choices[i];
        const y0 = start_y - i * (bh + gap);

        const chosen = (this.pick_weapon === name);
        const glow = chosen ? [0.25, 0.95, 0.85] : [1.0, 1.0, 1.0];

        fill(0.25, 0.95, 0.85, chosen ? 0.20 : 0.08);
        rectScreen(x0 - 6, y0 - 6, bw + 12, bh + 12);

        fill(0.02, 0.03, 0.05, 0.92);
        rectScreen(x0, y0, bw, bh);

        fill(1, 1, 1, chosen ? 0.90 : 0.65);
        text(name.toUpperCase(), 52, W / 2, y0 + bh / 2);

        fill(1, 1, 1, 0.45);
        let desc = "";
        if (name === "Crossbow") desc = "1-shots Striker • Fast reload";
        else if (name === "Ballista") desc = "1-shots Brute • Medium reload";
        else desc = "Almost 1-shots Tank • Slow reload";
        //text(desc, 16, W / 2, y0 - 18);

        this._loadout_boxes.push([x0, y0, bw, bh, name]);
      }

      const ready = (this.pick_weapon != null);
      fill(0.30, 1.00, 0.30, ready ? 0.90 : 0.25);
      text("TAP HERE TO START", 28, W / 2, H * 0.10);

      fill(1, 1, 1, 0.35);
      text("In-match: tap bottom buttons to spawn Striker / Brute / Tank",
        14, W / 2, H * 0.04);
    }
  };

  // ---------- Input mapping (pointer -> y-up) ----------
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const dpr = canvas.width / r.width;

    const sx = (e.clientX - r.left) * dpr;
    const sy = (e.clientY - r.top) * dpr;

    // screen y-up coords (no scaling)
    const xS = sx;
    const yS = H - sy;

    // world y-up coords (scaled + centered)
    const xW = (sx - view.ox) / view.scale;
    const yW = ((H - sy) - view.oy) / view.scale;

    Game.touch_began(xW, yW, xS, yS);
  }, { passive: false });

  // ---------- Resize ----------
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    W = Math.floor(window.innerWidth * dpr);
    H = Math.floor(window.innerHeight * dpr);

    canvas.width = W;
    canvas.height = H;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";

    updateView();   // ✅ recompute scale + center offset
  }
  window.addEventListener("resize", resize);

  // ---------- Main loop ----------
  let last = performance.now();
  function loop(t) {
    const dt = Math.min(0.033, (t - last) / 1000);
    last = t;

    // step like Pythonista default dt=1/60-ish
    const step = 1 / 60;
    let acc = dt;
    while (acc > 0) {
      Game.update(Math.min(step, acc));
      acc -= step;
    }

    // Clear FULL screen (screen space, no scaling)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "rgb(8,10,14)";   // same as your bg vibe
    ctx.fillRect(0, 0, W, H);
    
    beginFrame();
    Game.draw();
    endFrame();

    requestAnimationFrame(loop);
  }

  // Start
  resize();
  Game.setup();
  requestAnimationFrame(loop);
})();
