//! Cetli desktop shell: file IO commands, settings storage, TodoPaper import,
//! document windows, plugins folder, single-instance file forwarding, window
//! transparency, file-drop paths, the Python plugin host and the optional system
//! tray icon.

mod files;
mod python;
mod todopaper;
#[cfg(windows)]
mod winhotkey;
#[cfg(windows)]
mod winspell;
#[cfg(windows)]
mod winwindow;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent};

/// Files passed on the command line of the first instance.
struct LaunchFiles(Vec<String>);

/// The tray icon, while shown.
struct Tray(Mutex<Option<TrayIcon>>);

/// Counter for document window labels ("doc-1", "doc-2", ...).
static NEXT_WINDOW: AtomicU32 = AtomicU32::new(1);

/// Turn command line arguments into absolute paths of existing files.
fn files_from_args(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(a);
            if p.is_absolute() { p } else { cwd.join(p) }
        })
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// Validate a config file name (letters, digits, dash, underscore only).
fn config_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(format!("Invalid config name: {name}"));
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{name}.json")))
}

/// True for windows that hold a document (the main window and "doc-N" windows).
fn is_document_window(label: &str) -> bool {
    label == "main" || label.starts_with("doc-")
}

/// Sort key of a document window label: "main" first, then "doc-N" by N.
fn window_rank(label: &str) -> Option<u32> {
    if label == "main" {
        return Some(0);
    }
    label.strip_prefix("doc-").and_then(|n| n.parse().ok())
}

/// The primary document window ("main" while it exists, otherwise the oldest), ignoring `except`.
fn primary_window_except(app: &AppHandle, except: &str) -> Option<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label != except)
        .filter_map(|(label, w)| window_rank(&label).map(|r| (r, w)))
        .min_by_key(|(r, _)| *r)
        .map(|(_, w)| w)
}

/// The primary document window.
fn primary_window(app: &AppHandle) -> Option<WebviewWindow> {
    primary_window_except(app, "")
}

/// Emit an event to a window.
fn emit_to_window<S: serde::Serialize + Clone>(w: &WebviewWindow, event: &str, payload: S) {
    let _ = w.emit_to(w.label(), event, payload);
}

/// Emit an event to the primary document window.
fn emit_primary<S: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    if let Some(w) = primary_window(app) {
        emit_to_window(&w, event, payload);
    }
}

/// Bring the primary window to the front.
fn show_primary(app: &AppHandle) {
    if let Some(w) = primary_window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Percent-encode a string for use in a URL query value.
fn url_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Window setup shared by all document windows.
fn setup_document_window(window: &WebviewWindow) {
    #[cfg(windows)]
    winwindow::install_drop_bridge(window);
    #[cfg(not(windows))]
    let _ = window;
}

#[tauri::command]
fn read_text_file(path: String) -> Result<files::FileData, String> {
    files::read_text(Path::new(&path))
}

#[tauri::command]
fn write_text_file(path: String, text: String, line_ending: String, encoding: String, bom: bool) -> Result<u64, String> {
    files::write_text(Path::new(&path), &text, &line_ending, &encoding, bom)
}

#[tauri::command]
fn file_mtime(path: String) -> Option<u64> {
    files::mtime_ms(Path::new(&path))
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| format!("Cannot delete {path}: {e}"))
}

#[tauri::command]
fn load_config(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let path = config_path(&app, &name)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn save_config(app: AppHandle, name: String, contents: String) -> Result<(), String> {
    let path = config_path(&app, &name)?;
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    std::fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn launch_files(files: State<LaunchFiles>) -> Vec<String> {
    files.0.clone()
}

/// Development builds never take over TodoPaper's recent files: launched without a file they would otherwise
/// reopen the user's real document.
fn import_for_build(mut found: todopaper::Import, dev_build: bool) -> todopaper::Import {
    if dev_build {
        found.recent_files.clear();
    }
    found
}

#[tauri::command]
fn todopaper_import() -> todopaper::Import {
    import_for_build(todopaper::find(), cfg!(debug_assertions))
}

/// Label of the primary document window.
#[tauri::command]
fn primary_label(app: AppHandle) -> Option<String> {
    primary_window(&app).map(|w| w.label().to_string())
}

/// Open a new document window, optionally loading a file.
#[tauri::command]
async fn new_window(app: AppHandle, path: Option<String>) -> Result<String, String> {
    let label = format!("doc-{}", NEXT_WINDOW.fetch_add(1, Ordering::SeqCst));
    let mut url = String::from("index.html?window=doc");
    if let Some(p) = path {
        url.push_str("&open=");
        url.push_str(&url_encode(&p));
    }
    let window = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
        .title("Cetli")
        .inner_size(960.0, 760.0)
        .min_inner_size(360.0, 240.0)
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| e.to_string())?;
    setup_document_window(&window);
    Ok(label)
}

/// Set the opacity of the calling window (255 = opaque). Windows only.
#[tauri::command]
fn set_window_opacity(window: WebviewWindow, alpha: u8) -> Result<(), String> {
    #[cfg(windows)]
    {
        winwindow::set_opacity(&window, alpha)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, alpha);
        Err("Window transparency is only supported on Windows".into())
    }
}

