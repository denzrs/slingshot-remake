//! Daily snapshots of the relay's database: the board is a week that refills itself, but the match
//! statistics are a year that nothing else holds. Once a UTC day the relay writes a consistent copy
//! of the whole file into `BACKUP_DIR` with `VACUUM INTO` (a copy of the file as it lies on disk
//! could catch the WAL half-written) and keeps the newest `BACKUP_KEEP`.
//!
//! The snapshots sit on the relay's own disk: they survive a bad write or a bad migration, not a lost
//! machine. Getting them off the VPS is the deployment's job (`deploy/ionos/README.md`).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};

use tracing::{info, warn};
use turso::{Connection, Database};

use crate::leaderboard::{day_key, today};

/// Snapshots kept before the oldest is deleted: a week, one a day.
pub const DEFAULT_KEEP: usize = 7;
const PREFIX: &str = "slingshot-";
const SUFFIX: &str = ".db";

pub struct Backups {
    _database: Database,
    conn: Connection,
    dir: PathBuf,
    keep: usize,
    /// The last day a snapshot was written (or found), as days since 1970.
    last_day: AtomicI64,
}

impl Backups {
    /// Snapshot `database` into `dir`, creating it. A directory that cannot be made is a deployment
    /// error, like a database that cannot be opened.
    pub fn open(
        database: &Database,
        dir: impl Into<PathBuf>,
        keep: usize,
    ) -> std::io::Result<Self> {
        let dir = dir.into();
        std::fs::create_dir_all(&dir)?;
        let database = database.clone();
        let conn = database.connect().map_err(std::io::Error::other)?;
        Ok(Self {
            _database: database,
            conn,
            dir,
            keep: keep.max(1),
            last_day: AtomicI64::new(i64::MIN),
        })
    }

    /// Write today's snapshot unless there is one already (a restart finds the file and leaves it).
    pub async fn snapshot_if_due(&self) {
        let day = today();
        if self.last_day.load(Ordering::Relaxed) == day {
            return;
        }
        let path = self.path_for(day);
        if path.exists() {
            self.last_day.store(day, Ordering::Relaxed);
            return;
        }
        match self.snapshot(&path).await {
            Ok(()) => {
                self.last_day.store(day, Ordering::Relaxed);
                info!(path = %path.display(), "database snapshot written");
                match self.trim() {
                    Ok(0) => {}
                    Ok(removed) => info!(removed, "old database snapshots removed"),
                    Err(err) => warn!(%err, "removing old database snapshots failed"),
                }
            }
            // Tried again on the next tick: a full disk may have room by then.
            Err(err) => warn!(path = %path.display(), %err, "database snapshot failed"),
        }
    }

    fn path_for(&self, day: i64) -> PathBuf {
        self.dir.join(format!("{PREFIX}{}{SUFFIX}", day_key(day)))
    }

    /// Write into a temporary name and rename it in place, so a snapshot under its day's name is
    /// always a whole one, however the write before it ended.
    async fn snapshot(&self, path: &Path) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let partial = path.with_extension("db.partial");
        remove_with_sidecars(&partial);
        // VACUUM INTO takes the path as a string literal only.
        let target = partial
            .to_str()
            .ok_or("snapshot path is not UTF-8")?
            .replace('\'', "''");
        let written = self
            .conn
            .execute(&format!("VACUUM INTO '{target}'"), ())
            .await;
        if let Err(err) = written {
            remove_with_sidecars(&partial);
            return Err(err.into());
        }
        std::fs::rename(&partial, path)?;
        remove_with_sidecars(&partial);
        Ok(())
    }

    /// Delete all but the newest `keep` snapshots. Only files named like a snapshot are touched.
    fn trim(&self) -> std::io::Result<usize> {
        let mut snapshots: Vec<PathBuf> = std::fs::read_dir(&self.dir)?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| is_snapshot(path))
            .collect();
        // `YYYY-MM-DD` sorts by date.
        snapshots.sort();
        let excess = snapshots.len().saturating_sub(self.keep);
        for path in &snapshots[..excess] {
            std::fs::remove_file(path)?;
        }
        Ok(excess)
    }
}

fn is_snapshot(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix(PREFIX)?.strip_suffix(SUFFIX))
        .is_some_and(|day| crate::leaderboard::day_number(day).is_some())
}

/// A database file and the WAL and shared-memory files the engine may leave beside it.
fn remove_with_sidecars(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let mut name = path.as_os_str().to_owned();
        name.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(name));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("slingshot-backup-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn a_snapshot_holds_the_rows_and_is_written_once_a_day() {
        let dir = scratch("once");
        let database = crate::db::open(dir.join("live.db").to_str().unwrap())
            .await
            .unwrap();
        let conn = database.connect().unwrap();
        conn.execute("CREATE TABLE t (n INTEGER)", ())
            .await
            .unwrap();
        conn.execute("INSERT INTO t VALUES (42)", ()).await.unwrap();

        let backups = Backups::open(&database, dir.join("backups"), DEFAULT_KEEP).unwrap();
        backups.snapshot_if_due().await;
        let path = backups.path_for(today());
        assert!(path.exists());
        assert!(!path.with_extension("db.partial").exists());

        let copy = crate::db::open(path.to_str().unwrap()).await.unwrap();
        let mut rows = copy
            .connect()
            .unwrap()
            .query("SELECT n FROM t", ())
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<i64>(0).unwrap(), 42);

        // A second tick the same day (or a restart) keeps the first snapshot.
        let written = std::fs::metadata(&path).unwrap().modified().unwrap();
        conn.execute("INSERT INTO t VALUES (7)", ()).await.unwrap();
        let again = Backups::open(&database, dir.join("backups"), DEFAULT_KEEP).unwrap();
        again.snapshot_if_due().await;
        assert_eq!(
            std::fs::metadata(&path).unwrap().modified().unwrap(),
            written
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn only_the_newest_snapshots_are_kept() {
        let dir = scratch("trim");
        let database = crate::db::open(":memory:").await.unwrap();
        let backups = Backups::open(&database, &dir, 2).unwrap();
        for day in 20_740..20_744 {
            std::fs::write(backups.path_for(day), b"").unwrap();
        }
        std::fs::write(dir.join("notes.txt"), b"").unwrap();
        assert_eq!(backups.trim().unwrap(), 2);
        let mut left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(
            left,
            [
                "notes.txt",
                "slingshot-2026-10-16.db",
                "slingshot-2026-10-17.db"
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
