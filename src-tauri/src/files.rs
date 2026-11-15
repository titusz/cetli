//! Text file reading and writing that preserves encoding, BOM and line endings,
//! so documents round-trip byte-for-byte when unchanged.

use encoding_rs::{UTF_16BE, UTF_16LE, WINDOWS_1252};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// A decoded text document plus the details needed to write it back unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileData {
    /// Text with line endings normalized to "\n".
    pub text: String,
    /// Original line ending: "\n", "\r\n" or "\r".
    pub line_ending: String,
    /// "utf-8", "utf-16le" or "utf-16be".
    pub encoding: String,
    /// Whether the file started with a byte order mark.
    pub bom: bool,
    /// Modification time in milliseconds since the epoch.
    pub mtime: u64,
}

/// Detect the dominant line ending of a text ("\n" when there are none).
pub fn detect_line_ending(text: &str) -> &'static str {
    let crlf = text.matches("\r\n").count();
    let cr = text.matches('\r').count() - crlf;
    let lf = text.matches('\n').count() - crlf;
    if crlf >= lf && crlf >= cr && crlf > 0 {
        "\r\n"
    } else if cr > lf {
        "\r"
    } else {
        "\n"
    }
}

/// Normalize all line endings to "\n".
pub fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// Decode raw bytes into (text, encoding, bom). Invalid UTF-8 without a BOM is read as Windows-1252.
pub fn decode(bytes: &[u8]) -> (String, &'static str, bool) {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return (String::from_utf8_lossy(rest).into_owned(), "utf-8", true);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return (UTF_16LE.decode_without_bom_handling(rest).0.into_owned(), "utf-16le", true);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return (UTF_16BE.decode_without_bom_handling(rest).0.into_owned(), "utf-16be", true);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => (text.to_string(), "utf-8", false),
        Err(_) => (WINDOWS_1252.decode_without_bom_handling(bytes).0.into_owned(), "utf-8", false),
    }
}

/// Encode text (with "\n" line endings) using the given line ending, encoding and BOM flag.
pub fn encode(text: &str, line_ending: &str, encoding: &str, bom: bool) -> Vec<u8> {
    let eol = match line_ending {
        "\r\n" | "\r" => line_ending,
        _ => "\n",
    };
    let body = if eol == "\n" { normalize_newlines(text) } else { normalize_newlines(text).replace('\n', eol) };
    let mut out = Vec::with_capacity(body.len() + 3);
    match encoding {
        "utf-16le" => {
            if bom {
                out.extend_from_slice(&[0xFF, 0xFE]);
            }
            body.encode_utf16().for_each(|u| out.extend_from_slice(&u.to_le_bytes()));
        }
        "utf-16be" => {
            if bom {
                out.extend_from_slice(&[0xFE, 0xFF]);
            }
            body.encode_utf16().for_each(|u| out.extend_from_slice(&u.to_be_bytes()));
        }
        _ => {
            if bom {
                out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            }
            out.extend_from_slice(body.as_bytes());
        }
    }
    out
}

/// Modification time of a file in milliseconds since the epoch.
pub fn mtime_ms(path: &Path) -> Option<u64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// Read and decode a text file.
pub fn read_text(path: &Path) -> Result<FileData, String> {
    let bytes = fs::read(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let (raw, encoding, bom) = decode(&bytes);
    Ok(FileData {
        line_ending: detect_line_ending(&raw).to_string(),
        text: normalize_newlines(&raw),
        encoding: encoding.to_string(),
        bom,
        mtime: mtime_ms(path).unwrap_or(0),
    })
}

/// Encode and write a text file in place; returns the new modification time.
pub fn write_text(path: &Path, text: &str, line_ending: &str, encoding: &str, bom: bool) -> Result<u64, String> {
    let bytes = encode(text, line_ending, encoding, bom);
    fs::write(path, bytes).map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
    Ok(mtime_ms(path).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_line_endings() {
        assert_eq!(detect_line_ending("a\r\nb\r\n"), "\r\n");
        assert_eq!(detect_line_ending("a\nb\n"), "\n");
        assert_eq!(detect_line_ending("a\rb\r"), "\r");
        assert_eq!(detect_line_ending("no newline"), "\n");
    }

    #[test]
    fn decodes_utf8_with_and_without_bom() {
        assert_eq!(decode(b"\xEF\xBB\xBFh\xC3\xA9"), ("hé".to_string(), "utf-8", true));
        assert_eq!(decode("hé".as_bytes()), ("hé".to_string(), "utf-8", false));
    }

    #[test]
    fn decodes_utf16_and_legacy() {
        assert_eq!(decode(&[0xFF, 0xFE, b'h', 0, b'i', 0]), ("hi".to_string(), "utf-16le", true));
        assert_eq!(decode(&[0xFE, 0xFF, 0, b'h', 0, b'i']), ("hi".to_string(), "utf-16be", true));
        assert_eq!(decode(&[b'h', 0xE9]), ("hé".to_string(), "utf-8", false));
    }

    #[test]
    fn round_trips_crlf_utf8_bom() {
        let original = b"\xEF\xBB\xBFInbox:\r\n- a \xE2\x9C\x93\r\n".to_vec();
        let (raw, enc, bom) = decode(&original);
        let eol = detect_line_ending(&raw);
        let text = normalize_newlines(&raw);
        assert_eq!(text, "Inbox:\n- a ✓\n");
        assert_eq!(encode(&text, eol, enc, bom), original);
    }

    #[test]
    fn round_trips_utf16() {
        let text = "P:\n- ü";
        let bytes = encode(text, "\r\n", "utf-16le", true);
        let (raw, enc, bom) = decode(&bytes);
        assert_eq!((normalize_newlines(&raw).as_str(), enc, bom), (text, "utf-16le", true));
    }

    #[test]
    fn reads_and_writes_files() {
        let dir = std::env::temp_dir().join(format!("cetli-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("todo.taskpaper");
        fs::write(&path, b"A:\r\n- x\r\n").unwrap();
        let data = read_text(&path).unwrap();
        assert_eq!(data.text, "A:\n- x\n");
        assert_eq!(data.line_ending, "\r\n");
        write_text(&path, "A:\n- y\n", &data.line_ending, &data.encoding, data.bom).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"A:\r\n- y\r\n");
        fs::remove_dir_all(&dir).unwrap();
    }
}
