"""Fernet encryption helpers for bank connection credentials."""

from cryptography.fernet import Fernet
from app.config import settings

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key = settings.fernet_key
        if not key:
            # Never silently generate a random per-process key: it makes every
            # previously-encrypted credential undecryptable after a restart and
            # desyncs multi-instance deployments (G10). Fail loudly instead.
            raise RuntimeError(
                "FERNET_KEY is not configured. Set the FERNET_KEY environment "
                "variable to a stable urlsafe-base64 32-byte key (generate one "
                "with: python -c \"from cryptography.fernet import Fernet; "
                "print(Fernet.generate_key().decode())\")."
            )
        _fernet = Fernet(key.encode() if isinstance(key, str) else key)
    return _fernet


def encrypt(plaintext: str) -> str:
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _get_fernet().decrypt(ciphertext.encode()).decode()
