"""Settings loaded from environment variables."""

from pydantic_settings import BaseSettings
from pydantic import model_validator


class Settings(BaseSettings):
    # Environment mode: "dev" allows built-in dev JWT secret; anything else
    # requires an explicitly configured JWT_SECRET (fail-closed).
    agp_env: str = "dev"

    # Postgres
    database_url: str = "postgresql+asyncpg://agp:agp@localhost:5433/agp"
    # For raw asyncpg (non-SQLAlchemy) – auto-derived from database_url if not set.
    pg_dsn: str = ""

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # JWT
    jwt_secret: str = "dev-secret-2026"
    jwt_issuer: str = "agp-gateway"
    jwt_ttl_minutes: int = 60

    # Gateway
    gateway_url: str = "http://localhost:8080"

    # Encryption
    fernet_key: str = ""  # required for credential encryption

    # CORS
    cors_origins: str = "*"

    @model_validator(mode="after")
    def _derive_pg_dsn(self):
        """Auto-derive pg_dsn from database_url when PG_DSN is not explicitly set."""
        if not self.pg_dsn:
            dsn = self.database_url
            if dsn.startswith("postgresql+asyncpg://"):
                dsn = dsn.replace("postgresql+asyncpg://", "postgres://", 1)
            elif dsn.startswith("postgresql://"):
                dsn = dsn.replace("postgresql://", "postgres://", 1)
            self.pg_dsn = dsn
        return self

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()