/// Misspelled (start, length) ranges in UTF-16 units for each text (Windows spell checking service).
#[tauri::command]
fn spell_check(texts: Vec<String>, lang: String) -> Result<Vec<Vec<(u32, u32)>>, String> {
    #[cfg(windows)]
    {
        winspell::check(&texts, &lang)
    }
    #[cfg(not(windows))]
    {
        let _ = (texts, lang);
        Err("unsupported".into())
    }
}

/// Spelling suggestions for a word.
#[tauri::command]
fn spell_suggest(word: String, lang: String) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        winspell::suggest(&word, &lang)
    }
    #[cfg(not(windows))]
    {
        let _ = (word, lang);
        Err("unsupported".into())
    }
}

/// Add a word to the user dictionary.
#[tauri::command]
fn spell_add(word: String, lang: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        winspell::add(&word, &lang)
    }
    #[cfg(not(windows))]
    {
        let _ = (word, lang);
        Err("unsupported".into())
    }
}

/// Languages with an installed spelling dictionary.
#[tauri::command]
fn spell_languages() -> Vec<String> {
    #[cfg(windows)]
    {
        winspell::languages().unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Folder holding Cetli's configuration (for the debug information dialog).
#[tauri::command]
fn config_dir(app: AppHandle) -> Result<String, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.to_string_lossy().into_owned())
}

/// Folder holding JavaScript plugins (created on demand).
#[tauri::command]
fn plugin_dir(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?.join("plugins");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// True for plugin files: JavaScript (*.js) and TodoPaper's Python plugins (*.py, compiled *.todopaper.plugin).
fn is_plugin_file(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    path.is_file() && (name.ends_with(".js") || name.ends_with(".py") || name.ends_with(".todopaper.plugin"))
}

/// Paths of all plugin files (*.js, *.py, *.todopaper.plugin) in the plugins folder, sorted by name.
#[tauri::command]
fn list_plugins(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = PathBuf::from(plugin_dir(app)?);
    let mut files: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| is_plugin_file(p))
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    files.sort();
    Ok(files)
}

/// Start the Python plugin bridge for this window (events carry `token`); returns the interpreter used.
/// Async, so looking for the interpreter never blocks the UI thread.
#[tauri::command]
async fn python_start(app: AppHandle, window: WebviewWindow, hosts: State<'_, python::Hosts>, token: u32) -> Result<String, String> {
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let plugins = PathBuf::from(plugin_dir(app.clone())?);
    python::start(&app, window.label(), token, &hosts, &config, &plugins)
}

/// Send one message line to this window's Python bridge (started with `token`).
#[tauri::command]
fn python_send(window: WebviewWindow, hosts: State<python::Hosts>, token: u32, line: String) -> Result<(), String> {
    python::send(&hosts, window.label(), token, &line)
}

/// Stop this window's Python bridge (started with `token`).
#[tauri::command]
fn python_stop(window: WebviewWindow, hosts: State<python::Hosts>, token: u32) {
    python::stop(&hosts, window.label(), Some(token));
}

/// Show or hide the tray icon.
#[tauri::command]
fn set_tray_visible(app: AppHandle, tray: State<Tray>, visible: bool) -> Result<(), String> {
    let mut slot = tray.0.lock().map_err(|e| e.to_string())?;
    if !visible {
        *slot = None;
        return Ok(());
    }
    if slot.is_some() {
        return Ok(());
    }
    let show = MenuItem::with_id(&app, "show", "Show Cetli", true, None::<&str>).map_err(|e| e.to_string())?;
    let log = MenuItem::with_id(&app, "quicklog", "Quick Log...", true, None::<&str>).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(&app, "quit", "Quit", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app, &[&show, &log, &quit]).map_err(|e| e.to_string())?;
    let icon = app.default_window_icon().cloned().ok_or("no icon")?;
    let built = TrayIconBuilder::with_id("cetli-tray")
        .icon(icon)
        .tooltip("Cetli")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_primary(app),
            "quicklog" => emit_primary(app, "tray-quicklog", ()),
            "quit" => emit_primary(app, "tray-quit", ()),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_primary(tray.app_handle());
            }
        })
        .build(&app)
        .map_err(|e| e.to_string())?;
    *slot = Some(built);
    Ok(())
}

