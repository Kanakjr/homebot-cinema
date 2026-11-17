//! Which HomeBot Cinema server this app talks to. Chosen on first run (setup.html), saved in the app's config
//! folder (`server.json`), changeable from the menu (HomeBot Cinema > Change Server…). Builds may still bake a
//! default in (CINEMA_ORIGIN, see build.rs) for private use; public release builds do not.
//!
//! The remote page needs the `shell_ipc` permission. For a baked origin it comes from capabilities/remote.json
//! (generated at build time); for a chosen one it is granted here at runtime, for that origin only.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Manager, Url};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Server {
    /// The address the server is normally reached at, e.g. https://cinema.example.com
    pub public: String,
    /// Optional direct address on this machine / home network ("home mode"), e.g. http://localhost:3002
    #[serde(default)]
    pub local: String,
}

fn is_private_host(host: &str) -> bool {
    if host == "localhost" || host.ends_with(".local") || host.starts_with("127.") || host.starts_with("10.") || host.starts_with("192.168.") {
        return true;
    }
    // 172.16.0.0/12
    let mut parts = host.split('.');
    if parts.next() == Some("172") {
        if let Some(Ok(b)) = parts.next().map(str::parse::<u8>) {
            return (16..=31).contains(&b);
        }
    }
    false
}

/// `scheme://host[:port]` of a typed address, or why it is not usable. Plain http is allowed only for private
/// addresses (localhost, LAN); everything else must be https. A missing scheme means https.
pub fn normalize(input: &str, allow_empty: bool) -> Result<String, String> {
    let raw = input.trim();
    if raw.is_empty() {
        return if allow_empty { Ok(String::new()) } else { Err("Enter your server's address.".into()) };
    }
    let with_scheme = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let url = Url::parse(&with_scheme).map_err(|_| format!("\"{raw}\" is not a web address."))?;
    let host = url.host_str().ok_or_else(|| format!("\"{raw}\" has no host name."))?.to_string();
    match url.scheme() {
        "https" => {}
        "http" if is_private_host(&host) => {}
        "http" => return Err("Use https:// for addresses outside your home network.".into()),
        s => return Err(format!("{s}:// addresses are not supported.")),
    }
    Ok(url.origin().ascii_serialization())
}

/// Validate both fields. The local address must be a private one (it skips Cloudflare on the home network).
pub fn validate(public: &str, local: &str) -> Result<Server, String> {
    let public = normalize(public, false)?;
    let local = normalize(local, true)?;
    if !local.is_empty() {
        let host = Url::parse(&local).ok().and_then(|u| u.host_str().map(String::from)).unwrap_or_default();
        if !is_private_host(&host) {
            return Err("The home-network address must be a local one (localhost, 192.168.x.x, 10.x.x.x…).".into());
        }
        if local == public {
            return Ok(Server { public, local: String::new() });
        }
    }
    Ok(Server { public, local })
}

/// Where server.json lives. CINEMA_CONFIG_DIR overrides it (tests, several setups on one machine).
fn file(app: &AppHandle) -> Option<PathBuf> {
    let dir = match std::env::var("CINEMA_CONFIG_DIR") {
        Ok(d) if !d.is_empty() => PathBuf::from(d),
        _ => app.path().app_config_dir().ok()?,
    };
    Some(dir.join("server.json"))
}

pub fn load(app: &AppHandle) -> Option<Server> {
    let text = std::fs::read_to_string(file(app)?).ok()?;
    let s: Server = serde_json::from_str(&text).ok()?;
    validate(&s.public, &s.local).ok()
}

pub fn save(app: &AppHandle, s: &Server) -> Result<(), String> {
    let path = file(app).ok_or("no config folder")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| e.to_string())
}

pub fn clear(app: &AppHandle) {
    if let Some(p) = file(app) {
        let _ = std::fs::remove_file(p);
    }
}

/// Let the pages at this server (and its home address) call `shell_ipc`, and nothing else.
pub fn allow(app: &AppHandle, s: &Server) -> Result<(), String> {
    static N: AtomicUsize = AtomicUsize::new(0);
    let mut cap = tauri::ipc::CapabilityBuilder::new(format!("server-{}", N.fetch_add(1, Ordering::SeqCst)))
        .window("main")
        .remote(format!("{}/*", s.public))
        .permission("allow-shell-ipc");
    if !s.local.is_empty() {
        cap = cap.remote(format!("{}/*", s.local));
    }
    app.add_capability(cap).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses() {
        assert_eq!(normalize("cinema.example.com", false).unwrap(), "https://cinema.example.com");
        assert_eq!(normalize(" https://cinema.example.com/some/path ", false).unwrap(), "https://cinema.example.com");
        assert_eq!(normalize("https://cinema.example.com:8443", false).unwrap(), "https://cinema.example.com:8443");
        assert_eq!(normalize("http://localhost:3002", false).unwrap(), "http://localhost:3002");
        assert_eq!(normalize("http://192.168.1.20:3002", false).unwrap(), "http://192.168.1.20:3002");
        assert_eq!(normalize("http://172.20.0.5", false).unwrap(), "http://172.20.0.5");
        assert!(normalize("http://cinema.example.com", false).is_err());
        assert!(normalize("http://172.40.0.5", false).is_err());
        assert!(normalize("ftp://x", false).is_err());
        assert!(normalize("", false).is_err());
        assert_eq!(normalize("", true).unwrap(), "");
    }

    #[test]
    fn local_must_be_private() {
        let s = validate("cinema.example.com", "http://localhost:3002").unwrap();
        assert_eq!(s, Server { public: "https://cinema.example.com".into(), local: "http://localhost:3002".into() });
        assert!(validate("cinema.example.com", "https://other.example.com").is_err());
        assert_eq!(validate("http://localhost:3002", "http://localhost:3002").unwrap().local, "");
    }
}
