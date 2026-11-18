import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openCache(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, 'translations.sqlite'));
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS page_previews (
      key TEXT PRIMARY KEY, payload TEXT NOT NULL, saved_at INTEGER NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS trim_page_previews AFTER INSERT ON page_previews BEGIN
      DELETE FROM page_previews WHERE saved_at < NEW.saved_at - 86400000 OR rowid IN
        (SELECT rowid FROM page_previews ORDER BY saved_at DESC, rowid DESC LIMIT -1 OFFSET 64);
    END;
    CREATE TABLE IF NOT EXISTS translations (
      id INTEGER NOT NULL, field TEXT NOT NULL, fingerprint TEXT NOT NULL, ko TEXT NOT NULL,
      PRIMARY KEY (id, field, fingerprint)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1), model TEXT NOT NULL DEFAULT '자동',
      realtime INTEGER NOT NULL DEFAULT 1, epoch INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO preferences (id) VALUES (1)
  `);
  if (!db.prepare('PRAGMA table_info(translations)').all().some(row => row.name === 'saved_at'))
    db.exec('ALTER TABLE translations ADD COLUMN saved_at INTEGER NOT NULL DEFAULT 0');
  const columns = db.prepare('PRAGMA table_info(preferences)').all().map(row => row.name);
  if (!columns.includes('cache_field'))
    db.exec("ALTER TABLE preferences ADD COLUMN cache_field TEXT NOT NULL DEFAULT '모든 번역'");
  if (!columns.includes('cache_period'))
    db.exec("ALTER TABLE preferences ADD COLUMN cache_period TEXT NOT NULL DEFAULT '전체 기간'");
  db.exec('COMMIT');

  const current = db.prepare('SELECT model, realtime, epoch, cache_field AS cacheField, cache_period AS cachePeriod FROM preferences WHERE id = 1');
  const update = db.prepare(`UPDATE preferences SET model = coalesce(?, model), realtime = coalesce(?, realtime),
    cache_field = coalesce(?, cache_field), cache_period = coalesce(?, cache_period) WHERE id = 1`);
  const stats = db.prepare('SELECT count(*) AS count, coalesce(sum(length(CAST(ko AS BLOB))), 0) AS bytes FROM translations');
  const remove = db.prepare("DELETE FROM translations WHERE (? = 'all' OR field = ?) AND saved_at >= ? AND (? IS NULL OR saved_at < ?)");
  return {
    readPreview: db.prepare('SELECT payload, saved_at FROM page_previews WHERE key = ? AND saved_at >= ?'),
    writePreview: db.prepare(`INSERT INTO page_previews (key, payload, saved_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, saved_at = excluded.saved_at
      WHERE page_previews.payload != excluded.payload OR page_previews.saved_at < excluded.saved_at - 60000`),
    forgetPreview: db.prepare('DELETE FROM page_previews WHERE key = ?'),
    read: db.prepare('SELECT ko FROM translations WHERE id = ? AND field = ? AND fingerprint = ?'),
    write: db.prepare(`INSERT OR REPLACE INTO translations (id, field, fingerprint, ko, saved_at)
      SELECT ?, ?, ?, ?, ? FROM preferences WHERE id = 1 AND epoch = ?`),
    current: () => current.get(),
    values() {
      const { model, realtime, cacheField, cachePeriod } = current.get();
      return { model, realtime: Boolean(realtime), cacheField, cachePeriod };
    },
    update({ model, realtime, cacheField, cachePeriod }) {
      update.run(model ?? null, realtime == null ? null : Number(realtime), cacheField ?? null, cachePeriod ?? null);
    },
    stats: () => stats.get(),
    clear(field, days, now) {
      if (!['title', 'text', 'all'].includes(field) || ![0, 1, 7, 30].includes(Math.abs(days)))
        throw new Error('삭제 범위를 확인해 주세요.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const cutoff = now - Math.abs(days) * 86400000;
        const oldest = days > 0 ? Math.max(1, cutoff) : (days < 0 ? 1 : 0);
        const before = days < 0 ? cutoff : null;
        const { changes } = remove.run(field, field, oldest, before, before);
        db.exec('UPDATE preferences SET epoch = epoch + 1; COMMIT');
        return { removed: changes, ...stats.get() };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close(),
  };
}
