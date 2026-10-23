//! The relay's one database file: the daily board and the match statistics live side by side in
//! it, each with its tables and its own connection (the statistics write in transactions, which a
//! connection shared with the board would have to sit through).

use turso::{Builder, Database};

/// Open (or create) the file. A file that cannot be opened is a deployment error, not something to
/// run without.
pub async fn open(path: &str) -> turso::Result<Database> {
    let database = Builder::new_local(path).build().await?;
    // The relay is the only writer; WAL keeps a read off the writer's back.
    let conn = database.connect()?;
    let _ = conn.pragma_update("journal_mode", "WAL").await?;
    Ok(database)
}
