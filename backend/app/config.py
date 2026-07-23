"""Settings loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Postgres
    database_url: str = "postgresql+asyncpg://agp:agp@localhost:5433/agp"
    # For raw asyncpg (non-SQLAlchemy) – derived from database_url
    pg_dsn: str = "postgres://agp:agp@localhost:5433/agp"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # JWT
    jwt_secret: str = "dev-secret-2026"
    jwt_issuer: str = "agp-gateway"
    jwt_ttl_minutes: int = 60

    # Gateway
    gateway_url: str = "http://localhost:8080"

    # Encryption
    fernet_key: str = ""  # auto-generated if empty

    # CORS
    cors_origins: str = "*"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
