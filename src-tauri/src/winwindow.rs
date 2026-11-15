//! Windows-specific window features: whole-window transparency (TodoPaper's
//! "Window Transparency") and a WebView2 bridge that reveals the file system
//! paths of files dropped onto the page, so Cetli can insert `file:///` links
//! without replacing WebView2's own drag and drop (which moves text).

use tauri::{Emitter, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2};
use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
use windows_core::{Interface, PWSTR};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE, LWA_ALPHA, WS_EX_LAYERED};

/// Prefix of web messages carrying dropped files ("cetli-drop:<document position>").
const DROP_PREFIX: &str = "cetli-drop:";

/// Set the opacity of a window (255 = opaque).
pub fn set_opacity(window: &WebviewWindow, alpha: u8) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as windows_sys::Win32::Foundation::HWND;
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if alpha == 255 {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style & !(WS_EX_LAYERED as isize));
        } else {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED as isize);
            if SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA) == 0 {
                return Err("SetLayeredWindowAttributes failed".into());
            }
        }
    }
    Ok(())
}

/// Collect the file system paths of the File objects attached to a web message.
unsafe fn attached_paths(args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebMessageReceivedEventArgs) -> Vec<String> {
    let mut paths = Vec::new();
    let Ok(args2) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() else {
        return paths;
    };
    let Ok(objects) = args2.AdditionalObjects() else {
        return paths;
    };
    let mut count = 0u32;
    if objects.Count(&mut count).is_err() {
        return paths;
    }
    for i in 0..count {
        let Ok(file) = objects.GetValueAtIndex(i).and_then(|o| o.cast::<ICoreWebView2File>()) else {
            continue;
        };
        let mut path = PWSTR::null();
        if file.Path(&mut path).is_ok() {
            paths.push(take_pwstr(path));
        }
    }
    paths
}

/// Listen for "cetli-drop:<pos>" web messages and emit "files-dropped" {pos, paths} to the window.
pub fn install_drop_bridge(window: &WebviewWindow) {
    let target = window.clone();
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut message = PWSTR::null();
            if args.TryGetWebMessageAsString(&mut message).is_err() {
                return Ok(());
            }
            let message = take_pwstr(message);
            let Some(pos) = message.strip_prefix(DROP_PREFIX) else {
                return Ok(());
            };
            let pos: u64 = pos.trim().parse().unwrap_or(0);
            let paths = attached_paths(&args);
            let _ = target.emit_to(target.label(), "files-dropped", serde_json::json!({ "pos": pos, "paths": paths }));
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    });
}