/// Register a global hotkey the global-shortcut plugin cannot handle (Windows only).
#[tauri::command]
fn register_win_hotkey(app: AppHandle, accelerator: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let state = app.state::<winhotkey::HotkeyThread>();
        winhotkey::register(app.clone(), &state, &accelerator)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, accelerator);
        Err("Not supported on this platform".into())
    }
}

/// Remove the hotkey registered with `register_win_hotkey`.
#[tauri::command]
fn unregister_win_hotkey(app: AppHandle) {
    #[cfg(windows)]
    winhotkey::unregister(&app.state::<winhotkey::HotkeyThread>());
    #[cfg(not(windows))]
    let _ = app;
}

/// When a document window closes: quit after the last one, otherwise tell the (possibly new) primary.
fn on_document_window_destroyed(app: &AppHandle, label: &str) {
    match primary_window_except(app, label) {
        None => app.exit(0),
        Some(primary) => emit_to_window(&primary, "primary-changed", ()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let args: Vec<String> = std::env::args().collect();
    let launch = files_from_args(&args, &cwd);

    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
                let files = files_from_args(&args, Path::new(&cwd));
                emit_primary(app, "open-files", files);
                show_primary(app);
            }))
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(
                tauri_plugin_window_state::Builder::new()
                    .with_denylist(&["quicklog"])
                    .build(),
            );
    }
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(LaunchFiles(launch))
        .manage(Tray(Mutex::new(None)));
    #[cfg(windows)]
    let builder = builder.manage(winhotkey::HotkeyThread(Mutex::new(None)));
    let builder = builder.manage(python::Hosts(Mutex::new(Default::default())));
    builder
        .setup(|app| {
            if let Some(main) = app.get_webview_window("main") {
                setup_document_window(&main);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if !matches!(event, WindowEvent::Destroyed) {
                return;
            }
            python::stop(&window.state::<python::Hosts>(), window.label(), None);
            // the hidden quick log window must not keep the app alive
            if is_document_window(window.label()) {
                on_document_window_destroyed(window.app_handle(), window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            file_mtime,
            delete_file,
            load_config,
            save_config,
            launch_files,
            todopaper_import,
            primary_label,
            new_window,
            set_window_opacity,
            plugin_dir,
            list_plugins,
            spell_check,
            spell_suggest,
            spell_add,
            spell_languages,
            config_dir,
            set_tray_visible,
            register_win_hotkey,
            unregister_win_hotkey,
            python_start,
            python_send,
            python_stop
        ])
        .build(tauri::generate_context!())
        .expect("error while building Cetli")
        .run(|app, event| {
            // user-initiated quits (e.g. Cmd+Q on macOS) go through the frontend so pending edits are saved
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = event {
                if primary_window(app).is_some() {
                    api.prevent_exit();
                    emit_primary(app, "tray-quit", ());
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_url_values() {
        assert_eq!(url_encode("C:\\My Docs\\todo.txt"), "C%3A%5CMy%20Docs%5Ctodo.txt");
        assert_eq!(url_encode("ä"), "%C3%A4");
    }

    #[test]
    fn dev_builds_do_not_import_recent_files() {
        let found = || todopaper::Import { recent_files: vec!["G:/Notes/todo.txt".into()], searches: vec!["x".into()], ..Default::default() };
        assert!(import_for_build(found(), true).recent_files.is_empty());
        assert_eq!(import_for_build(found(), true).searches, vec!["x".to_string()]);
        assert_eq!(import_for_build(found(), false).recent_files.len(), 1);
    }

    #[test]
    fn plugin_files_are_javascript_or_python() {
        let dir = std::env::temp_dir().join(format!("cetli-plugins-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["a.js", "b.todopaper.plugin.py", "c.PY", "d.todopaper.plugin", "notes.txt", "e.plugin"] {
            std::fs::write(dir.join(name), "").unwrap();
        }
        let names = ["a.js", "b.todopaper.plugin.py", "c.PY", "d.todopaper.plugin", "notes.txt", "e.plugin", "missing.js"];
        let found: Vec<bool> = names.iter().map(|n| is_plugin_file(&dir.join(n))).collect();
        assert_eq!(found, [true, true, true, true, false, false, false]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn recognizes_document_windows() {
        assert!(is_document_window("main"));
        assert!(is_document_window("doc-3"));
        assert!(!is_document_window("quicklog"));
        assert_eq!(window_rank("main"), Some(0));
        assert_eq!(window_rank("doc-12"), Some(12));
        assert_eq!(window_rank("quicklog"), None);
    }
}
