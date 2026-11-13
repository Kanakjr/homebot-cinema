'use strict';
// Quality profiles in SQLite. Built-ins are seeded once (and re-addable via reset); custom ones are free-form.

const { BUILTIN, DEFAULT_KEY, normalizeProfile } = require('./quality');

const fail = (status, message) => Object.assign(new Error(message), { status });

class QualityStore {
    constructor(db) {
        this.db = db;
        this.raw = db.raw;
        this.seed();
    }

    seed() {
        const now = new Date().toISOString();
        const insert = this.raw.prepare('INSERT OR IGNORE INTO quality_profiles (key, name, builtin, config_json, sort, created_at) VALUES (?, ?, 1, ?, ?, ?)');
        BUILTIN.forEach((b, i) => insert.run(b.key, b.config.name, JSON.stringify(normalizeProfile(b.config)), i, now));
        if (!this.raw.prepare("SELECT 1 FROM settings WHERE key = 'default_quality_profile'").get()) {
            const def = this.raw.prepare('SELECT id FROM quality_profiles WHERE key = ?').get(DEFAULT_KEY);
            this.raw.prepare("INSERT INTO settings (key, value) VALUES ('default_quality_profile', ?)").run(String(def.id));
        }
    }

    defaultId() {
        const row = this.raw.prepare("SELECT value FROM settings WHERE key = 'default_quality_profile'").get();
        return row ? Number(row.value) : null;
    }

    shape(r) {
        return { id: r.id, key: r.key, name: r.name, builtin: !!r.builtin, isDefault: r.id === this.defaultId(), config: JSON.parse(r.config_json) };
    }

    list() {
        return this.raw.prepare('SELECT * FROM quality_profiles ORDER BY builtin DESC, sort, id').all().map((r) => this.shape(r));
    }

    get(id) {
        const r = this.raw.prepare('SELECT * FROM quality_profiles WHERE id = ?').get(Number(id));
        return r ? this.shape(r) : null;
    }

    getDefault() {
        return this.get(this.defaultId()) || this.get(this.raw.prepare('SELECT id FROM quality_profiles ORDER BY id LIMIT 1').get().id);
    }

    /** The profile for an id, or the default when the id is missing / deleted. */
    resolve(id) {
        return (id !== null && id !== undefined && this.get(id)) || this.getDefault();
    }

    create(body) {
        const cfg = normalizeProfile(body);
        if (this.raw.prepare('SELECT COUNT(*) c FROM quality_profiles').get().c >= 30) throw fail(409, 'Too many profiles');
        const row = this.raw.prepare('INSERT INTO quality_profiles (key, name, builtin, config_json, sort, created_at) VALUES (NULL, ?, 0, ?, 100, ?) RETURNING *')
            .get(cfg.name, JSON.stringify(cfg), new Date().toISOString());
        return this.shape(row);
    }

    update(id, body) {
        if (!this.get(id)) throw fail(404, 'not_found');
        const cfg = normalizeProfile(body);
        this.raw.prepare('UPDATE quality_profiles SET name = ?, config_json = ? WHERE id = ?').run(cfg.name, JSON.stringify(cfg), Number(id));
        return this.get(id);
    }

    remove(id) {
        const p = this.get(id);
        if (!p) throw fail(404, 'not_found');
        if (p.builtin) throw fail(409, 'Built-in profiles cannot be deleted (you can edit or reset them)');
        if (p.isDefault) this.setDefault(this.raw.prepare('SELECT id FROM quality_profiles WHERE key = ?').get(DEFAULT_KEY).id);
        this.raw.prepare('DELETE FROM quality_profiles WHERE id = ?').run(Number(id));
    }

    reset(id) {
        const p = this.get(id);
        if (!p) throw fail(404, 'not_found');
        const b = BUILTIN.find((x) => x.key === p.key);
        if (!b) throw fail(409, 'Only built-in profiles can be reset');
        this.raw.prepare('UPDATE quality_profiles SET name = ?, config_json = ? WHERE id = ?').run(b.config.name, JSON.stringify(normalizeProfile(b.config)), Number(id));
        return this.get(id);
    }

    setDefault(id) {
        if (!this.get(id)) throw fail(404, 'not_found');
        this.raw.prepare("INSERT INTO settings (key, value) VALUES ('default_quality_profile', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(Number(id)));
    }
}

module.exports = { QualityStore };
