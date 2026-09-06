//! 静默检查更新：对比 GitHub 最新 release 与当前版本。

use serde::Serialize;
use serde_json::Value;

use crate::error::{Error, Result};

const REPO: &str = "fltLi/material-dictation";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_url: String,
}

#[tauri::command]
pub fn check_update() -> Result<UpdateInfo> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");

    let client = reqwest::blocking::Client::builder()
        .user_agent("material-dictation")
        .build()
        .map_err(|e| Error::Http(e.to_string()))?;
    let resp = client
        .get(&url)
        .send()
        .map_err(|e| Error::Http(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(Error::Http(format!(
            "GitHub API 请求失败: {}",
            resp.status()
        )));
    }
    let json: Value = resp.json().map_err(|e| Error::Http(e.to_string()))?;

    let latest = json["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    let release_url = json["html_url"].as_str().unwrap_or("").to_string();
    let has_update = !latest.is_empty() && version_is_newer(&latest, &current);

    Ok(UpdateInfo {
        current_version: current,
        latest_version: latest,
        has_update,
        release_url,
    })
}

fn version_is_newer(a: &str, b: &str) -> bool {
    let parse = |s: &str| -> Vec<u64> {
        s.split('.')
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let av = parse(a);
    let bv = parse(b);
    for (x, y) in av.iter().zip(bv.iter()) {
        if x != y {
            return x > y;
        }
    }
    av.len() > bv.len()
}

#[cfg(test)]
mod tests {
    use super::version_is_newer;

    #[test]
    fn compares_semver() {
        assert!(version_is_newer("0.2.0", "0.1.0"));
        assert!(version_is_newer("0.10.0", "0.9.0"));
        assert!(version_is_newer("1.0.0", "0.9.9"));
        assert!(!version_is_newer("0.1.0", "0.1.0"));
        assert!(!version_is_newer("0.1.0", "0.2.0"));
    }
}
