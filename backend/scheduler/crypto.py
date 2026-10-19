"""Encryption of stored credentials (env vars, git credentials) with a Fernet key."""
import json
from typing import Dict, Optional

from cryptography.fernet import Fernet, InvalidToken

_fernet: Optional[Fernet] = None


def init_crypto(key: str) -> None:
    """Validate and load the encryption key. Raises ValueError for a missing or malformed key."""
    global _fernet
    if not key:
        raise ValueError(
            "DBT_UI__SCHEDULER_ENCRYPTION_KEY is not set. Generate one with: "
            "python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    try:
        _fernet = Fernet(key.encode())
    except (ValueError, TypeError) as e:
        raise ValueError(f"DBT_UI__SCHEDULER_ENCRYPTION_KEY is not a valid Fernet key: {e}")


def encrypt_dict(values: Dict[str, str]) -> str:
    if _fernet is None:
        raise RuntimeError("Encryption key is not initialized")
    if not values:
        return ""
    return _fernet.encrypt(json.dumps(values).encode()).decode()


def decrypt_dict(token: str) -> Dict[str, str]:
    if not token:
        return {}
    if _fernet is None:
        raise RuntimeError("Encryption key is not initialized")
    try:
        return json.loads(_fernet.decrypt(token.encode()).decode())
    except InvalidToken:
        raise ValueError(
            "Stored credentials cannot be decrypted. Was DBT_UI__SCHEDULER_ENCRYPTION_KEY changed?"
        )
