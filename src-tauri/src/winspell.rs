//! Spell checking with the Windows spell checking service (TodoPaper used
//! Enchant dictionaries): misspelled ranges, suggestions and the user
//! dictionary. Offsets are UTF-16 code units, matching JavaScript strings.

use windows::core::{HSTRING, PWSTR};
use windows::Win32::Foundation::S_OK;
use windows::Win32::Globalization::{ISpellChecker, ISpellCheckerFactory, ISpellingError, SpellCheckerFactory, CORRECTIVE_ACTION_NONE};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, IEnumString, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};

/// Create the spell checking factory (initializing COM on this thread).
fn factory() -> Result<ISpellCheckerFactory, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        CoCreateInstance(&SpellCheckerFactory, None, CLSCTX_INPROC_SERVER).map_err(|e| format!("Spell checking is not available: {e}"))
    }
}

/// A spell checker for a language tag such as "en-US".
fn checker(lang: &str) -> Result<ISpellChecker, String> {
    let factory = factory()?;
    let tag = HSTRING::from(lang);
    unsafe {
        let supported = factory.IsSupported(&tag).map_err(|e| e.to_string())?;
        if !supported.as_bool() {
            return Err(format!("No spelling dictionary for {lang} is installed"));
        }
        factory.CreateSpellChecker(&tag).map_err(|e| e.to_string())
    }
}

/// Collect the strings of a COM string enumeration.
unsafe fn strings(list: &IEnumString) -> Vec<String> {
    let mut out = Vec::new();
    loop {
        let mut item = [PWSTR::null()];
        let mut fetched = 0u32;
        let hr = unsafe { list.Next(&mut item, Some(&mut fetched)) };
        if hr != S_OK || fetched == 0 {
            break;
        }
        out.push(unsafe { item[0].to_string() }.unwrap_or_default());
        unsafe { CoTaskMemFree(Some(item[0].0 as *const _)) };
    }
    out
}

/// Misspelled (start, length) ranges of one text (the service rejects empty texts, so blanks are skipped).
fn check_text(checker: &ISpellChecker, text: &str) -> windows::core::Result<Vec<(u32, u32)>> {
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    unsafe {
        let errors = checker.Check(&HSTRING::from(text))?;
        let mut ranges = Vec::new();
        loop {
            let mut error: Option<ISpellingError> = None;
            if errors.Next(&mut error) != S_OK {
                break;
            }
            let Some(error) = error else { break };
            if error.CorrectiveAction()? == CORRECTIVE_ACTION_NONE {
                continue;
            }
            ranges.push((error.StartIndex()?, error.Length()?));
        }
        Ok(ranges)
    }
}

/// Misspelled (start, length) ranges for each text; a text the service cannot check yields none.
pub fn check(texts: &[String], lang: &str) -> Result<Vec<Vec<(u32, u32)>>, String> {
    let checker = checker(lang)?;
    Ok(texts.iter().map(|t| check_text(&checker, t).unwrap_or_default()).collect())
}

/// Suggestions for a misspelled word.
pub fn suggest(word: &str, lang: &str) -> Result<Vec<String>, String> {
    let checker = checker(lang)?;
    unsafe {
        let list = checker.Suggest(&HSTRING::from(word)).map_err(|e| e.to_string())?;
        Ok(strings(&list))
    }
}

/// Add a word to the user dictionary.
pub fn add(word: &str, lang: &str) -> Result<(), String> {
    let checker = checker(lang)?;
    unsafe { checker.Add(&HSTRING::from(word)).map_err(|e| e.to_string()) }
}

/// Language tags with an installed dictionary.
pub fn languages() -> Result<Vec<String>, String> {
    let factory = factory()?;
    unsafe {
        let list = factory.SupportedLanguages().map_err(|e| e.to_string())?;
        Ok(strings(&list))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// First installed English (or any) dictionary.
    fn some_language() -> Option<String> {
        let langs = languages().ok()?;
        langs.iter().find(|l| l.starts_with("en")).or(langs.first()).cloned()
    }

    #[test]
    fn finds_misspellings_and_suggestions() {
        let Some(lang) = some_language() else { return };
        if !lang.starts_with("en") {
            return;
        }
        let texts = ["Thsi is a tset of spelling".to_string(), String::new(), "   ".to_string(), "fine".to_string()];
        let ranges = check(&texts, &lang).unwrap();
        assert_eq!(ranges, vec![vec![(0, 4), (10, 4)], vec![], vec![], vec![]]);
        let suggestions = suggest("Thsi", &lang).unwrap();
        assert!(suggestions.iter().any(|s| s == "This"), "{suggestions:?}");
    }

    #[test]
    fn unknown_language_is_reported() {
        if factory().is_err() {
            return;
        }
        assert!(checker("xx-XX").is_err());
    }
}
