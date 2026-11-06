"""Cookie helpers."""
from fastapi import Request


def is_https(request: Request) -> bool:
    """Whether the user opened dbt UI over HTTPS, also behind the bundled nginx and a TLS proxy.

    Used for the Secure flag of the credential cookies: browsers then never send them over plain HTTP.
    """
    forwarded = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return (forwarded or request.url.scheme) == "https"
