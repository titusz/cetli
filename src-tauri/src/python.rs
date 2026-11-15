//! Python plugin host: runs Cetli's bridge script (`python/cetli_bridge.py`) with
//! the Python installed on the machine, one process per document window.
//!
//! Python 2 is preferred because TodoPaper's plugins were written for its
//! embedded Python 2.5; Python 3 is used otherwise. Lines the bridge writes to
//! stdout are forwarded to the window as `python-message` events, stderr lines
//! as `python-stderr`, and the end of the process as `python-exit`. Every event
//! carries the token the window passed when starting the process, so events of
//! a replaced process are never mistaken for those of its successor.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// The bridge script, written to the configuration folder before each start.
pub const BRIDGE: &str = include_str!("python/cetli_bridge.py");

/// Interpreter commands in order of preference.
const CANDIDATES: &[&[&str]] = &[&["py", "-2"], &["python2"], &["py", "-3"], &["python3"], &["python"]];

/// A running bridge process and the token its window started it with.
pub struct Host {
    child: Child,
    stdin: ChildStdin,
    token: u32,
}

/// Bridge processes by window label.
pub struct Hosts(pub Mutex<HashMap<String, Host>>);

/// A command that opens no console window on Windows.
fn command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// True when the interpreter command runs and has the json module.
fn works(candidate: &[&str]) -> bool {
    command(candidate[0])
        .args(&candidate[1..])
        .args(["-c", "import json"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// The preferred installed Python interpreter (program and arguments).
pub fn find_interpreter() -> Option<Vec<String>> {
    CANDIDATES.iter().find(|c| works(c)).map(|c| c.iter().map(|s| s.to_string()).collect())
}

/// Write the bridge script into `dir` (unless it is already current) and return its path.
pub fn install_bridge(dir: &Path) -> Result<std::path::PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join("cetli_bridge.py");
    if std::fs::read_to_string(&path).ok().as_deref() != Some(BRIDGE) {
        std::fs::write(&path, BRIDGE).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// Forward each line of a stream to the window as an event; `end` is emitted when the stream closes.
fn forward_lines<R: Read + Send + 'static>(app: AppHandle, label: String, token: u32, stream: R, event: &'static str, end: Option<&'static str>) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut buf = Vec::new();
        while reader.read_until(b'\n', &mut buf).is_ok_and(|n| n > 0) {
            let line = String::from_utf8_lossy(&buf).trim_end().to_string();
            buf.clear();
            if let Some(w) = app.get_webview_window(&label) {
                let _ = w.emit_to(w.label(), event, serde_json::json!({ "token": token, "line": line }));
            }
        }
        if let (Some(end), Some(w)) = (end, app.get_webview_window(&label)) {
            let _ = w.emit_to(w.label(), end, serde_json::json!({ "token": token }));
        }
    });
}

/// Start (or restart) the bridge for a window; returns the interpreter command line.
pub fn start(app: &AppHandle, label: &str, token: u32, hosts: &Hosts, config_dir: &Path, work_dir: &Path) -> Result<String, String> {
    stop(hosts, label, None);
    let interpreter = find_interpreter().ok_or("Python is not installed")?;
    let script = install_bridge(&config_dir.join("python"))?;
    let mut child = command(&interpreter[0])
        .args(&interpreter[1..])
        .arg("-u")
        .arg(&script)
        .current_dir(work_dir)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    forward_lines(app.clone(), label.to_string(), token, child.stdout.take().ok_or("no stdout")?, "python-message", Some("python-exit"));
    forward_lines(app.clone(), label.to_string(), token, child.stderr.take().ok_or("no stderr")?, "python-stderr", None);
    hosts.0.lock().map_err(|e| e.to_string())?.insert(label.to_string(), Host { child, stdin, token });
    Ok(interpreter.join(" "))
}

/// Send one message line to a window's bridge (the one started with `token`).
pub fn send(hosts: &Hosts, label: &str, token: u32, line: &str) -> Result<(), String> {
    let mut hosts = hosts.0.lock().map_err(|e| e.to_string())?;
    let host = hosts.get_mut(label).filter(|h| h.token == token).ok_or("Python is not running")?;
    writeln!(host.stdin, "{line}").and_then(|_| host.stdin.flush()).map_err(|e| e.to_string())
}

/// Stop a window's bridge, if any (only the one started with `token`, when given).
pub fn stop(hosts: &Hosts, label: &str, token: Option<u32>) {
    let host = hosts.0.lock().ok().and_then(|mut h| {
        let matches = h.get(label).is_some_and(|host| token.map_or(true, |t| host.token == t));
        if matches { h.remove(label) } else { None }
    });
    if let Some(mut host) = host {
        let _ = host.child.kill();
        let _ = host.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_the_bridge_script_once() {
        let dir = std::env::temp_dir().join(format!("cetli-bridge-{}", std::process::id()));
        let path = install_bridge(&dir).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), BRIDGE);
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        install_bridge(&dir).unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), modified);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn bridge_answers_with_the_installed_python() {
        let Some(interpreter) = find_interpreter() else { return };
        let dir = std::env::temp_dir().join(format!("cetli-bridge-run-{}", std::process::id()));
        let script = install_bridge(&dir).unwrap();
        let mut child = command(&interpreter[0])
            .args(&interpreter[1..])
            .arg("-u")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut stdout = BufReader::new(child.stdout.take().unwrap());
        let mut line = String::new();
        stdout.read_line(&mut line).unwrap();
        assert!(line.contains("\"ready\""), "{line}");
        writeln!(child.stdin.take().unwrap(), "{{\"type\": \"quit\"}}").unwrap();
        assert!(child.wait().unwrap().success());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
