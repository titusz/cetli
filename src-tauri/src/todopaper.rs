//! Locates an existing TodoPaper (Widefido) installation's user data so Cetli
//! can import preferences, recent files and saved searches on first start.

use serde::Serialize;

/// Raw TodoPaper data found on this machine.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Import {
    /// Contents of `todopaper.settings` (a Python-literal dictionary), if present.
    pub settings: Option<String>,
    /// Recently opened files, most recent first.
    pub recent_files: Vec<String>,
    /// Saved searches, most recent first.
    pub searches: Vec<String>,
    /// Editor font zoom (points added to all font sizes).
    pub zoom: Option<i32>,
    /// Window opacity (0-255).
    pub opacity: Option<u8>,
}

/// Collect TodoPaper data (Windows only; empty elsewhere).
pub fn find() -> Import {
    #[cfg(windows)]
    {
        windows_import()
    }
    #[cfg(not(windows))]
    {
        Import::default()
    }
}

#[cfg(windows)]
fn windows_import() -> Import {
    let settings = std::env::var_os("APPDATA")
        .map(|dir| std::path::PathBuf::from(dir).join("TodoPaper").join("todopaper.settings"))
        .and_then(|path| std::fs::read(path).ok())
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
    Import {
        settings,
        recent_files: registry_values("Software\\TodoPaper\\RecentFiles", "file", 1..=9),
        searches: registry_values("Software\\TodoPaper\\SearchHistory", "Item", 0..=9),
        zoom: registry_zoom(),
        opacity: registry_opacity(),
    }
}

/// Read TodoPaper's editor zoom level (a DWORD holding a signed value).
#[cfg(windows)]
fn registry_zoom() -> Option<i32> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\TodoPaper\\AppState").ok()?;
    let raw: u32 = key.get_value("Zoom").ok()?;
    Some(raw as i32).filter(|z| (-10..=20).contains(z))
}

/// Read TodoPaper's window opacity (255 = opaque).
#[cfg(windows)]
fn registry_opacity() -> Option<u8> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\TodoPaper\\AppState").ok()?;
    let raw: u32 = key.get_value("Opacity").ok()?;
    u8::try_from(raw).ok().filter(|o| *o >= 15)
}

/// Read numbered string values (e.g. file1..file9) from a HKCU registry key, skipping empty ones.
#[cfg(windows)]
fn registry_values(key: &str, prefix: &str, range: std::ops::RangeInclusive<u32>) -> Vec<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(key) else {
        return Vec::new();
    };
    range
        .filter_map(|i| key.get_value::<String, _>(format!("{prefix}{i}")).ok())
        .filter(|v| !v.trim().is_empty())
        .collect()
}
