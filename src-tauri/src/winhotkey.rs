//! Windows global hotkey for keys the global-shortcut plugin cannot parse,
//! such as the ISO "<>" key (IntlBackslash) that TodoPaper users on German
//! keyboards bound Quick Log to. A dedicated thread registers the hotkey and
//! runs a message loop that forwards WM_HOTKEY to the main window.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, MOD_WIN};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetMessageW, PostThreadMessageW, MSG, WM_HOTKEY, WM_QUIT};

/// Thread id and handle of the running hotkey thread, if any.
pub struct HotkeyThread(pub Mutex<Option<(u32, std::thread::JoinHandle<()>)>>);

/// Map a key name (W3C code style, as used in accelerators) to a Windows virtual key.
fn virtual_key(key: &str) -> Option<u32> {
    let upper = key.to_ascii_uppercase();
    let vk = match upper.as_str() {
        "INTLBACKSLASH" | "<" => 0xE2,
        "BACKQUOTE" | "`" => 0xC0,
        "SEMICOLON" | ";" => 0xBA,
        "EQUAL" | "=" => 0xBB,
        "COMMA" | "," => 0xBC,
        "MINUS" | "-" => 0xBD,
        "PERIOD" | "." => 0xBE,
        "SLASH" | "/" => 0xBF,
        "BRACKETLEFT" | "[" => 0xDB,
        "BACKSLASH" | "\\" => 0xDC,
        "BRACKETRIGHT" | "]" => 0xDD,
        "QUOTE" | "'" => 0xDE,
        "SPACE" => 0x20,
        "ENTER" => 0x0D,
        "TAB" => 0x09,
        _ => {
            let k = upper.strip_prefix("KEY").or_else(|| upper.strip_prefix("DIGIT")).unwrap_or(&upper);
            if k.len() == 1 && k.chars().all(|c| c.is_ascii_alphanumeric()) {
                k.as_bytes()[0] as u32
            } else if let Some(n) = k.strip_prefix('F').and_then(|n| n.parse::<u32>().ok()).filter(|n| (1..=24).contains(n)) {
                0x70 + n - 1
            } else {
                return None;
            }
        }
    };
    Some(vk)
}

/// Parse an accelerator like "CommandOrControl+Shift+IntlBackslash" into (modifiers, virtual key).
pub fn parse(accelerator: &str) -> Option<(u32, u32)> {
    let mut mods = 0;
    let mut vk = None;
    for part in accelerator.split('+').map(str::trim).filter(|p| !p.is_empty()) {
        match part.to_ascii_uppercase().as_str() {
            "COMMANDORCONTROL" | "CMDORCTRL" | "CONTROL" | "CTRL" => mods |= MOD_CONTROL,
            "ALT" | "OPTION" => mods |= MOD_ALT,
            "SHIFT" => mods |= MOD_SHIFT,
            "SUPER" | "META" | "WIN" => mods |= MOD_WIN,
            _ => vk = Some(virtual_key(part)?),
        }
    }
    Some((mods, vk?))
}

/// Stop the hotkey thread and wait until its hotkey is unregistered.
pub fn unregister(state: &HotkeyThread) {
    if let Some((tid, handle)) = state.0.lock().ok().and_then(|mut t| t.take()) {
        unsafe {
            PostThreadMessageW(tid, WM_QUIT, 0, 0);
        }
        let _ = handle.join();
    }
}

/// Register a global hotkey; each press emits "win-hotkey" to the main window.
pub fn register(app: AppHandle, state: &HotkeyThread, accelerator: &str) -> Result<(), String> {
    unregister(state);
    let (mods, vk) = parse(accelerator).ok_or_else(|| format!("Unsupported hotkey: {accelerator}"))?;
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = std::thread::spawn(move || unsafe {
        let tid = GetCurrentThreadId();
        let ok = RegisterHotKey(std::ptr::null_mut(), 1, mods | MOD_NOREPEAT, vk) != 0;
        let _ = tx.send((tid, ok));
        if !ok {
            return;
        }
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            if msg.message == WM_HOTKEY {
                let _ = app.emit_to("main", "win-hotkey", ());
            }
        }
        UnregisterHotKey(std::ptr::null_mut(), 1);
    });
    let (tid, ok) = rx.recv().map_err(|e| e.to_string())?;
    if !ok {
        return Err(format!("The hotkey {accelerator} is already in use"));
    }
    *state.0.lock().map_err(|e| e.to_string())? = Some((tid, handle));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_accelerators() {
        assert_eq!(parse("CommandOrControl+IntlBackslash"), Some((MOD_CONTROL, 0xE2)));
        assert_eq!(parse("Ctrl+Shift+Space"), Some((MOD_CONTROL | MOD_SHIFT, 0x20)));
        assert_eq!(parse("Alt+KeyL"), Some((MOD_ALT, b'L' as u32)));
        assert_eq!(parse("CommandOrControl+Digit5"), Some((MOD_CONTROL, b'5' as u32)));
        assert_eq!(parse("F12"), Some((0, 0x7B)));
        assert_eq!(parse("Ctrl+Nope"), None);
        assert_eq!(parse("Ctrl+Shift"), None);
    }
}
