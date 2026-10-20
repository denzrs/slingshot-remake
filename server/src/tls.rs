//! TLS setup for the relay's listener.

use std::sync::Arc;

use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};
use tokio_rustls::rustls::ServerConfig;
use tokio_rustls::TlsAcceptor;
use tracing::error;

/// Load a PEM certificate chain and private key into a TLS acceptor, or die trying —
/// a half-configured TLS deployment must fail loudly at boot, not at 3 a.m.
pub fn load_tls(cert_path: &str, key_path: &str) -> TlsAcceptor {
    let cert_file = std::fs::File::open(cert_path).unwrap_or_else(|err| {
        error!(%cert_path, %err, "cannot open TLS_CERT");
        std::process::exit(1);
    });
    let certs: Vec<CertificateDer<'static>> =
        rustls_pemfile::certs(&mut std::io::BufReader::new(cert_file))
            .collect::<Result<_, _>>()
            .unwrap_or_else(|err| {
                error!(%cert_path, %err, "cannot parse TLS_CERT");
                std::process::exit(1);
            });
    if certs.is_empty() {
        error!(%cert_path, "TLS_CERT contains no certificates");
        std::process::exit(1);
    }
    let key_file = std::fs::File::open(key_path).unwrap_or_else(|err| {
        error!(%key_path, %err, "cannot open TLS_KEY");
        std::process::exit(1);
    });
    let key: PrivateKeyDer<'static> =
        rustls_pemfile::private_key(&mut std::io::BufReader::new(key_file))
            .unwrap_or_else(|err| {
                error!(%key_path, %err, "cannot parse TLS_KEY");
                std::process::exit(1);
            })
            .unwrap_or_else(|| {
                error!(%key_path, "TLS_KEY contains no private key");
                std::process::exit(1);
            });
    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .unwrap_or_else(|err| {
            error!(%err, "TLS certificate/key do not match or are unusable");
            std::process::exit(1);
        });
    TlsAcceptor::from(Arc::new(config))
}
